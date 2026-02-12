// =============================================
// HELPERS - SUPPLIERS, CLIENTS, EXPENSES
// =============================================

import { supabase } from './supabaseClient.js';

// =============================================
// SUPPLIERS
// =============================================
export async function loadSuppliersFromDB(companyId) {
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('company_id', companyId)
    .order('name');

  if (error) throw error;
  return data || [];
}

export async function createSupplier(companyId, name, contact) {
  const { data, error } = await supabase
    .from('suppliers')
    .insert({
      company_id: companyId,
      name,
      contact
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// =============================================
// CLIENTS
// =============================================
export async function loadClientsFromDB(companyId) {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('company_id', companyId)
    .eq('active', true)
    .order('name');

  if (error) throw error;
  return data || [];
}

export async function createCustomer(companyId, name, phone, comment) {
  const { data, error } = await supabase
    .from('customers')
    .insert({
      company_id: companyId,
      name,
      phone,
      comment
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// =============================================
// EXPENSES — хранятся в cash_transactions (type='expense', sale_id IS NULL)
// =============================================
export async function loadExpensesFromDB(companyId, startDate, endDate) {
  const { data, error } = await supabase
    .from('cash_transactions')
    .select('id, amount, comment, created_at, payment_method, payment_methods(name)')
    .eq('company_id', companyId)
    .eq('type', 'expense')
    .is('sale_id', null)
    .gte('created_at', startDate)
    .lte('created_at', endDate)
    .order('created_at', { ascending: false });

  if (error) throw error;

  // Приводим к единому формату для совместимости с loadExpenseStats
  return (data || []).map(row => ({
    id: row.id,
    amount: row.amount,
    description: row.comment || '',
    operation_at: row.created_at,
    expense_categories: { name: extractCategory(row.comment) }
  }));
}

// Вытаскиваем категорию из комментария формата "Категория: описание" или возвращаем как есть
function extractCategory(comment) {
  if (!comment) return 'Расход';
  const match = comment.match(/^([^:]+):/);
  return match ? match[1].trim() : comment;
}

export async function createExpense(companyId, categoryName, amount, description, date) {
  // Формируем comment как "Категория: описание"
  const comment = description
    ? `${categoryName}: ${description}`
    : categoryName;

  // payment_method обязателен — берём первый доступный из кеша
  const paymentMethods = window.PAYMENT_METHODS || [];
  const paymentMethodId = paymentMethods[0]?.id || null;
  if (!paymentMethodId) throw new Error('Нет доступных способов оплаты');

  const { data, error } = await supabase
    .from('cash_transactions')
    .insert({
      company_id: companyId,
      type: 'expense',
      amount,
      comment,
      payment_method: paymentMethodId,
      created_at: date
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// =============================================
// CATEGORY MAPPING
// =============================================
export const EXPENSE_CATEGORIES = {
  'rent': 'Аренда',
  'salary': 'Зарплата',
  'marketing': 'Маркетинг и реклама',
  'utilities': 'Коммунальные услуги',
  'operations': 'Операционные расходы',
  'taxes': 'Налоги и сборы',
  'other': 'Прочие расходы'
};