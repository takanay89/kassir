// =============================================
// TRADING OPERATIONS - VALIDATED AGAINST DB SCHEMA
// =============================================

import { supabase } from './supabaseClient.js';
import { getNetworkStatus } from './sync.js';
import { saveProductsToLocal } from './db.js';
import { 
  getCurrentState, 
  setCurrentTab, 
  clearCurrentState,
  saleState,
  incomeState,
  returnState,
  writeoffState,
  supplierReturnState
} from './tabStates.js';

let currentTradingPeriod = 'day';
let currentIncomePeriod = 'day';
let currentReturnPeriod = 'day';
let currentWriteoffPeriod = 'day';
let currentSupplierReturnPeriod = 'day';

let RECENT_SALES_CACHE = [];
// ✅ ИСПРАВЛЕНИЕ: отдельный флаг для каждой вкладки (раньше был один глобальный — блокировал другие вкладки)
const isProcessingByTab = {};
// ✅ УДАЛЕНО: let WAREHOUSE_CACHE - теперь используем window.WAREHOUSE_CACHE из script.js

// =============================================
// FALLBACK: ПОЛУЧЕНИЕ СКЛАДА
// =============================================
async function getWarehouseWithFallback() {
  // Если склад уже в кеше — используем
  if (window.WAREHOUSE_CACHE) {
    return window.WAREHOUSE_CACHE;
  }
  
  // Если нет — пытаемся загрузить из БД
  try {
    const { data: warehouses, error } = await supabase
      .from('warehouses')
      .select('id')
      .eq('company_id', window.COMPANY_ID);
    
    if (error) {
      throw new Error('Ошибка загрузки складов: ' + error.message);
    }
    
    if (!warehouses || warehouses.length === 0) {
      throw new Error('Склад не найден. Создайте склад в настройках компании.');
    }
    
    // Берём первый склад из списка
    const warehouseId = warehouses[0].id;
    
    // Записываем в кеш для последующих операций
    window.WAREHOUSE_CACHE = warehouseId;
    return warehouseId;
    
  } catch (err) {
    throw new Error('Не удалось получить склад: ' + err.message);
  }
}

// =============================================
// ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК
// =============================================
window.switchTradingTab = function(tab) {
  // ✅ ИСПРАВЛЕНИЕ: закрываем success-modal — он перекрывал весь экран (z-index:10000)
  // и поглощал клики по вкладкам, из-за чего currentTab не менялся
  document.querySelectorAll('.success-modal-overlay').forEach(el => el.remove());
  
  setCurrentTab(tab);
  
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const tabBtn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (tabBtn) tabBtn.classList.add('active');
  
  document.querySelectorAll('.trading-tab-content').forEach(content => {
    content.classList.remove('active');
  });
  const tabContent = document.getElementById(`tab-${tab}`);
  if (tabContent) tabContent.classList.add('active');
  
  // Управление видимостью правой панели
  const rightPanel = document.getElementById('rightPanel');
  if (rightPanel) {
    // Показываем правую панель только для продажи и возврата
    if (tab === 'sale' || tab === 'return') {
      rightPanel.style.display = 'block';
    } else {
      rightPanel.style.display = 'none';
    }
  }
  
  const actionBtn = document.getElementById('actionBtn');
  if (!actionBtn) return;
  
  // ✅ ИСПРАВЛЕНИЕ: сбрасываем флаги при смене вкладки
  // (кнопка или isProcessing могли остаться заблокированными после ошибки)
  actionBtn.disabled = false;
  isProcessingByTab[tab] = false;
  
  const buttonTexts = {
    'sale': 'ПРОДАТЬ',
    'income': 'ОПРИХОДОВАТЬ',
    'return': 'ВЕРНУТЬ',
    'writeoff': 'СПИСАТЬ',
    'supplier-return': 'ВЕРНУТЬ ПОСТАВЩИКУ'
  };
  
  const buttonText = buttonTexts[tab] || 'ВЫПОЛНИТЬ';
  actionBtn.setAttribute('data-action', buttonText);
  actionBtn.textContent = buttonText;
  
  window.renderCart && window.renderCart();
  window.updateActionButton && window.updateActionButton();
  
  // ✅ ИСПРАВЛЕНИЕ: синхронизируем кнопки оплаты с реальным selectedPaymentId вкладки
  if (window.syncPaymentButtons) {
    const tabState = getCurrentState();
    window.syncPaymentButtons(tabState ? tabState.selectedPaymentId : null);
  }
  
  loadTabData(tab);
};

window.switchProductsTab = function(tab) {
  // ✅ ИСПРАВЛЕНИЕ: закрываем success-modal при переключении вкладки
  document.querySelectorAll('.success-modal-overlay').forEach(el => el.remove());
  
  document.querySelectorAll('#section-products .tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const tabBtn = document.querySelector(`#section-products .tab-btn[data-tab="${tab}"]`);
  if (tabBtn) tabBtn.classList.add('active');
  
  document.querySelectorAll('#section-products .trading-tab-content').forEach(content => {
    content.classList.remove('active');
  });
  const tabContent = document.getElementById(`tab-${tab}`);
  if (tabContent) tabContent.classList.add('active');
  
  if (tab === 'income' || tab === 'writeoff' || tab === 'supplier-return') {
    setCurrentTab(tab);
    const actionBtn = document.getElementById('actionBtn');
    if (actionBtn) {
      // ✅ ИСПРАВЛЕНИЕ: сбрасываем флаги при смене вкладки
      actionBtn.disabled = false;
      isProcessingByTab[tab] = false;
      const buttonTexts = {
        'income': 'ОПРИХОДОВАТЬ',
        'writeoff': 'СПИСАТЬ',
        'supplier-return': 'ВЕРНУТЬ ПОСТАВЩИКУ'
      };
      const buttonText = buttonTexts[tab] || 'ВЫПОЛНИТЬ';
      actionBtn.setAttribute('data-action', buttonText);
      actionBtn.textContent = buttonText;
    }
    window.renderCart && window.renderCart();
    window.updateActionButton && window.updateActionButton();
    loadTabData(tab);
  }
};

// =============================================
// ЗАГРУЗКА ДАННЫХ ДЛЯ ВКЛАДКИ
// =============================================
async function loadTabData(tab) {
  switch(tab) {
    case 'sale':
      await loadSalesStats();
      window.renderProductsList && window.renderProductsList();
      break;
    case 'income':
      await loadIncomeStats();
      window.renderIncomeProductsList && window.renderIncomeProductsList();
      break;
    case 'return':
      await loadReturnStats();
      await loadRecentSalesForReturn();
      break;
    case 'writeoff':
      await loadWriteoffStats();
      window.renderWriteoffProductsList && window.renderWriteoffProductsList();
      break;
    case 'supplier-return':
      await loadSupplierReturnStats();
      window.renderSupplierReturnProductsList && window.renderSupplierReturnProductsList();
      break;
  }
}

// =============================================
// ПРОДАЖИ - СТАТИСТИКА
// =============================================
window.changeTradingPeriod = async function(period) {
  currentTradingPeriod = period;
  
  document.querySelectorAll('#tab-sale .period-btn-sm').forEach(btn => {
    btn.classList.remove('active');
  });
  if (event && event.target) event.target.classList.add('active');
  
  await loadSalesStats();
};

async function loadSalesStats() {
  if (!window.COMPANY_ID) return;
  
  const { startDate, endDate } = getPeriodDates(currentTradingPeriod);
  
  try {
    const { data, error } = await supabase
      .from('sales')
      .select(`
        id, 
        total_amount, 
        operation_at, 
        payment_method,
        sale_items (
          product_id,
          quantity,
          products (name)
        )
      `)
      .eq('company_id', window.COMPANY_ID)
      .eq('status', 'completed')
      .gte('operation_at', startDate)
      .lte('operation_at', endDate)
      .is('deleted_at', null)
      .order('operation_at', { ascending: false });
    
    if (error) {
      console.error('Error loading sales stats:', error);
      const totalOpsEl = document.getElementById('salesTotalOps');
      const totalAmountEl = document.getElementById('salesTotalAmount');
      const opsListEl = document.getElementById('salesOperationsList');
      
      if (totalOpsEl) totalOpsEl.textContent = '0';
      if (totalAmountEl) totalAmountEl.textContent = '0 ₸';
      if (opsListEl) opsListEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Ошибка загрузки</div>';
      return;
    }
    
    const totalOps = data?.length || 0;
    const totalAmount = data?.reduce((sum, sale) => sum + Number(sale.total_amount), 0) || 0;
    
    const totalOpsEl = document.getElementById('salesTotalOps');
    const totalAmountEl = document.getElementById('salesTotalAmount');
    
    if (totalOpsEl) totalOpsEl.textContent = totalOps;
    if (totalAmountEl) totalAmountEl.textContent = window.formatMoney(totalAmount);
    
    renderSalesOperations(data || []);
    
  } catch (err) {
    console.error('Error loading sales stats:', err);
    const totalOpsEl = document.getElementById('salesTotalOps');
    const totalAmountEl = document.getElementById('salesTotalAmount');
    const opsListEl = document.getElementById('salesOperationsList');
    
    if (totalOpsEl) totalOpsEl.textContent = '0';
    if (totalAmountEl) totalAmountEl.textContent = '0 ₸';
    if (opsListEl) opsListEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Нет данных</div>';
  }
}

function renderSalesOperations(sales) {
  const container = document.getElementById('salesOperationsList');
  if (!container) return;
  
  if (!sales.length) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Нет операций</div>';
    return;
  }
  
  const canDelete = window.canDeleteOperations && window.canDeleteOperations();
  
  container.innerHTML = `
    <table class="operations-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Товар/Услуга</th>
          <th>Оплата</th>
          <th>Сумма</th>
          <th>Дата и время</th>
          ${canDelete ? '<th></th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${sales.map((sale, index) => {
          const products = sale.sale_items?.map(item => 
            `${item.products?.name || 'Товар'} (${item.quantity} шт)`
          ).join(', ') || 'Нет товаров';
          
          // Получаем название метода оплаты по ID
          let paymentMethodName = 'Не указан';
          if (sale.payment_method && window.PAYMENT_METHODS) {
            const method = window.PAYMENT_METHODS.find(pm => pm.id === sale.payment_method);
            if (method) {
              paymentMethodName = method.name;
            }
          }
          
          return `
            <tr>
              <td>#${sales.length - index}</td>
              <td>${products}</td>
              <td>${paymentMethodName}</td>
              <td>${window.formatMoney(sale.total_amount)}</td>
              <td>${window.formatDate(sale.operation_at)}</td>
              ${canDelete ? `<td><button class="btn-delete-mini" onclick="deleteSaleOperation('${sale.id}')" title="Удалить">×</button></td>` : ''}
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// =============================================
// ПРИХОД - СТАТИСТИКА
// =============================================
window.changeIncomePeriod = async function(period) {
  currentIncomePeriod = period;
  
  document.querySelectorAll('#tab-income .period-btn-sm').forEach(btn => {
    btn.classList.remove('active');
  });
  if (event && event.target) event.target.classList.add('active');
  
  await loadIncomeStats();
};

async function loadIncomeStats() {
  if (!window.COMPANY_ID) return;
  
  const { startDate, endDate } = getPeriodDates(currentIncomePeriod);
  
  try {
    const { data, error } = await supabase
      .from('stock_movements')
      .select('id, total, operation_at, comment')
      .eq('company_id', window.COMPANY_ID)
      .eq('type', 'in')
      .eq('reason', 'purchase')
      .gte('operation_at', startDate)
      .lte('operation_at', endDate)
      .is('deleted_at', null)
      .order('operation_at', { ascending: false});
    
    if (error) {
      console.error('Error loading income stats:', error);
      const totalOpsEl = document.getElementById('incomeTotalOps');
      const totalAmountEl = document.getElementById('incomeTotalAmount');
      const opsListEl = document.getElementById('incomeOperationsList');
      
      if (totalOpsEl) totalOpsEl.textContent = '0';
      if (totalAmountEl) totalAmountEl.textContent = '0 ₸';
      if (opsListEl) opsListEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Ошибка загрузки</div>';
      return;
    }
    
    const totalOps = data?.length || 0;
    const totalAmount = data?.reduce((sum, mov) => sum + Number(mov.total), 0) || 0;
    
    const totalOpsEl = document.getElementById('incomeTotalOps');
    const totalAmountEl = document.getElementById('incomeTotalAmount');
    
    if (totalOpsEl) totalOpsEl.textContent = totalOps;
    if (totalAmountEl) totalAmountEl.textContent = window.formatMoney(totalAmount);
    
    renderIncomeOperations(data || []);
    
  } catch (err) {
    console.error('Error loading income stats:', err);
    const totalOpsEl = document.getElementById('incomeTotalOps');
    const totalAmountEl = document.getElementById('incomeTotalAmount');
    const opsListEl = document.getElementById('incomeOperationsList');
    
    if (totalOpsEl) totalOpsEl.textContent = '0';
    if (totalAmountEl) totalAmountEl.textContent = '0 ₸';
    if (opsListEl) opsListEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Нет данных</div>';
  }
}

function renderIncomeOperations(movements) {
  const container = document.getElementById('incomeOperationsList');
  if (!container) return;
  
  if (!movements.length) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Нет операций</div>';
    return;
  }
  
  const canDelete = window.canDeleteOperations && window.canDeleteOperations();
  
  container.innerHTML = movements.map((mov, index) => `
    <div class="operation-item">
      <div class="operation-header">
        <span class="operation-id">#${movements.length - index}</span>
        <span class="operation-amount">${window.formatMoney(mov.total)}</span>
        ${canDelete ? `<button class="btn-delete-mini" onclick="deleteIncomeOperation('${mov.id}')" title="Удалить">×</button>` : ''}
      </div>
      <div class="operation-details">
        ${window.formatDate(mov.operation_at)}
      </div>
      ${mov.comment ? `<div class="operation-meta"><span class="comment-text">${mov.comment}</span></div>` : ''}
    </div>
  `).join('');
}

// =============================================
// ВОЗВРАТ - СТАТИСТИКА
// =============================================
window.changeReturnPeriod = async function(period) {
  currentReturnPeriod = period;
  
  document.querySelectorAll('#tab-return .period-btn-sm').forEach(btn => {
    btn.classList.remove('active');
  });
  if (event && event.target) event.target.classList.add('active');
  
  await loadReturnStats();
};

async function loadReturnStats() {
  if (!window.COMPANY_ID) return;
  
  const { startDate, endDate } = getPeriodDates(currentReturnPeriod);
  
  try {
    const { data, error } = await supabase
      .from('sales')
      .select(`
        id, 
        total_amount, 
        operation_at, 
        related_sale_id,
        sale_items (
          product_id,
          quantity,
          products (name, barcode)
        )
      `)
      .eq('company_id', window.COMPANY_ID)
      .eq('status', 'completed')
      .not('related_sale_id', 'is', null)
      .gte('operation_at', startDate)
      .lte('operation_at', endDate)
      .is('deleted_at', null)
      .order('operation_at', { ascending: false });
    
    if (error) {
      console.error('Error loading return stats:', error);
      const totalOpsEl = document.getElementById('returnTotalOps');
      const totalAmountEl = document.getElementById('returnTotalAmount');
      const opsListEl = document.getElementById('returnOperationsList');
      
      if (totalOpsEl) totalOpsEl.textContent = '0';
      if (totalAmountEl) totalAmountEl.textContent = '0 ₸';
      if (opsListEl) opsListEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Ошибка загрузки</div>';
      return;
    }
    
    const totalOps = data?.length || 0;
    const totalAmount = data?.reduce((sum, sale) => sum + Math.abs(Number(sale.total_amount)), 0) || 0;
    
    const totalOpsEl = document.getElementById('returnTotalOps');
    const totalAmountEl = document.getElementById('returnTotalAmount');
    
    if (totalOpsEl) totalOpsEl.textContent = totalOps;
    if (totalAmountEl) totalAmountEl.textContent = window.formatMoney(totalAmount);
    
    renderReturnOperations(data || []);
    
  } catch (err) {
    console.error('Error loading return stats:', err);
    const totalOpsEl = document.getElementById('returnTotalOps');
    const totalAmountEl = document.getElementById('returnTotalAmount');
    const opsListEl = document.getElementById('returnOperationsList');
    
    if (totalOpsEl) totalOpsEl.textContent = '0';
    if (totalAmountEl) totalAmountEl.textContent = '0 ₸';
    if (opsListEl) opsListEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Нет данных</div>';
  }
}

function renderReturnOperations(returns) {
  const container = document.getElementById('returnOperationsList');
  if (!container) return;
  
  if (!returns.length) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Нет операций</div>';
    return;
  }
  
  const canDelete = window.canDeleteOperations && window.canDeleteOperations();
  
  container.innerHTML = `
    <table class="operations-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Товар/Услуга</th>
          <th>Штрихкод</th>
          <th>Сумма</th>
          <th>Дата и время</th>
          ${canDelete ? '<th></th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${returns.map((ret, index) => {
          const products = ret.sale_items?.map(item => 
            `${item.products?.name || 'Товар'} (${item.quantity} шт)`
          ).join(', ') || 'Нет товаров';
          
          const barcodes = ret.sale_items?.map(item => 
            item.products?.barcode || '-'
          ).join(', ') || '-';
          
          return `
            <tr>
              <td>#${returns.length - index}</td>
              <td>${products}</td>
              <td>${barcodes}</td>
              <td>${window.formatMoney(Math.abs(ret.total_amount))}</td>
              <td>${window.formatDate(ret.operation_at)}</td>
              ${canDelete ? `<td><button class="btn-delete-mini" onclick="deleteReturnOperation('${ret.id}')" title="Удалить">×</button></td>` : ''}
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

async function loadRecentSalesForReturn() {
  if (!window.COMPANY_ID) return;
  
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { data, error } = await supabase
      .from('sales')
      .select(`
        id, 
        total_amount, 
        operation_at,
        payment_method,
        payment_methods (name),
        sale_items (
          id,
          product_id,
          quantity,
          price,
          cost_price,
          products (name, barcode)
        )
      `)
      .eq('company_id', window.COMPANY_ID)
      .eq('status', 'completed')
      .gte('operation_at', thirtyDaysAgo.toISOString())
      .is('deleted_at', null)
      .is('related_sale_id', null)   // только оригинальные продажи (не возвраты)
      .order('operation_at', { ascending: false })
      .limit(50);
    
    if (error) throw error;

    // Получаем все возвраты для этих продаж (с позициями)
    const saleIds = (data || []).map(s => s.id);
    let returnedItemsMap = {}; // { saleId: { productId: returnedQty } }

    if (saleIds.length > 0) {
      const { data: returnData } = await supabase
        .from('sales')
        .select(`
          related_sale_id,
          sale_items (product_id, quantity)
        `)
        .eq('company_id', window.COMPANY_ID)
        .not('related_sale_id', 'is', null)
        .is('deleted_at', null)
        .in('related_sale_id', saleIds);

      // Суммируем возвращённые количества по каждому товару каждой продажи
      (returnData || []).forEach(ret => {
        const saleId = ret.related_sale_id;
        if (!returnedItemsMap[saleId]) returnedItemsMap[saleId] = {};
        (ret.sale_items || []).forEach(item => {
          const pid = item.product_id;
          returnedItemsMap[saleId][pid] = (returnedItemsMap[saleId][pid] || 0) + Number(item.quantity);
        });
      });
    }

    // Для каждой продажи вычитаем уже возвращённые количества
    const filteredData = (data || []).map(sale => {
      const returnedItems = returnedItemsMap[sale.id];
      if (!returnedItems) return sale; // нет возвратов — показываем как есть

      // Уменьшаем quantity на уже возвращённое
      const remainingItems = (sale.sale_items || []).map(item => {
        const returned = returnedItems[item.product_id] || 0;
        const remaining = Number(item.quantity) - returned;
        return { ...item, quantity: remaining };
      }).filter(item => item.quantity > 0); // убираем полностью возвращённые

      if (remainingItems.length === 0) return null; // всё возвращено — скрываем

      return { ...sale, sale_items: remainingItems };
    }).filter(Boolean);
    
    RECENT_SALES_CACHE = filteredData;
    renderRecentSales(RECENT_SALES_CACHE);
    
  } catch (err) {
    console.error('Error loading recent sales:', err);
  }
}

function renderRecentSales(sales) {
  const container = document.getElementById('returnSalesList');
  if (!container) return;
  
  const validSales = sales.filter(s => s.sale_items && s.sale_items.length > 0);
  
  if (!validSales.length) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Нет продаж для возврата</div>';
    return;
  }
  
  container.innerHTML = `
    <table class="return-sales-table">
      <thead>
        <tr>
          <th class="col-date">ДАТА</th>
          <th class="col-items">ТОВАРЫ</th>
          <th class="col-payment">ОПЛАТА</th>
          <th class="col-amount">СУММА</th>
          <th class="col-action">ДЕЙСТВИЕ</th>
        </tr>
      </thead>
      <tbody>
        ${validSales.map(sale => {
          const itemsText = sale.sale_items.map(i => `${i.products?.name || 'Товар'} ×${i.quantity}`).join(', ');
          const paymentName = sale.payment_methods?.name || '—';
          return `
            <tr>
              <td class="col-date">${window.formatDate(sale.operation_at)}</td>
              <td class="col-items"><span class="cell-truncate">${itemsText}</span></td>
              <td class="col-payment">${paymentName}</td>
              <td class="col-amount">${window.formatMoney(sale.total_amount)}</td>
              <td class="col-action">
                <button class="btn-select-sale" onclick="selectSaleForReturn('${sale.id}')">Выбрать</button>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

window.searchRecentSales = function() {
  const searchInput = document.getElementById('returnSearchInput');
  if (!searchInput) return;
  
  const query = searchInput.value.toLowerCase().trim();
  
  if (!query) {
    renderRecentSales(RECENT_SALES_CACHE);
    return;
  }
  
  const filtered = RECENT_SALES_CACHE.filter(sale => {
    if (!sale.sale_items || !sale.sale_items.length) return false;
    
    const dateStr = window.formatDate(sale.operation_at).toLowerCase();
    const amountStr = String(sale.total_amount).toLowerCase();
    
    const hasMatchingItem = sale.sale_items.some(item => {
      const productName = (item.products?.name || '').toLowerCase();
      const barcode = (item.products?.barcode || '').toLowerCase();
      return productName.includes(query) || barcode.includes(query);
    });
    
    return hasMatchingItem || dateStr.includes(query) || amountStr.includes(query);
  });
  
  renderRecentSales(filtered);
};

window.selectSaleForReturn = function(saleId) {
  const sale = RECENT_SALES_CACHE.find(s => s.id === saleId);
  if (!sale || !sale.sale_items) return;
  
  returnState.selectedSale = sale;
  returnState.cart = [];
  
  sale.sale_items.forEach(item => {
    returnState.cart.push({
      id: item.product_id,
      name: item.products?.name || 'Товар',
      price: item.price,
      quantity: item.quantity,
      maxQuantity: item.quantity,
      saleItemId: item.id,
      purchase_price: item.cost_price || 0
    });
  });

  // Показываем баннер выбранной продажи
  const banner = document.getElementById('selectedSaleBanner');
  const infoEl = document.getElementById('selectedSaleInfo');
  const searchCard = document.getElementById('returnSearchCard');
  if (banner && infoEl) {
    const itemsText = sale.sale_items.map(i => i.products?.name || 'Товар').join(', ');
    const date = window.formatDate ? window.formatDate(sale.operation_at) : sale.operation_at;
    infoEl.textContent = `${date} · ${window.formatMoney(sale.total_amount)} · ${itemsText}`;
    banner.style.display = 'block';
  }
  if (searchCard) searchCard.style.display = 'none';
  
  window.renderCart && window.renderCart();
  window.updateActionButton && window.updateActionButton();
  
  window.showToast(`✅ Выбрана продажа на ${window.formatMoney(sale.total_amount)}`);
};

window.clearSelectedSale = function() {
  returnState.selectedSale = null;
  returnState.cart = [];
  const banner = document.getElementById('selectedSaleBanner');
  const searchCard = document.getElementById('returnSearchCard');
  if (banner) banner.style.display = 'none';
  if (searchCard) searchCard.style.display = 'block';
  window.renderCart && window.renderCart();
};

// =============================================
// СПИСАНИЕ - СТАТИСТИКА
// =============================================
window.changeWriteoffPeriod = async function(period) {
  currentWriteoffPeriod = period;
  
  document.querySelectorAll('#tab-writeoff .period-btn-sm').forEach(btn => {
    btn.classList.remove('active');
  });
  if (event && event.target) event.target.classList.add('active');
  
  await loadWriteoffStats();
};

async function loadWriteoffStats() {
  if (!window.COMPANY_ID) return;
  
  const { startDate, endDate } = getPeriodDates(currentWriteoffPeriod);
  
  try {
    const { data, error } = await supabase
      .from('stock_movements')
      .select('id, total, operation_at, comment')
      .eq('company_id', window.COMPANY_ID)
      .eq('type', 'out')
      .eq('reason', 'write_off')
      .gte('operation_at', startDate)
      .lte('operation_at', endDate)
      .is('deleted_at', null)
      .order('operation_at', { ascending: false });
    
    if (error) {
      console.error('Error loading writeoff stats:', error);
      const totalOpsEl = document.getElementById('writeoffTotalOps');
      const totalAmountEl = document.getElementById('writeoffTotalAmount');
      const opsListEl = document.getElementById('writeoffOperationsList');
      
      if (totalOpsEl) totalOpsEl.textContent = '0';
      if (totalAmountEl) totalAmountEl.textContent = '0 ₸';
      if (opsListEl) opsListEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Ошибка загрузки</div>';
      return;
    }
    
    const totalOps = data?.length || 0;
    const totalAmount = data?.reduce((sum, mov) => sum + Number(mov.total), 0) || 0;
    
    const totalOpsEl = document.getElementById('writeoffTotalOps');
    const totalAmountEl = document.getElementById('writeoffTotalAmount');
    
    if (totalOpsEl) totalOpsEl.textContent = totalOps;
    if (totalAmountEl) totalAmountEl.textContent = window.formatMoney(totalAmount);
    
    renderWriteoffOperations(data || []);
    
  } catch (err) {
    console.error('Error loading writeoff stats:', err);
    const totalOpsEl = document.getElementById('writeoffTotalOps');
    const totalAmountEl = document.getElementById('writeoffTotalAmount');
    const opsListEl = document.getElementById('writeoffOperationsList');
    
    if (totalOpsEl) totalOpsEl.textContent = '0';
    if (totalAmountEl) totalAmountEl.textContent = '0 ₸';
    if (opsListEl) opsListEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Нет данных</div>';
  }
}

function renderWriteoffOperations(movements) {
  const container = document.getElementById('writeoffOperationsList');
  if (!container) return;
  
  if (!movements.length) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Нет операций</div>';
    return;
  }
  
  const canDelete = window.canDeleteOperations && window.canDeleteOperations();
  
  container.innerHTML = movements.map((mov, index) => `
    <div class="operation-item">
      <div class="operation-header">
        <span class="operation-id">#${movements.length - index}</span>
        <span class="operation-amount">${window.formatMoney(mov.total)}</span>
        ${canDelete ? `<button class="btn-delete-mini" onclick="deleteWriteoffOperation('${mov.id}')" title="Удалить">×</button>` : ''}
      </div>
      <div class="operation-details">
        ${window.formatDate(mov.operation_at)}
      </div>
      ${mov.comment ? `<div class="operation-meta"><span class="comment-text">${mov.comment}</span></div>` : ''}
    </div>
  `).join('');
}

// =============================================
// ВОЗВРАТ ПОСТАВЩИКУ - СТАТИСТИКА
// =============================================
window.changeSupplierReturnPeriod = async function(period) {
  currentSupplierReturnPeriod = period;
  
  document.querySelectorAll('#tab-supplier-return .period-btn-sm').forEach(btn => {
    btn.classList.remove('active');
  });
  if (event && event.target) event.target.classList.add('active');
  
  await loadSupplierReturnStats();
};

async function loadSupplierReturnStats() {
  if (!window.COMPANY_ID) return;
  
  const { startDate, endDate } = getPeriodDates(currentSupplierReturnPeriod);
  
  try {
    const { data, error } = await supabase
      .from('stock_movements')
      .select('id, total, operation_at, comment')
      .eq('company_id', window.COMPANY_ID)
      .eq('type', 'out')
      .eq('reason', 'supplier_return')
      .gte('operation_at', startDate)
      .lte('operation_at', endDate)
      .is('deleted_at', null)
      .order('operation_at', { ascending: false });
    
    if (error) {
      console.error('Error loading supplier return stats:', error);
      const totalOpsEl = document.getElementById('supplierReturnTotalOps');
      const totalAmountEl = document.getElementById('supplierReturnTotalAmount');
      const opsListEl = document.getElementById('supplierReturnOperationsList');
      
      if (totalOpsEl) totalOpsEl.textContent = '0';
      if (totalAmountEl) totalAmountEl.textContent = '0 ₸';
      if (opsListEl) opsListEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Ошибка загрузки</div>';
      return;
    }
    
    const totalOps = data?.length || 0;
    const totalAmount = data?.reduce((sum, mov) => sum + Number(mov.total), 0) || 0;
    
    const totalOpsEl = document.getElementById('supplierReturnTotalOps');
    const totalAmountEl = document.getElementById('supplierReturnTotalAmount');
    
    if (totalOpsEl) totalOpsEl.textContent = totalOps;
    if (totalAmountEl) totalAmountEl.textContent = window.formatMoney(totalAmount);
    
    renderSupplierReturnOperations(data || []);
    
  } catch (err) {
    console.error('Error loading supplier return stats:', err);
    const totalOpsEl = document.getElementById('supplierReturnTotalOps');
    const totalAmountEl = document.getElementById('supplierReturnTotalAmount');
    const opsListEl = document.getElementById('supplierReturnOperationsList');
    
    if (totalOpsEl) totalOpsEl.textContent = '0';
    if (totalAmountEl) totalAmountEl.textContent = '0 ₸';
    if (opsListEl) opsListEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Нет данных</div>';
  }
}

function renderSupplierReturnOperations(movements) {
  const container = document.getElementById('supplierReturnOperationsList');
  if (!container) return;
  
  if (!movements.length) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Нет операций</div>';
    return;
  }
  
  const canDelete = window.canDeleteOperations && window.canDeleteOperations();
  
  container.innerHTML = movements.map((mov, index) => `
    <div class="operation-item">
      <div class="operation-header">
        <span class="operation-id">#${movements.length - index}</span>
        <span class="operation-amount">${window.formatMoney(mov.total)}</span>
        ${canDelete ? `<button class="btn-delete-mini" onclick="deleteSupplierReturnOperation('${mov.id}')" title="Удалить">×</button>` : ''}
      </div>
      <div class="operation-details">
        ${window.formatDate(mov.operation_at)}
      </div>
      ${mov.comment ? `<div class="operation-meta"><span class="comment-text">${mov.comment}</span></div>` : ''}
    </div>
  `).join('');
}

// =============================================
// SUBMIT OPERATIONS
// =============================================
window.submitOperation = async function() {
  const currentTab = getCurrentTabName();
  
  if (isProcessingByTab[currentTab]) {
    console.log('⏳ Операция уже выполняется на вкладке:', currentTab);
    return;
  }
  
  let result;
  try {
    isProcessingByTab[currentTab] = true;

    switch(currentTab) {
      case 'sale':
        // ✅ Вместо мгновенной продажи открываем экран оплаты
        // (Наличные / Безналичная / Смешанная / В долг) — checkout.js
        if (window.openCheckout) {
          window.openCheckout();
          isProcessingByTab[currentTab] = false;
          return;
        }
        result = await submitSale();
        break;
      case 'income':
        await submitIncome();
        break;
      case 'return':
        await submitReturn();
        break;
      case 'writeoff':
        await submitWriteoff();
        break;
      case 'supplier-return':
        await submitSupplierReturn();
        break;
    }
  } finally {
    isProcessingByTab[currentTab] = false;
  }
  return result;
};

function getCurrentTabName() {
  const activeTab = document.querySelector('.tab-btn.active');
  return activeTab ? activeTab.getAttribute('data-tab') : 'sale';
}

// =============================================
// ПРОДАЖА (submitSale) - АТОМАРНАЯ через RPC
// =============================================
async function submitSale(checkoutPayload) {
  console.log("🚀 submitSale START (ATOMIC via RPC)", checkoutPayload);

  const state = saleState;

  if (!state.cart.length) {
    window.showToast('Корзина пуста', 'error');
    return;
  }

  // ✅ Экран оплаты (checkout.js) передаёт разбивку по способам оплаты.
  // Без checkoutPayload (старое поведение) — используем одиночный selectedPaymentId для совместимости.
  let payments, primaryPaymentMethod, isDebt = false, debtAmount = 0;
  let customerId = state.selectedClientId || null;

  if (checkoutPayload) {
    payments = checkoutPayload.payments || [];
    primaryPaymentMethod = checkoutPayload.primaryPaymentMethod || null;
    isDebt = !!checkoutPayload.isDebt;
    debtAmount = checkoutPayload.debtAmount || 0;
    if (checkoutPayload.customerId) customerId = checkoutPayload.customerId;
  } else {
    if (!state.selectedPaymentId) {
      window.showToast('Выберите способ оплаты', 'error');
      return;
    }
    primaryPaymentMethod = state.selectedPaymentId;
  }

  if (isDebt && !customerId) {
    window.showToast('Для продажи в долг нужно выбрать покупателя', 'error');
    return;
  }

  const subtotal = window.calculateTotal();
  const discount = state.discountAmount || 0;
  const total = subtotal - discount;
  const comment = document.getElementById('commentInput')?.value.trim() || null;

  const actionBtn = document.getElementById('actionBtn');
  const checkoutBtn = document.getElementById('checkoutConfirmBtn');
  const originalText = actionBtn ? actionBtn.textContent : null;
  if (actionBtn) { actionBtn.disabled = true; actionBtn.textContent = 'Сохранение...'; }
  if (checkoutBtn) checkoutBtn.disabled = true;

  try {
    // Формируем items для RPC (все товары и услуги)
    const items = state.cart.map(item => ({
      product_id: item.id,
      quantity: item.quantity,
      price: item.price,
      cost_price: item.purchase_price || 0
    }));

    console.log("ITEMS FOR RPC:", items);

    // Получаем время операции из input или текущее время
    const manualTime = document.getElementById('operationTimeInput')?.value;
    const operation_at = manualTime ? new Date(manualTime).toISOString() : new Date().toISOString();

    // Вызываем атомарную RPC функцию
    const { data, error } = await supabase.rpc('process_sale', {
      p_company_id:        window.COMPANY_ID,
      p_store_location_id: window.STORE_LOCATION_ID,
      p_payment_method:    primaryPaymentMethod,
      p_total_amount:      total,
      p_customer_id:       customerId,
      p_comment:           comment,
      p_items:             items,
      p_warehouse_id:      null,
      p_operation_at:      operation_at,
      p_payments:          payments && payments.length ? payments : null,
      p_is_debt:           isDebt,
      p_debt_amount:       debtAmount
    });
    
    if (error) throw error;
    
    // Проверяем результат
    if (!data || data.length === 0 || !data[0].success) {
      throw new Error(data && data[0] ? data[0].message : 'Неизвестная ошибка');
    }

    console.log("✅ Sale created:", data[0].sale_id);
    
    // Успех!
    showSuccessModal(total, state.cart.length);

    window.resetCart();
    await loadSalesStats();
    await refreshProductsCache();

    // ✅ ИСПРАВЛЕНИЕ: перерисовываем список товаров после обновления кеша
    if (window.renderProductsList) {
      window.renderProductsList();
    }

    return { saleId: data[0].sale_id, total };

  } catch (err) {
    console.error('SALE ERROR FULL:', err);
console.error('SALE ERROR MESSAGE:', err?.message);
console.error('SALE ERROR DETAILS:', err?.details);
console.error('SALE ERROR HINT:', err?.hint);

    window.showToast('❌ Ошибка: ' + (err.message || 'Неизвестная ошибка'), 'error');
    return null;
  } finally {
    // ✅ ИСПРАВЛЕНИЕ: кнопка всегда разблокируется — даже при неожиданных ошибках
    const btn = document.getElementById('actionBtn');
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    const cBtn = document.getElementById('checkoutConfirmBtn');
    if (cBtn) cBtn.disabled = false;
  }
}

// Функция показа модального окна успешной продажи
function showSuccessModal(total, itemsCount) {
  showOperationSuccessModal('Продажа успешно завершена!', total, itemsCount, '#10b981', '✓');
}

function showOperationSuccessModal(title, total, itemsCount, color, icon) {
  // Удаляем предыдущий если есть
  document.querySelectorAll('.success-modal-overlay').forEach(el => el.remove());

  const modal = document.createElement('div');
  modal.className = 'success-modal-overlay';
  modal.innerHTML = `
    <div class="success-modal" style="background: linear-gradient(135deg, ${color} 0%, ${color}cc 100%);">
      <div class="success-icon" style="color:${color};">${icon}</div>
      <h2 class="success-title">${title}</h2>
      <div class="success-details">
        <div class="success-detail-row">
          <span class="success-detail-label">Сумма:</span>
          <span class="success-detail-value">${window.formatMoney(total)}</span>
        </div>
        <div class="success-detail-row">
          <span class="success-detail-label">Позиций:</span>
          <span class="success-detail-value">${itemsCount} шт.</span>
        </div>
      </div>
      <button class="success-btn" style="color:${color};" onclick="this.closest('.success-modal-overlay').remove()">OK</button>
    </div>
  `;
  // ✅ ИСПРАВЛЕНИЕ: клик на затемнённый фон тоже закрывает модал
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
  document.body.appendChild(modal);
  setTimeout(() => { if (modal.parentElement) modal.remove(); }, 3000);
}

function showOperationErrorModal(title, message) {
  document.querySelectorAll('.success-modal-overlay').forEach(el => el.remove());

  const modal = document.createElement('div');
  modal.className = 'success-modal-overlay';
  modal.innerHTML = `
    <div class="success-modal" style="background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);">
      <div class="success-icon" style="color:#ef4444;">✕</div>
      <h2 class="success-title">${title}</h2>
      <div class="success-details">
        <div class="success-detail-row">
          <span class="success-detail-label" style="text-align:center;width:100%;">${message}</span>
        </div>
      </div>
      <button class="success-btn" style="color:#ef4444;" onclick="this.closest('.success-modal-overlay').remove()">Закрыть</button>
    </div>
  `;
  document.body.appendChild(modal);
}

// =============================================
// ПРИХОД ТОВАРА (submitIncome) - VALIDATED
// =============================================
async function submitIncome() {
  const state = incomeState;
  
  if (!state.cart.length) {
    window.showToast('Корзина пуста');
    return;
  }
  
  if (!state.selectedPaymentId) {
    window.showToast('Выберите способ оплаты');
    return;
  }
  
  if (!window.getNetworkStatus()) {
    window.showToast('❌ Приход требует интернет');
    return;
  }
  
  const total = window.calculateTotal();
  const comment = document.getElementById('commentInput')?.value.trim() || null;
  
  const actionBtn = document.getElementById('actionBtn');
  if (!actionBtn) return;
  
  const originalText = actionBtn.textContent;
  actionBtn.disabled = true;
  actionBtn.textContent = 'Сохранение...';
  
  try {
    // ✅ ОБНОВЛЕНО: Получаем склад с fallback (cache или БД)
    const WAREHOUSE_ID = await getWarehouseWithFallback();
    
    const items = state.cart.map(item => ({
      product_id: item.id,
      quantity: item.quantity,
      cost_price: item.price
    }));
    
    // Получаем время операции из input или текущее время
    const manualTime = document.getElementById('operationTimeInput')?.value;
    const operation_at = manualTime ? new Date(manualTime).toISOString() : new Date().toISOString();
    
    // Вызов RPC с ПРАВИЛЬНЫМИ параметрами
    const { data, error } = await supabase.rpc('create_purchase_document', {
      p_company_id: window.COMPANY_ID,
      p_warehouse_id: WAREHOUSE_ID,  // ✅ ИЗМЕНЕНО: Используем локальную переменную
      p_payment_method: state.selectedPaymentId,
      p_supplier_id: null,  // ✅ Правильное имя параметра
      p_items: items,
      p_comment: comment,
      p_operation_at: operation_at
    });
    
    if (error) throw error;
    
    window.showToast(`✅ Приход на ${window.formatMoney(total)} оформлен`);
    showOperationSuccessModal('Приход оформлен!', total, state.cart.length, '#3b82f6', '📦');
    window.resetCart();
    
    await loadIncomeStats();
    await refreshProductsCache();
    
    // ✅ ИСПРАВЛЕНИЕ: перерисовываем список товаров после обновления кеша
    if (window.renderProductsList) {
      window.renderProductsList();
    }
    if (window.renderIncomeProductsList) {
      window.renderIncomeProductsList();
    }
    
  } catch (err) {
    console.error('Income error:', err);
    window.showToast('❌ Ошибка: ' + err.message);
  } finally {
    const btn = document.getElementById('actionBtn');
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}

// =============================================
// ВОЗВРАТ (submitReturn) - АТОМАРНЫЙ через RPC
// =============================================
async function submitReturn() {
  const state = returnState;
  
  if (!state.selectedSale) {
    window.showToast('Выберите продажу для возврата', 'error');
    return;
  }
  
  if (!state.cart.length) {
    window.showToast('Корзина пуста', 'error');
    return;
  }
  
  if (!state.selectedPaymentId) {
    window.showToast('Выберите способ оплаты', 'error');
    return;
  }
  
  const total = window.calculateTotal();
  const comment = document.getElementById('commentInput')?.value.trim() || null;
  
  const actionBtn = document.getElementById('actionBtn');
  if (!actionBtn) return;
  
  const originalText = actionBtn.textContent;
  actionBtn.disabled = true;
  actionBtn.textContent = 'Сохранение...';
  
  try {
    const items = state.cart.map(item => ({
      product_id: item.id,
      quantity: item.quantity,
      price: item.price,
      cost_price: item.purchase_price || 0
    }));

    // Получаем время операции из input или текущее время
    const manualTime = document.getElementById('operationTimeInput')?.value;
    const operation_at = manualTime ? new Date(manualTime).toISOString() : new Date().toISOString();

    const { data, error } = await supabase.rpc('process_return', {
      p_company_id:        window.COMPANY_ID,
      p_store_location_id: window.STORE_LOCATION_ID,
      p_payment_method:    state.selectedPaymentId,
      p_total_amount:      total,
      p_original_sale_id:  state.selectedSale.id,
      p_customer_id:       null,
      p_comment:           comment,
      p_items:             items,
      p_warehouse_id:      null,
      p_operation_at:      operation_at
    });
    
    if (error) throw error;
    
    if (!data || data.length === 0 || !data[0].success) {
      throw new Error(data && data[0] ? data[0].message : 'Неизвестная ошибка');
    }
    
    window.showToast(`✅ Возврат на ${window.formatMoney(total)} оформлен`);
    showOperationSuccessModal('Возврат оформлен!', total, state.cart.length, '#8b5cf6', '↩');
    window.resetCart();
    returnState.selectedSale = null;
    window.clearSelectedSale && window.clearSelectedSale();
    
    await loadReturnStats();
    await loadRecentSalesForReturn();
    await refreshProductsCache();
    
    // ✅ ИСПРАВЛЕНИЕ: перерисовываем список товаров после обновления кеша
    if (window.renderProductsList) {
      window.renderProductsList();
    }
    
  } catch (err) {
    console.error('RETURN ERROR:', err);
    window.showToast('❌ Ошибка: ' + (err.message || 'Неизвестная ошибка'), 'error');
  } finally {
    const btn = document.getElementById('actionBtn');
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}

// =============================================
// СПИСАНИЕ (submitWriteoff) - через RPC process_writeoff
// =============================================
async function submitWriteoff() {
  const state = writeoffState;
  
  if (!state.cart.length) {
    window.showToast('Корзина пуста', 'error');
    return;
  }
  
  const total = window.calculateTotal();
  const comment = document.getElementById('commentInput')?.value.trim() || null;
  
  if (!comment) {
    window.showToast('Укажите причину списания', 'error');
    return;
  }
  
  const actionBtn = document.getElementById('actionBtn');
  if (!actionBtn) return;
  
  const originalText = actionBtn.textContent;
  actionBtn.disabled = true;
  actionBtn.textContent = 'Сохранение...';
  
  try {
    const items = state.cart.map(item => ({
      product_id: item.id,
      quantity: item.quantity,
      price: item.purchase_price || item.price || 1  // price > 0 обязателен в БД
    }));

    // Получаем время операции из input или текущее время
    const manualTime = document.getElementById('operationTimeInput')?.value;
    const operation_at = manualTime ? new Date(manualTime).toISOString() : new Date().toISOString();

    const { data, error } = await supabase.rpc('process_writeoff', {
      p_company_id: window.COMPANY_ID,
      p_store_location_id: window.STORE_LOCATION_ID,
      p_warehouse_id: null,   // RPC сам найдёт единственный склад
      p_comment: comment,
      p_items: items,
      p_operation_at: operation_at
    });

    if (error) throw error;

    if (!data || data.length === 0 || !data[0].success) {
      throw new Error(data?.[0]?.message || 'Неизвестная ошибка');
    }

    showOperationSuccessModal('Списание оформлено', total, state.cart.length, '#ef4444', '📝');
    window.resetCart();
    
    await loadWriteoffStats();
    await refreshProductsCache();
    
    // ✅ ИСПРАВЛЕНИЕ: перерисовываем список товаров после обновления кеша
    if (window.renderWriteoffProductsList) {
      window.renderWriteoffProductsList();
    }
    
  } catch (err) {
    console.error('WRITEOFF ERROR:', err);
    showOperationErrorModal('Ошибка списания', err.message || 'Неизвестная ошибка');
  } finally {
    const btn = document.getElementById('actionBtn');
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}

// =============================================
// ВОЗВРАТ ПОСТАВЩИКУ (submitSupplierReturn) - через RPC process_supplier_return
// =============================================
async function submitSupplierReturn() {
  const state = supplierReturnState;
  
  if (!state.cart.length) {
    window.showToast('Корзина пуста', 'error');
    return;
  }
  
  const total = window.calculateTotal();
  const comment = document.getElementById('commentInput')?.value.trim() || null;
  
  const actionBtn = document.getElementById('actionBtn');
  if (!actionBtn) return;
  
  const originalText = actionBtn.textContent;
  actionBtn.disabled = true;
  actionBtn.textContent = 'Сохранение...';
  
  try {
    const items = state.cart.map(item => ({
      product_id: item.id,
      quantity: item.quantity,
      price: item.purchase_price || item.price || 1  // price > 0 обязателен в БД
    }));

    const { data, error } = await supabase.rpc('process_supplier_return', {
      p_company_id: window.COMPANY_ID,
      p_store_location_id: window.STORE_LOCATION_ID,
      p_warehouse_id: null,   // RPC сам найдёт единственный склад
      p_comment: comment,
      p_items: items
    });

    if (error) throw error;

    if (!data || data.length === 0 || !data[0].success) {
      throw new Error(data?.[0]?.message || 'Неизвестная ошибка');
    }

    showOperationSuccessModal('Возврат поставщику оформлен', total, state.cart.length, '#f59e0b', '↩️');
    window.resetCart();
    
    await loadSupplierReturnStats();
    await refreshProductsCache();
    
    // ✅ ИСПРАВЛЕНИЕ: перерисовываем список товаров после обновления кеша
    if (window.renderSupplierReturnProductsList) {
      window.renderSupplierReturnProductsList();
    }
    
  } catch (err) {
    console.error('SUPPLIER RETURN ERROR:', err);
    showOperationErrorModal('Ошибка возврата поставщику', err.message || 'Неизвестная ошибка');
  } finally {
    const btn = document.getElementById('actionBtn');
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}

// =============================================
// УТИЛИТЫ
// =============================================
async function refreshProductsCache() {
  try {
    // ✅ КРИТИЧНО: грузим ТОЛЬКО остатки текущего магазина из product_balances
    if (!window.STORE_LOCATION_ID) {
      console.warn('⚠️ Магазин не выбран при refresh');
      return;
    }
    
    const { data, error } = await supabase
      .from('product_balances')
      .select(`
        quantity,
        product_id,
        products!inner (
          id,
          name,
          sku,
          barcode,
          sale_price,
          purchase_price,
          type
        )
      `)
      .eq('store_location_id', window.STORE_LOCATION_ID)
      .order('products(name)');
    
    if (error) throw error;
    
    if (data) {
      window.PRODUCTS_CACHE = data.map(pb => {
        const p = pb.products;
        return {
          id: p.id,
          name: p.name,
          sku: p.sku || '',
          barcode: p.barcode || '',
          base_price: Number(p.sale_price || 0),
          cost_price: Number(p.purchase_price || 0),
          quantity: Number(pb.quantity || 0),  // ✅ Остаток ТОЛЬКО в текущем магазине
          type: p.type || 'product'
        };
      });
      
      // ✅ ИСПРАВЛЕНИЕ: сохраняем в IndexedDB чтобы при перезагрузке были актуальные данные
      try {
        await saveProductsToLocal(window.PRODUCTS_CACHE);
      } catch (dbErr) {
        console.warn('⚠️ Не удалось сохранить в IndexedDB:', dbErr);
      }
      
      console.log('✅ Кеш обновлён (store:', window.STORE_LOCATION_ID, ', товаров:', data.length, ')');
    }
  } catch (updateErr) {
    console.warn('⚠️ Не удалось обновить кеш продуктов:', updateErr);
  }
}

function getPeriodDates(period) {
  const now = new Date();
  const endDate = now.toISOString();
  let startDate;
  
  switch(period) {
    case 'day':
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      startDate = dayStart.toISOString();
      break;
    case 'week':
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - 7);
      startDate = weekStart.toISOString();
      break;
    case 'month':
      const monthStart = new Date(now);
      monthStart.setDate(monthStart.getDate() - 30);
      startDate = monthStart.toISOString();
      break;
  }
  
  return { startDate, endDate };
}

// =============================================
// УДАЛЕНИЕ ОПЕРАЦИЙ
// =============================================
async function deleteSaleOperation(saleId) {
  if (!window.canDeleteOperations || !window.canDeleteOperations()) {
    window.showToast('❌ Недостаточно прав');
    return;
  }
  
  if (!confirm('Удалить эту продажу?')) {
    return;
  }
  
  try {
    const { error } = await supabase
      .from('sales')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: (await supabase.auth.getUser()).data.user?.id
      })
      .eq('id', saleId);
    
    if (error) throw error;
    
    window.showToast('✅ Продажа удалена');
    await loadSalesStats();
  } catch (err) {
    console.error('Delete sale error:', err);
    window.showToast('❌ Ошибка удаления');
  }
}
window.deleteSaleOperation = deleteSaleOperation;

async function deleteIncomeOperation(movementId) {
  if (!window.canDeleteOperations || !window.canDeleteOperations()) {
    window.showToast('❌ Недостаточно прав');
    return;
  }
  
  if (!confirm('Удалить этот приход?')) {
    return;
  }
  
  try {
    const { error } = await supabase
      .from('stock_movements')
      .update({
        deleted_at: new Date().toISOString()
      })
      .eq('id', movementId);
    
    if (error) throw error;
    
    window.showToast('✅ Приход удалён');
    await loadIncomeStats();
  } catch (err) {
    console.error('Delete income error:', err);
    window.showToast('❌ Ошибка удаления');
  }
}
window.deleteIncomeOperation = deleteIncomeOperation;

async function deleteReturnOperation(saleId) {
  if (!window.canDeleteOperations || !window.canDeleteOperations()) {
    window.showToast('❌ Недостаточно прав');
    return;
  }
  
  if (!confirm('Удалить этот возврат?')) {
    return;
  }
  
  try {
    const { error } = await supabase
      .from('sales')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: (await supabase.auth.getUser()).data.user?.id
      })
      .eq('id', saleId);
    
    if (error) throw error;
    
    window.showToast('✅ Возврат удалён');
    await loadReturnStats();
  } catch (err) {
    console.error('Delete return error:', err);
    window.showToast('❌ Ошибка удаления');
  }
}
window.deleteReturnOperation = deleteReturnOperation;

async function deleteWriteoffOperation(movementId) {
  if (!window.canDeleteOperations || !window.canDeleteOperations()) {
    window.showToast('❌ Недостаточно прав');
    return;
  }
  
  if (!confirm('Удалить это списание?')) {
    return;
  }
  
  try {
    const { error } = await supabase
      .from('stock_movements')
      .update({
        deleted_at: new Date().toISOString()
      })
      .eq('id', movementId);
    
    if (error) throw error;
    
    window.showToast('✅ Списание удалено');
    await loadWriteoffStats();
  } catch (err) {
    console.error('Delete writeoff error:', err);
    window.showToast('❌ Ошибка удаления');
  }
}
window.deleteWriteoffOperation = deleteWriteoffOperation;

async function deleteSupplierReturnOperation(movementId) {
  if (!window.canDeleteOperations || !window.canDeleteOperations()) {
    window.showToast('❌ Недостаточно прав');
    return;
  }
  
  if (!confirm('Удалить этот возврат поставщику?')) {
    return;
  }
  
  try {
    const { error } = await supabase
      .from('stock_movements')
      .update({
        deleted_at: new Date().toISOString()
      })
      .eq('id', movementId);
    
    if (error) throw error;
    
    window.showToast('✅ Возврат поставщику удалён');
    await loadSupplierReturnStats();
  } catch (err) {
    console.error('Delete supplier return error:', err);
    window.showToast('❌ Ошибка удаления');
  }
}
window.deleteSupplierReturnOperation = deleteSupplierReturnOperation;

// Экспорт модальных функций для использования из script.js
window.showQuickStockSuccess = function(title, qty, color, icon) {
  document.querySelectorAll('.success-modal-overlay').forEach(el => el.remove());
  const modal = document.createElement('div');
  modal.className = 'success-modal-overlay';
  modal.innerHTML = `
    <div class="success-modal" style="background: linear-gradient(135deg, ${color} 0%, ${color}cc 100%);">
      <div class="success-icon" style="color:${color};">${icon}</div>
      <h2 class="success-title">${title}</h2>
      <div class="success-details">
        <div class="success-detail-row">
          <span class="success-detail-label">Количество:</span>
          <span class="success-detail-value">${qty} шт.</span>
        </div>
      </div>
      <button class="success-btn" style="color:${color};" onclick="this.closest('.success-modal-overlay').remove()">OK</button>
    </div>
  `;
  document.body.appendChild(modal);
  setTimeout(() => { if (modal.parentElement) modal.remove(); }, 3000);
};
window.showQuickStockError = function(title, message) {
  showOperationErrorModal(title, message);
};

console.log('✅ Trading operations module loaded (DB VALIDATED)');

window.submitSale = submitSale;
