// =============================================
// SUPPLIER DEBTS MODULE
// Работа с задолженностями перед поставщиками
// =============================================

import { supabase } from './supabaseClient.js';

// =============================================
// ЗАГРУЗКА ДОЛГОВ ИЗ БД
// =============================================

/**
 * Загрузить все долги компании
 * @param {string} companyId - ID компании
 * @param {string} status - Фильтр по статусу: 'all', 'open', 'partial', 'closed'
 * @returns {Promise<Array>} - Массив долгов
 */
export async function loadSupplierDebts(companyId, status = 'all') {
  try {
    let query = supabase
      .from('supplier_debts')
      .select(`
        *,
        supplier:suppliers(id, name, phone, email),
        purchase_document:purchase_documents(id, document_date, document_time)
      `)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    // Фильтр по статусу
    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Ошибка загрузки долгов:', error);
    throw error;
  }
}

/**
 * Загрузить один долг по ID с историей оплат
 * @param {string} debtId - ID долга
 * @returns {Promise<Object>} - Долг с историей оплат
 */
export async function loadDebtWithPayments(debtId) {
  try {
    const { data, error } = await supabase
      .from('supplier_debts')
      .select(`
        *,
        supplier:suppliers(id, name, phone, email),
        purchase_document:purchase_documents(id, document_date, document_time),
        payments:supplier_payments(
          id,
          amount,
          payment_method_name,
          comment,
          paid_at
        )
      `)
      .eq('id', debtId)
      .single();

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Ошибка загрузки долга:', error);
    throw error;
  }
}

/**
 * Получить сводку по долгам
 * @param {string} companyId - ID компании
 * @returns {Promise<Object>} - Сводка: total, open, partial, closed
 */
export async function getDebtsSummary(companyId) {
  try {
    const { data, error } = await supabase
      .from('supplier_debts')
      .select('status, total_amount, debt_amount')
      .eq('company_id', companyId);

    if (error) {
      throw error;
    }

    const summary = {
      total: {
        count: data.length,
        amount: data.reduce((sum, d) => sum + Number(d.total_amount || 0), 0),
        debt: data.reduce((sum, d) => sum + Number(d.debt_amount || 0), 0)
      },
      open: {
        count: data.filter(d => d.status === 'open').length,
        debt: data.filter(d => d.status === 'open').reduce((sum, d) => sum + Number(d.debt_amount || 0), 0)
      },
      partial: {
        count: data.filter(d => d.status === 'partial').length,
        debt: data.filter(d => d.status === 'partial').reduce((sum, d) => sum + Number(d.debt_amount || 0), 0)
      },
      closed: {
        count: data.filter(d => d.status === 'closed').length
      }
    };

    return summary;
  } catch (error) {
    console.error('Ошибка получения сводки долгов:', error);
    throw error;
  }
}

// =============================================
// ОПЛАТА ДОЛГА
// =============================================

/**
 * Оплатить долг поставщику
 * @param {string} debtId - ID долга
 * @param {number} amount - Сумма оплаты
 * @param {string} paymentMethodId - ID метода оплаты
 * @param {string} comment - Комментарий (опционально)
 * @returns {Promise<string>} - ID созданной оплаты
 */
export async function paySupplierDebt(debtId, amount, paymentMethodId, comment = null) {
  try {
    // Вызываем функцию БД
    const { data, error } = await supabase.rpc('pay_supplier_debt', {
      p_debt_id: debtId,
      p_amount: amount,
      p_payment_method: paymentMethodId,
      p_comment: comment
    });

    if (error) {
      throw error;
    }

    return data; // UUID платежа
  } catch (error) {
    console.error('Ошибка оплаты долга:', error);
    throw error;
  }
}

/**
 * Получить историю оплат по долгу
 * @param {string} debtId - ID долга
 * @returns {Promise<Array>} - Массив оплат
 */
export async function getPaymentHistory(debtId) {
  try {
    const { data, error } = await supabase
      .from('supplier_payments')
      .select('*')
      .eq('debt_id', debtId)
      .order('paid_at', { ascending: false });

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Ошибка загрузки истории оплат:', error);
    throw error;
  }
}

// =============================================
// ФОРМАТИРОВАНИЕ И УТИЛИТЫ
// =============================================

/**
 * Получить цвет статуса для UI
 * @param {string} status - Статус долга
 * @returns {string} - CSS класс или цвет
 */
export function getDebtStatusColor(status) {
  const colors = {
    'open': '#ef4444',     // красный
    'partial': '#f59e0b',  // оранжевый
    'closed': '#10b981'    // зелёный
  };
  return colors[status] || '#6b7280'; // серый по умолчанию
}

/**
 * Получить текст статуса на русском
 * @param {string} status - Статус долга
 * @returns {string} - Текст статуса
 */
export function getDebtStatusText(status) {
  const texts = {
    'open': 'Не оплачен',
    'partial': 'Частично',
    'closed': 'Оплачен'
  };
  return texts[status] || 'Неизвестно';
}

/**
 * Проверить, можно ли оплатить долг
 * @param {Object} debt - Объект долга
 * @param {number} amount - Сумма оплаты
 * @returns {Object} - {valid: boolean, error: string}
 */
export function validatePayment(debt, amount) {
  if (!debt) {
    return { valid: false, error: 'Долг не найден' };
  }

  if (debt.status === 'closed') {
    return { valid: false, error: 'Долг уже полностью оплачен' };
  }

  const remainingDebt = Number(debt.debt_amount || 0);
  
  if (amount <= 0) {
    return { valid: false, error: 'Сумма должна быть больше нуля' };
  }

  if (amount > remainingDebt) {
    return { valid: false, error: `Сумма превышает остаток долга (${remainingDebt.toFixed(2)} ₸)` };
  }

  return { valid: true };
}

// =============================================
// ЭКСПОРТ В WINDOW ДЛЯ ИСПОЛЬЗОВАНИЯ В HTML
// =============================================
if (typeof window !== 'undefined') {
  window.loadSupplierDebts = loadSupplierDebts;
  window.loadDebtWithPayments = loadDebtWithPayments;
  window.getDebtsSummary = getDebtsSummary;
  window.paySupplierDebt = paySupplierDebt;
  window.getPaymentHistory = getPaymentHistory;
  window.getDebtStatusColor = getDebtStatusColor;
  window.getDebtStatusText = getDebtStatusText;
  window.validatePayment = validatePayment;
}
