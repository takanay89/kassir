// UI STABILIZATION PATCH (no architecture changes)
// FIX: removed broken else block in editProduct (syntax error)
// =============================================
// POS KASSIR - ONLINE = ФАКТ, OFFLINE = INTENT LOG
// =============================================

import { supabase } from './supabaseClient.js';
import { 
  initDB, 
  saveProductsToLocal, 
  getProductsFromLocal,
  savePaymentMethodsToLocal,
  getPaymentMethodsFromLocal,
  savePendingSale,
  getPendingSales
} from './db.js';
import { initSync, getNetworkStatus, syncPendingSales, forceSyncNow } from './sync.js';
import { 
  loadSuppliersFromDB, 
  createSupplier,
  loadClientsFromDB,
  createCustomer,
  loadExpensesFromDB,
  createExpense,
  EXPENSE_CATEGORIES
} from './helpers.js';
import { saleState, getCurrentState, clearCurrentState, setCurrentTab } from './tabStates.js';
import { format as formatMoney, multiply, toTenge, calculateDiscount as moneyCalculateDiscount } from './money.js';

// =============================================
// GLOBAL STATE
// =============================================
let COMPANY_ID = null;
let STORE_LOCATION_ID = null;
let USER_ROLE = null;
let PRODUCTS_CACHE = [];
let PAYMENT_METHODS = [];
let CLIENTS_CACHE = [];
let SUPPLIERS_CACHE = [];
let currentSection = 'trading';
let currentPeriod = 'day';

// Экспорты в window для HTML и других модулей
window.COMPANY_ID = COMPANY_ID;
window.USER_ROLE = USER_ROLE;
window.PRODUCTS_CACHE = PRODUCTS_CACHE;
window.PAYMENT_METHODS = PAYMENT_METHODS;
window.STORE_LOCATION_ID = null;
window.WAREHOUSE_CACHE = null;
window.WAREHOUSE_NAME = null;
window.supabase = supabase;
window.getNetworkStatus = getNetworkStatus;
window.formatMoney = formatMoney;

// ✅ КРИТИЧЕСКИ ВАЖНО: Функции для trading-operations.js и index.html
window.formatDate = function(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) + 
         ' ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

window.showToast = function(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; top: 80px; right: 20px; padding: 16px 24px;
    background: ${type === 'success' ? '#10b981' : '#ef4444'};
    color: white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 10000;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
};

window.openModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'flex';
  }
};

window.closeModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
  }
};

window.logout = async function() {
  try {
    await supabase.auth.signOut();
    window.location.replace('login.html');
  } catch (error) {
    console.error('Ошибка выхода:', error);
    showToast('Ошибка выхода', 'error');
  }
};

// =============================================
// INIT (СТРОГО ПО ТВОЕМУ ИСХОДНИКУ)
// =============================================
async function init() {
  await initDB();
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.replace('login.html');
    return;
  }

  const company = await getMyCompany();
  if (!company) {
    alert('Пользователь не привязан к компании');
    await supabase.auth.signOut();
    window.location.replace('login.html');
    return;
  }

  COMPANY_ID = company.company_id;
  USER_ROLE = company.role;
  window.COMPANY_ID = COMPANY_ID;
  window.USER_ROLE = USER_ROLE;

  // Применяем права доступа по роли
  applyRolePermissions(USER_ROLE);
  
  STORE_LOCATION_ID = await loadSelectedStore();
  window.STORE_LOCATION_ID = STORE_LOCATION_ID;
  
  if (!STORE_LOCATION_ID) {
    showToast('⚠️ Выберите магазин в настройках компании', 'error');
  }
  
  await loadAndSelectWarehouse();
  
  initSync(supabase, COMPANY_ID, STORE_LOCATION_ID);
  await loadInitialData();
  
  renderPaymentMethods();
  document.getElementById('userName').textContent = data.session.user.email.split('@')[0];
  await loadCompanyName();
  await loadStoreName();
  displayWarehouseName();
  
  setupEventListeners();
  
  // ✅ ИСПРАВЛЕНИЕ: ждём готовности trading-operations.js перед инициализацией
  // script.js и trading-operations.js грузятся параллельно как type="module"
  // если вызвать showSection сразу — window.switchTradingTab может ещё не существовать
  function initTrading() {
    if (typeof window.switchTradingTab === 'function') {
      const lastSection = localStorage.getItem('last_section') || 'products';
      showSection(lastSection);
      console.log('✅ Приложение такканай89 готово');
    } else {
      setTimeout(initTrading, 20);
    }
  }
  initTrading();
}

async function getMyCompany() {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('company_users')
    .select('company_id, role')
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle();
  return data;
}

// =============================================
// ЗАГРУЗКА ВЫБРАННОГО МАГАЗИНА
// =============================================
async function loadSelectedStore() {
  // 1. Проверяем localStorage
  const savedStoreId = localStorage.getItem('selected_store_id');
  if (savedStoreId) {
    console.log('✅ Магазин загружен из localStorage:', savedStoreId);
    return savedStoreId;
  }
  
  // 2. Нет в localStorage → загружаем список магазинов
  const { data: stores, error } = await supabase
    .from('store_locations')
    .select('id, name')
    .eq('company_id', COMPANY_ID)
    .eq('active', true)
    .order('created_at');
  
  if (error || !stores || stores.length === 0) {
    console.warn('⚠️ Магазины не найдены');
    showToast('Создайте магазин в настройках компании', 'warning');
    return null;
  }
  
  // 3. Если один магазин → автовыбор
  if (stores.length === 1) {
    const autoStore = stores[0];
    console.log('✅ Автовыбор единственного магазина:', autoStore.name);
    localStorage.setItem('selected_store_id', autoStore.id);
    localStorage.setItem('selected_store_name', autoStore.name);
    return autoStore.id;
  }
  
  // 4. Несколько магазинов → требуем выбор
  console.warn('⚠️ Несколько магазинов. Требуется выбор в настройках.');
  showToast('Выберите магазин в настройках компании', 'warning');
  return null;
}

// =============================================
// СОХРАНЕНИЕ ВЫБРАННОГО МАГАЗИНА
// =============================================
function saveSelectedStore(storeId, storeName) {
  if (!storeId) {
    localStorage.removeItem('selected_store_id');
    localStorage.removeItem('selected_store_name');
    window.STORE_LOCATION_ID = null;
    return;
  }
  
  localStorage.setItem('selected_store_id', storeId);
  localStorage.setItem('selected_store_name', storeName || '');
  window.STORE_LOCATION_ID = storeId;
  
  console.log('✅ Магазин сохранён:', storeName, storeId);
  showToast(`Магазин "${storeName}" выбран. Перезагрузите страницу.`, 'success');
}

window.saveSelectedStore = saveSelectedStore;

// =============================================
// ВЫБОР МАГАЗИНА (КЛИК ПО СПИСКУ)
// =============================================
window.selectStoreLocation = function(storeId, storeName) {
  saveSelectedStore(storeId, storeName);
  displayStoreName(storeName);
  
  // Перезагружаем страницу чтобы применить новый магазин
  setTimeout(() => {
    window.location.reload();
  }, 500);
};

// =============================================
// ОТОБРАЖЕНИЕ НАЗВАНИЯ МАГАЗИНА В ШАПКЕ
// =============================================
function displayStoreName(name) {
  const storeNameEl = document.getElementById('storeName');
  if (storeNameEl && name) {
    storeNameEl.textContent = name;
  }
}

// =============================================
// ЗАГРУЗКА НАЗВАНИЯ ВЫБРАННОГО МАГАЗИНА
// =============================================
async function loadStoreName() {
  // Сначала пробуем из localStorage
  const savedName = localStorage.getItem('selected_store_name');
  if (savedName) {
    displayStoreName(savedName);
    return;
  }
  
  // Если нет в кеше → загружаем из БД
  const storeId = localStorage.getItem('selected_store_id');
  if (!storeId) {
    displayStoreName('Не выбран');
    return;
  }
  
  const { data, error } = await supabase
    .from('store_locations')
    .select('name')
    .eq('id', storeId)
    .single();
  
  if (!error && data) {
    localStorage.setItem('selected_store_name', data.name);
    displayStoreName(data.name);
  } else {
    displayStoreName('Не выбран');
  }
}

// =============================================
// ПОДСВЕТКА ВЫБРАННОГО МАГАЗИНА В НАСТРОЙКАХ
// =============================================
function highlightSelectedStore() {
  const selectedStoreId = localStorage.getItem('selected_store_id');
  if (!selectedStoreId) return;
  
  // Убираем старую подсветку
  document.querySelectorAll('.store-location-item').forEach(item => {
    item.classList.remove('selected-store');
  });
  
  // Добавляем новую
  const selectedItem = document.querySelector(`.store-location-item[data-store-id="${selectedStoreId}"]`);
  if (selectedItem) {
    selectedItem.classList.add('selected-store');
  }
}

// =============================================
// УНИВЕРСАЛЬНЫЙ ВЫБОР МАГАЗИНА ДЛЯ ПРИХОДА
// Возвращает Promise<string|null>:
//   null  → оставить на складе (без store_location_id)
//   uuid  → конкретный магазин
// =============================================
async function getIncomeDestination() {
  const { data: stores, error } = await supabase
    .from('store_locations')
    .select('id, name')
    .eq('company_id', COMPANY_ID)
    .order('name');

  if (error || !stores || stores.length === 0) {
    // Нет магазинов — кладём на склад
    return null;
  }

  if (stores.length === 1) {
    // Один магазин — подставляем автоматически
    return stores[0].id;
  }

  // Несколько магазинов — показываем выбор
  return new Promise((resolve) => {
    // Убираем предыдущий диалог если есть
    document.querySelectorAll('.income-dest-overlay').forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'income-dest-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.5);
      z-index:20000;display:flex;align-items:center;justify-content:center;
    `;

    const storeOptions = stores.map(s => `
      <label style="display:flex;align-items:center;gap:12px;padding:14px 16px;
        border:2px solid #e5e7eb;border-radius:10px;cursor:pointer;
        font-size:16px;font-weight:500;transition:border-color .15s;"
        onmouseover="this.style.borderColor='#3b82f6'"
        onmouseout="this.style.borderColor='#e5e7eb'">
        <input type="radio" name="incomeDest" value="${s.id}"
          style="width:18px;height:18px;accent-color:#3b82f6;">
        🏪 ${s.name}
      </label>
    `).join('');

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:28px;width:90%;max-width:420px;
        box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <h3 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111;">
          📦 Куда направить товар?
        </h3>
        <p style="margin:0 0 20px;color:#6b7280;font-size:14px;">
          Выберите куда поступит приход
        </p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
          <label style="display:flex;align-items:center;gap:12px;padding:14px 16px;
            border:2px solid #e5e7eb;border-radius:10px;cursor:pointer;
            font-size:16px;font-weight:500;transition:border-color .15s;"
            onmouseover="this.style.borderColor='#3b82f6'"
            onmouseout="this.style.borderColor='#e5e7eb'">
            <input type="radio" name="incomeDest" value="__warehouse__"
              style="width:18px;height:18px;accent-color:#3b82f6;" checked>
            🏭 Оставить на складе
          </label>
          ${storeOptions}
        </div>
        <div style="display:flex;gap:10px;">
          <button onclick="this.closest('.income-dest-overlay').remove(); window._incomeDestResolve(null);"
            style="flex:1;padding:12px;border:1px solid #e5e7eb;border-radius:8px;
            background:#fff;font-size:15px;cursor:pointer;">
            Отмена
          </button>
          <button onclick="
            const val = document.querySelector('input[name=incomeDest]:checked')?.value;
            this.closest('.income-dest-overlay').remove();
            window._incomeDestResolve(val === '__warehouse__' ? null : val);"
            style="flex:2;padding:12px;border:none;border-radius:8px;
            background:#3b82f6;color:#fff;font-size:15px;font-weight:600;cursor:pointer;">
            Подтвердить
          </button>
        </div>
      </div>
    `;

    window._incomeDestResolve = resolve;
    document.body.appendChild(overlay);
  });
}
window.getIncomeDestination = getIncomeDestination;

// =============================================
// ПРИХОД НА СКЛАД + АВТОПЕРЕМЕЩЕНИЕ В МАГАЗИН
// Шаг 1: IN на склад (warehouse, store_location_id=null)
// Шаг 2: если destStoreId — OUT со склада + IN в магазин
// =============================================
async function insertIncomeWithTransfer({ companyId, productId, quantity, price, warehouseId, destStoreId, reason = 'purchase' }) {
  const manualTime = document.getElementById('operationTimeInput')?.value;
  const operation_at = manualTime ? new Date(manualTime).toISOString() : new Date().toISOString();
  const wh = warehouseId || window.WAREHOUSE_CACHE || null;

  // Приход ТОЛЬКО на склад
  const { error: inErr } = await supabase.from('stock_movements').insert({
    company_id:        companyId,
    product_id:        productId,
    type:              'in',
    reason,
    quantity,
    price:             price > 0 ? price : 1,
    warehouse_id:      wh,
    store_location_id: null,
    operation_at
  });
  if (inErr) throw inErr;
}
window.insertIncomeWithTransfer = insertIncomeWithTransfer;

async function loadAndSelectWarehouse() {
  const { data: warehouses, error } = await supabase
    .from('warehouses')
    .select('id, name')
    .eq('company_id', COMPANY_ID);
  
  if (error || !warehouses || warehouses.length === 0) {
    console.error('Склады не найдены:', error);
    window.WAREHOUSE_CACHE = null;
    window.WAREHOUSE_NAME = null;
    return;
  }
  
  const firstWarehouse = warehouses[0];
  window.WAREHOUSE_CACHE = firstWarehouse.id;
  window.WAREHOUSE_NAME = firstWarehouse.name;
  
  displayWarehouseName();
}

async function loadCompanyName() {
  const { data } = await supabase.from('companies').select('name').eq('id', COMPANY_ID).maybeSingle();
  if (data) document.getElementById('companyName').textContent = data.name;
}

function displayWarehouseName() {
  const container = document.getElementById('companyName');
  if (!container) return;
  
  const currentText = container.textContent;
  const parts = currentText.split(' | Склад:');
  const companyName = parts[0];
  
  if (window.WAREHOUSE_NAME) {
    container.textContent = `${companyName} | Склад: ${window.WAREHOUSE_NAME}`;
  } else {
    container.textContent = companyName;
  }
}

// =============================================
// DATA LOADING (МАППИНГ ПОЛЕЙ ИЗ ВЬЮ В ТВОИ ПЕРЕМЕННЫЕ)
// =============================================
async function loadInitialData() {
  console.log('🚀 loadInitialData начата');
  
  if (navigator.onLine) {
    try {
      const [products, methods] = await Promise.all([
        loadAllProductsFromServer(),
        loadPaymentMethodsFromServer()
      ]);
      
      console.log('✅ Данные загружены с сервера');
      console.log('📦 Products:', products.length);
      console.log('💳 Payment methods:', methods.length);
      
      PRODUCTS_CACHE = products;
      window.PRODUCTS_CACHE = products;
      
      // Сортировка товаров по имени
      PRODUCTS_CACHE.sort((a, b) => a.name.localeCompare(b.name));
      window.PRODUCTS_CACHE = PRODUCTS_CACHE;
      
      PAYMENT_METHODS = methods;
      window.PAYMENT_METHODS = methods;
      
      console.log('✅ PAYMENT_METHODS установлен:', PAYMENT_METHODS);
      
      await saveProductsToLocal(products);
      await savePaymentMethodsToLocal(methods);
      
      // Грузим поставщиков для дропдауна (тихо, не блокируем)
      try {
        SUPPLIERS_CACHE = await loadSuppliersFromDB(COMPANY_ID);
        fillSupplierDropdowns();
      } catch(e) { /* не критично */ }
      
      // Перерисовываем списки везде
      renderProductsList();
      if (currentSection === 'products') loadProductsTable();
      
    } catch (err) {
      console.error('❌ Ошибка сервера:', err.message, err);
      PRODUCTS_CACHE = await getProductsFromLocal() || [];
      window.PRODUCTS_CACHE = PRODUCTS_CACHE;
      
      // Сортировка товаров по имени
      PRODUCTS_CACHE.sort((a, b) => a.name.localeCompare(b.name));
      window.PRODUCTS_CACHE = PRODUCTS_CACHE;
      
      PAYMENT_METHODS = await getPaymentMethodsFromLocal() || [];
      window.PAYMENT_METHODS = PAYMENT_METHODS;
      console.log('📦 Из кеша PAYMENT_METHODS:', PAYMENT_METHODS);
      renderProductsList();
    }
  } else {
    console.log('📡 Offline режим - загружаем из кеша');
    // Offline режим - загружаем из кеша
    PRODUCTS_CACHE = await getProductsFromLocal() || [];
    window.PRODUCTS_CACHE = PRODUCTS_CACHE;
    
    // Сортировка товаров по имени
    PRODUCTS_CACHE.sort((a, b) => a.name.localeCompare(b.name));
    window.PRODUCTS_CACHE = PRODUCTS_CACHE;
    
    PAYMENT_METHODS = await getPaymentMethodsFromLocal() || [];
    window.PAYMENT_METHODS = PAYMENT_METHODS;
    console.log('📦 Из кеша PAYMENT_METHODS:', PAYMENT_METHODS);
    renderProductsList();
  }
  
  console.log('✅ loadInitialData завершена. PAYMENT_METHODS:', PAYMENT_METHODS);
}

async function loadAllProductsFromServer() {

  // 1️⃣ Загружаем ВСЕ товары
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, sku, barcode, sale_price, purchase_price, type, inventory_mode')
    .eq('company_id', COMPANY_ID)
    .eq('active', true)
    .order('name');

  if (error) throw error;

  // Если магазин не выбран
  if (!window.STORE_LOCATION_ID) {
    return (products || []).map(p => ({
      id: p.id,
      name: p.name,
      sku: p.sku || '',
      barcode: p.barcode || '',
      base_price: Number(p.sale_price || 0),
      cost_price: Number(p.purchase_price || 0),
      quantity: 0,
      type: p.type || 'product',
      inventory_mode: p.inventory_mode || 'stock'
    }));
  }

  // 2️⃣ Загружаем остатки текущего магазина
  const { data: balances } = await supabase
    .from('product_balances')
    .select('product_id, quantity')
    .eq('store_location_id', window.STORE_LOCATION_ID);

  const balanceMap = new Map();
  (balances || []).forEach(b => {
    balanceMap.set(b.product_id, Number(b.quantity || 0));
  });

  // 3️⃣ Объединяем товары + остатки
  return (products || []).map(p => ({
    id: p.id,
    name: p.name,
    sku: p.sku || '',
    barcode: p.barcode || '',
    base_price: Number(p.sale_price || 0),
    cost_price: Number(p.purchase_price || 0),
    quantity: balanceMap.get(p.id) || 0,
    type: p.type || 'product',
    inventory_mode: p.inventory_mode || 'stock'
  }));
}


async function loadPaymentMethodsFromServer() {
  console.log('🔍 loadPaymentMethodsFromServer: COMPANY_ID =', COMPANY_ID);
  
  const { data, error } = await supabase
    .from('payment_methods')
    .select('id, name')
    .eq('company_id', COMPANY_ID);
  
  if (error) {
    console.error('❌ Ошибка загрузки payment_methods:', error);
  } else {
    console.log('✅ Загружено методов оплаты:', data?.length || 0);
    console.log('📦 Данные:', data);
  }

  return data || [];
}

// =============================================
// UI RENDERING & ПОИСК (ВОССТАНОВЛЕНО)
// =============================================
function renderProductsList(query) {
  const container = document.getElementById('productsList');
  if (!container) return;

  // если не передали текст — берём из поля поиска
  if (query === undefined) {
    const input = document.getElementById('searchInput') || document.getElementById('barcodeInput');
    query = input ? input.value : '';
  }

  query = (query || '').toLowerCase();

  // Расширяем грид при поиске, сворачиваем если поиск пустой
  if (query.trim().length > 0) {
    container.classList.add('expanded');
  } else {
    container.classList.remove('expanded');
  }

  
// ✅ ИСПРАВЛЕНИЕ: читаем из window.PRODUCTS_CACHE, а не локальной переменной
const filtered = (window.PRODUCTS_CACHE || []).filter(p => {
  // Скрываем товары с нулевым остатком (услуги всегда показываем)
  if (p.type !== 'service' && (p.quantity || 0) <= 0) return false;
  return (
    (p.name || '').toLowerCase().includes(query) ||
    (p.sku || '').toLowerCase().includes(query) ||
    (p.barcode || '').toLowerCase().includes(query)
  );
});

  
  container.innerHTML = filtered.map(product => {
    const isOutOfStock = (product.quantity || 0) <= 0 && product.type !== 'service';
    return `
      <div class="product-card ${isOutOfStock ? 'out-of-stock' : ''}" onclick="addToCart('${product.id}')">
        <div class="product-card-header">
          <div class="product-name">${product.name}</div>
          <span class="product-stock">${product.type === 'service' ? 'Услуга' : (product.quantity || 0) + ' шт'}</span>
        </div>
        <div class="product-prices">
          <div class="product-price">${formatMoney(product.base_price)}</div>
        </div>
      </div>
    `;
  }).join('');
}
window.renderProductsList = renderProductsList;

// =============================================
// РЕНДЕРИНГ ТОВАРОВ ДЛЯ ПРИХОДА
// =============================================
function renderIncomeProductsList(customProducts) {
  const container = document.getElementById('incomeProductsTable');
  if (!container) return;
  
  // ✅ ИСПРАВЛЕНИЕ: читаем из window.PRODUCTS_CACHE
  const products = customProducts || window.PRODUCTS_CACHE || [];
  
  if (!products.length) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">Нет товаров для прихода</div>';
    return;
  }
  
  container.innerHTML = `
    <table class="products-table-full">
      <thead>
        <tr style="background:var(--bg-secondary);color:var(--text-secondary);">
          <th style="text-align:left;padding:10px;">Название</th>
          <th style="text-align:left;width:100px;">Артикул</th>
          <th style="text-align:center;width:80px;">Тип</th>
          <th style="text-align:right;width:110px;">Себестоимость</th>
          <th style="text-align:right;width:110px;">Цена продажи</th>
          <th style="text-align:center;width:90px;">Остаток</th>
          <th style="text-align:center;width:100px;">Действие</th>
        </tr>
      </thead>
      <tbody>
        ${products.map(product => {
          const isService = product.type === 'service';
          const quantity = Number(product.quantity || 0);
          
          return `
            <tr style="border-bottom:1px solid var(--border-color);">
              <td style="padding:10px;">
                <div style="font-weight:500;">${product.name}</div>
              </td>
              <td style="color:var(--text-secondary);font-size:13px;">${product.sku || '—'}</td>
              <td style="text-align:center;">
                <span class="type-badge ${isService ? 'type-service' : 'type-product'}">
                  ${isService ? '🔧' : '📦'}
                </span>
              </td>
              <td style="text-align:right;color:var(--text-secondary);">${formatMoney(product.cost_price || 0)}</td>
              <td style="text-align:right;font-weight:600;color:var(--primary-color);">${formatMoney(product.base_price || 0)}</td>
              <td style="text-align:center;color:${isService ? 'var(--text-secondary)' : quantity > 0 ? '#059669' : '#dc2626'};">
                ${isService ? '∞' : (quantity > 0 ? quantity + ' шт' : '0 🔴')}
              </td>
              <td style="text-align:center;">
                ${isService ? 
                  '<span style="color:var(--text-secondary);font-size:12px;">—</span>' : 
                  `<button class="btn-income-mini" onclick="openQuickIncome('${product.id}')" title="Оприходовать товар">⬇️ Приход</button>`
                }
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}
window.renderIncomeProductsList = renderIncomeProductsList;

// =============================================
// БЫСТРЫЙ ПРИХОД ДЛЯ СУЩЕСТВУЮЩЕГО ТОВАРА
// =============================================
window.openQuickIncome = function(productId) {
  const product = PRODUCTS_CACHE.find(p => p.id === productId);
  if (!product) return;
  
  window._quickIncomeProductId = productId;
  window._quickIncomeProductName = product.name;
  window._quickIncomeCostPrice = product.cost_price || 0;
  
  // Создаём модальное окно быстрого прихода если его ещё нет
  let modal = document.getElementById('modalQuickIncome');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'modalQuickIncome';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3 id="quickIncomeTitle">Приход товара</h3>
          <button class="modal-close" onclick="closeModal('modalQuickIncome')">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="label">Количество *</label>
            <input type="number" id="quickIncomeQty" class="input" placeholder="0" min="1" step="1" autofocus>
          </div>
          <div class="form-group">
            <label class="label">Себестоимость (за шт.)</label>
            <input type="number" id="quickIncomeCost" class="input" placeholder="0" min="0" step="0.01">
          </div>
          <div class="form-group" style="margin-top:16px;padding-top:16px;border-top:1px solid #e5e7eb;">
            <label style="display:flex;align-items:center;cursor:pointer;user-select:none;">
              <input type="checkbox" id="quickIncomePaySupplier" onchange="toggleQuickIncomePayment()" style="width:18px;height:18px;margin-right:10px;cursor:pointer;">
              <span style="font-weight:500;color:#374151;">Оплатить поставщику</span>
            </label>
          </div>
          <div id="quickIncomePaymentBlock" style="display:none;margin-top:12px;padding:12px;background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb;">
            <label class="label">Способ оплаты</label>
            <select id="quickIncomePaymentMethod" class="input"></select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="closeModal('modalQuickIncome')">Отмена</button>
          <button class="btn-primary" onclick="saveQuickIncome()">Оприходовать</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  
  // Заполняем данные
  document.getElementById('quickIncomeTitle').textContent = `Приход: ${product.name}`;
  document.getElementById('quickIncomeQty').value = '';
  document.getElementById('quickIncomeCost').value = product.cost_price || '';
  document.getElementById('quickIncomePaySupplier').checked = false;
  document.getElementById('quickIncomePaymentBlock').style.display = 'none';
  
  // Заполняем методы оплаты
  const select = document.getElementById('quickIncomePaymentMethod');
  select.innerHTML = PAYMENT_METHODS.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  
  openModal('modalQuickIncome');
  setTimeout(() => document.getElementById('quickIncomeQty').focus(), 100);
};

window.toggleQuickIncomePayment = function() {
  const cb = document.getElementById('quickIncomePaySupplier');
  const block = document.getElementById('quickIncomePaymentBlock');
  block.style.display = cb.checked ? 'block' : 'none';
};

window.saveQuickIncome = async function() {
  const productId = window._quickIncomeProductId;
  const productName = window._quickIncomeProductName;
  const qty = parseInt(document.getElementById('quickIncomeQty').value) || 0;
  const cost = parseFloat(document.getElementById('quickIncomeCost').value) || 0;
  const shouldPay = document.getElementById('quickIncomePaySupplier')?.checked;
  const paymentMethodId = document.getElementById('quickIncomePaymentMethod')?.value;
  
  if (qty <= 0) {
    alert('Укажите количество');
    return;
  }
  
  try {
    const items = [{
      product_id: productId,
      quantity: qty,
      cost_price: cost > 0 ? cost : 0
    }];

    const { error } = await supabase.rpc('create_purchase_document', {
      p_company_id: COMPANY_ID,
      p_warehouse_id: window.WAREHOUSE_CACHE,
      p_payment_method: shouldPay ? paymentMethodId : null,
      p_supplier_id: null,
      p_items: items,
      p_comment: shouldPay ? `Оплата за ${productName}` : null
    });

    if (error) throw error;

    closeModal('modalQuickIncome');
    await loadInitialData();
    if (window.showQuickStockSuccess) {
      window.showQuickStockSuccess(`Приход оформлен`, qty, '#3b82f6', '📦');
    } else {
      window.showToast(`✅ Приход: ${productName} × ${qty} шт`);
    }
    
  } catch (err) {
    console.error('Quick income error:', err);
    alert('Ошибка: ' + (err.message || 'Неизвестная ошибка'));
  }
};

// =============================================
// РЕНДЕРИНГ ТОВАРОВ ДЛЯ СПИСАНИЯ
// =============================================
function renderWriteoffProductsList() {
  const container = document.getElementById('writeoffProductsList');
  if (!container) return;
  
  const searchInput = document.getElementById('writeoffSearchInput');
  const query = searchInput ? searchInput.value.toLowerCase() : '';
  
  // ✅ ИСПРАВЛЕНИЕ: читаем из window.PRODUCTS_CACHE
  const filtered = (window.PRODUCTS_CACHE || []).filter(p => {
    if (query) {
      const name = (p.name || '').toLowerCase();
      const sku = (p.sku || '').toLowerCase();
      const barcode = (p.barcode || '').toLowerCase();
      return name.includes(query) || sku.includes(query) || barcode.includes(query);
    }
    return true;
  });
  
  if (!filtered.length) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Нет товаров</div>';
    return;
  }
  
  container.innerHTML = filtered.map(product => {
    return `
      <div class="product-card" onclick="addToCart('${product.id}')">
        <div class="product-card-header">
          <div class="product-name">${product.name}</div>
          <span class="product-stock">${product.type === 'service' ? 'Услуга' : (product.quantity || 0) + ' шт'}</span>
        </div>
        <div class="product-prices">
          <div class="product-price">${formatMoney(product.base_price || 0)}</div>
        </div>
      </div>
    `;
  }).join('');
}
window.renderWriteoffProductsList = renderWriteoffProductsList;

// =============================================
// РЕНДЕРИНГ ТОВАРОВ ДЛЯ ВОЗВРАТА ПОСТАВЩИКУ
// =============================================
function renderSupplierReturnProductsList() {
  const container = document.getElementById('supplierReturnProductsList');
  if (!container) return;
  
  const searchInput = document.getElementById('supplierReturnSearchInput');
  const query = searchInput ? searchInput.value.toLowerCase() : '';
  
  // ✅ ИСПРАВЛЕНИЕ: читаем из window.PRODUCTS_CACHE
  const filtered = (window.PRODUCTS_CACHE || []).filter(p => {
    if (query) {
      const name = (p.name || '').toLowerCase();
      const sku = (p.sku || '').toLowerCase();
      const barcode = (p.barcode || '').toLowerCase();
      return name.includes(query) || sku.includes(query) || barcode.includes(query);
    }
    return true;
  });
  
  if (!filtered.length) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Нет товаров</div>';
    return;
  }
  
  container.innerHTML = filtered.map(product => {
    return `
      <div class="product-card" onclick="addToCart('${product.id}')">
        <div class="product-card-header">
          <div class="product-name">${product.name}</div>
          <span class="product-stock">${product.type === 'service' ? 'Услуга' : (product.quantity || 0) + ' шт'}</span>
        </div>
        <div class="product-prices">
          <div class="product-price">${formatMoney(product.base_price || 0)}</div>
        </div>
      </div>
    `;
  }).join('');
}
window.renderSupplierReturnProductsList = renderSupplierReturnProductsList;

function renderPaymentMethods() {
  const container = document.getElementById('paymentButtons');
  if (!container) return;
  container.innerHTML = PAYMENT_METHODS.map(method => `
    <button class="payment-btn" data-payment-id="${method.id}" onclick="selectPayment('${method.id}')">
      ${method.name}
    </button>
  `).join('');
}

window.selectPayment = function(id) {
  const state = getCurrentState();
  state.selectedPaymentId = id;
  syncPaymentButtons(id);
};

// ✅ ИСПРАВЛЕНИЕ: синхронизирует визуальное состояние кнопок оплаты с реальным state вкладки
// Проблема была: кнопки — один общий блок для всех вкладок.
// При переходе с "Продажа" на "Возврат" кнопка визуально оставалась активной (от продажи),
// но returnState.selectedPaymentId = null — при нажатии ВЕРНУТЬ падала ошибка "выберите оплату"
function syncPaymentButtons(activeId) {
  document.querySelectorAll('.payment-btn').forEach(btn => {
    const btnId = btn.getAttribute('data-payment-id');
    btn.classList.toggle('active', btnId === activeId);
  });
}
window.syncPaymentButtons = syncPaymentButtons;

// =============================================
// КОРЗИНА И НАВИГАЦИЯ
// =============================================
window.addToCart = function(productId) {
  const product = (window.PRODUCTS_CACHE || []).find(p => p.id === productId);
  if (!product) return;
  
  const state = getCurrentState();
  const existing = state.cart.find(item => item.id === productId);
  
// ✅ ПРОВЕРКА остатка с учетом inventory_mode

const currentQtyInCart = existing ? existing.quantity : 0;
const availableQty = product.type === 'service' ? Infinity : (product.quantity || 0);

// 🔥 Если товар строгий складской — проверяем остаток
if (product.inventory_mode !== 'on_demand') {
  if (currentQtyInCart + 1 > availableQty) {
    window.showToast(`❌ Недостаточно товара на складе (доступно: ${availableQty} шт)`, 'error');
    return;
  }
}
  
  if (existing) {
    existing.quantity++;
  } else {
    state.cart.push({
      id: product.id, 
      name: product.name, 
      price: product.base_price || product.sale_price || 0, 
      quantity: 1,
      type: product.type || 'product',
      purchase_price: product.cost_price || product.purchase_price || 0
    });
  }
  renderCart();
};

function calculateTotal() {
  const state = getCurrentState();
  if (!state || !state.cart) return 0;

  return state.cart.reduce((sum, item) => {
    return sum + ((Number(item.price) || 0) * (Number(item.quantity) || 0));
  }, 0);
}
window.calculateTotal = calculateTotal;

function renderCart() {
  const state = getCurrentState();
  const container = document.getElementById('cart');
  if (!container) return;
  
  if (!state.cart.length) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Корзина пуста</div>';
    document.getElementById('totalAmount').textContent = '0 ₸';
    return;
  }
  
  container.innerHTML = `
    <table class="cart-table">
      <thead>
        <tr>
          <th style="text-align:left;">Товар</th>
          <th style="text-align:center;width:120px;">Кол-во</th>
          <th style="text-align:right;width:100px;">Сумма</th>
          <th style="text-align:center;width:50px;"></th>
        </tr>
      </thead>
      <tbody>
        ${state.cart.map(item => `
          <tr>
            <td style="font-weight:500;">${item.name}</td>
            <td style="text-align:center;">
              <div class="cart-item-controls">
                <button class="cart-btn" onclick="changeQty('${item.id}', -1)">-</button>
                <span class="cart-quantity">${item.quantity}</span>
                <button class="cart-btn" onclick="changeQty('${item.id}', 1)">+</button>
              </div>
            </td>
            <td style="text-align:right;font-weight:600;">${formatMoney(item.price * item.quantity)}</td>
            <td style="text-align:center;">
              <button class="cart-btn-delete" onclick="removeFromCart('${item.id}')" title="Удалить">
                ✕
              </button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  
  const subtotal = state.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const discount = state.discountAmount || 0;
  const total = subtotal - discount;
  
  document.getElementById('totalAmount').textContent = formatMoney(total);

  // Счётчик позиций в итоговой карточке
  const countEl = document.getElementById('cartItemsCount');
  if (countEl) {
    const totalQty = state.cart.reduce((s, i) => s + i.quantity, 0);
    const pos = state.cart.length;
    countEl.textContent = pos > 0 ? `${pos} поз. · ${totalQty} шт` : '';
  }
}

window.renderCart = renderCart;

window.changeQty = function(id, delta) {
  const state = getCurrentState();
  const item = state.cart.find(i => i.id === id);
  if (!item) return;
  
  // ✅ ПРОВЕРКА при увеличении: не превышает ли новое количество доступный остаток
  if (delta > 0) {
    const product = (window.PRODUCTS_CACHE || []).find(p => p.id === id);
    if (product && product.inventory_mode !== 'on_demand') {
      const availableQty = product.type === 'service' ? Infinity : (product.quantity || 0);
      const newQty = item.quantity + delta;
      
      if (newQty > availableQty) {
        window.showToast(`❌ Недостаточно товара на складе (доступно: ${availableQty} шт)`, 'error');
        return;
      }
    }
  }
  
  item.quantity = Math.max(1, item.quantity + delta);
  renderCart();
};

window.removeFromCart = function(id) {
  const state = getCurrentState();
  state.cart = state.cart.filter(i => i.id !== id);
  renderCart();
};

window.resetCart = function () {
  const state = getCurrentState();
  state.cart = [];
  renderCart();
};


window.showSection = function(name) {
  // Проверка доступа по роли
  if (!canAccessSection(name)) {
    showToast('Нет доступа к этому разделу', 'error');
    return;
  }

  currentSection = name;
  if (!document.body.classList.contains('pos-mode')) {
    try { localStorage.setItem('last_section', name); } catch {}
  }
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  
  const target = document.getElementById(`section-${name}`);
  if (target) target.classList.add('active');
  
  const nav = document.querySelector(`.nav-item[data-section="${name}"]`);
  if (nav) nav.classList.add('active');

    // Обновляем мобильную навигацию
  if (typeof updateMobileNavigation === 'function') updateMobileNavigation(name);

  // При возврате в кассу — всегда сбрасываем на вкладку "Продажа"
  // иначе currentTab остаётся 'income'/'writeoff' после посещения раздела товаров
  if (name === 'trading') {
    window.switchTradingTab && window.switchTradingTab('sale');
  }

  if (name === 'products') switchProductsTab('stock');
  if (name === 'money') loadMoneyStats();
  if (name === 'reports') loadReportsStats();
  if (name === 'expenses') loadExpenseStats();
  if (name === 'suppliers') loadSuppliersTable();
  if (name === 'clients') loadClientsTable();
  if (name === 'settings') {
    highlightSelectedStore();
    if (typeof window.onShowSettings === 'function') window.onShowSettings();
  }
};

// Права доступа по разделам
const ROLE_PERMISSIONS = {
  owner:      ['trading', 'products', 'suppliers', 'clients', 'expenses', 'reports', 'money', 'settings'],
  admin:      ['trading', 'products', 'suppliers', 'clients', 'expenses', 'reports', 'money', 'settings'],
  manager:    ['trading', 'products', 'suppliers', 'clients', 'expenses', 'reports', 'money'],
  cashier:    ['trading', 'clients'],
  warehouse:  ['products', 'suppliers'],
  accountant: ['expenses', 'reports', 'money'],
  seller:     ['trading', 'clients'],
};

function canAccessSection(name) {
  const role = window.USER_ROLE || 'cashier';
  const allowed = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS['cashier'];
  return allowed.includes(name);
}

function applyRolePermissions(role) {
  const allowed = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS['cashier'];

  // Скрываем недоступные пункты меню
  document.querySelectorAll('.nav-item[data-section]').forEach(btn => {
    const section = btn.getAttribute('data-section');
    if (!allowed.includes(section)) {
      btn.style.display = 'none';
    }
  });

  // Показываем бейдж роли в хедере
  const roleLabels = {
    owner: 'Владелец', admin: 'Администратор', manager: 'Менеджер',
    cashier: 'Кассир', warehouse: 'Кладовщик', accountant: 'Бухгалтер', seller: 'Продавец'
  };
  const roleColors = {
    owner: '#f59e0b', admin: '#3b82f6', manager: '#8b5cf6',
    cashier: '#10b981', warehouse: '#14b8a6', accountant: '#f97316', seller: '#10b981'
  };
  const userNameEl = document.getElementById('userName');
  if (userNameEl) {
    const label = roleLabels[role] || role;
    const color = roleColors[role] || '#94a3b8';
    userNameEl.insertAdjacentHTML('afterend',
      `<span style="
        font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;
        background:${color}22;color:${color};border:1px solid ${color}44;
        margin-left:8px;
      ">${label}</span>`
    );
  }
}

function setupEventListeners() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => renderProductsList());
  }

  const barcodeInput = document.getElementById('barcodeInput');
  if (barcodeInput) {
    barcodeInput.addEventListener('input', () => {
      renderProductsList();
      const clearBtn = document.getElementById('clearSearchBtn');
      if (clearBtn) clearBtn.style.display = barcodeInput.value ? 'block' : 'none';
    });
  }

  window.clearSearch = function() {
    const input = document.getElementById('barcodeInput');
    const clearBtn = document.getElementById('clearSearchBtn');
    if (input) { input.value = ''; input.focus(); renderProductsList(); }
    if (clearBtn) clearBtn.style.display = 'none';
  };
}

// =============================================
// FALLBACK FUNCTIONS (чтобы интерфейс не падал)
// =============================================

// =============================================
// ОТЧЁТЫ — 4 вкладки
// =============================================

let currentReportTab = 'cash';

window.switchReportTab = function(tab) {
  currentReportTab = tab;
  // переключаем видимость контента
  ['cash','sales','returns','stock','balance','kaspi'].forEach(t => {
    const el = document.getElementById(`reportTab-${t}`);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  // переключаем стиль кнопок
  document.querySelectorAll('.report-tab-btn').forEach(btn => {
    const isActive = btn.dataset.tab === tab;
    btn.style.color = isActive ? 'var(--primary-color)' : 'var(--text-secondary)';
    btn.style.borderBottomColor = isActive ? 'var(--primary-color)' : 'transparent';
  });
  // скрываем фильтр периода на вкладке остатков (не зависит от периода)
  const periodBtns = document.getElementById('reportsPeriodBtns');
  if (periodBtns) periodBtns.style.display = tab === 'balance' ? 'none' : '';
  // загружаем нужную вкладку
  loadCurrentReportTab();
     // 🔥 если открыта вкладка Kaspi — перезагружаем данные
    if (currentReportTab === 'kaspi' && typeof loadKaspiData === 'function') {
        loadKaspiData();
    }
};

function loadCurrentReportTab() {
  switch(currentReportTab) {
    case 'cash':    return loadReportCash();
    case 'sales':   return loadReportSales();
    case 'returns': return loadReportReturns();
    case 'stock':   return loadReportStock();
    case 'balance': return loadReportBalance();
    case 'kaspi':   
      if (window.initKaspiReports) window.initKaspiReports();
      return;
  }
}

async function loadReportsStats() {
  if (!COMPANY_ID) return;
  loadCurrentReportTab();
}

window.changePeriod = async function(period) {
  console.log('CHANGE PERIOD:', period);
    currentPeriod = period;
    window.currentPeriod = period;

    const customBlock = document.getElementById('customPeriodBlock');

    // убираем active у всех
    document.querySelectorAll('#section-reports .period-btn')
        .forEach(btn => btn.classList.remove('active'));

    // ставим active текущей кнопке
    if (event && event.target) {
        event.target.classList.add('active');
    }

    // если есть блок — управляем им
    if (customBlock) {
        if (period === 'custom') {
            customBlock.style.display = 'flex';
            return; // отчёт грузим только по OK
        } else {
            customBlock.style.display = 'none';
        }
    }

    loadCurrentReportTab();
    // если открыта вкладка Kaspi — перезагружаем её
if (currentReportTab === 'kaspi' && typeof window.loadKaspiData === 'function') {
    window.loadKaspiData();
}

};

window.applyCustomPeriod = function() {
  currentPeriod = 'custom';
  window.currentPeriod = 'custom';
  loadCurrentReportTab();
};
function getPeriodDates(period) {
  const now = new Date();
  let start = new Date();
  let end = new Date();

  if (period === 'day') {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  }

  if (period === 'week') {
    const day = now.getDay() || 7;
    start = new Date(now);
    start.setDate(now.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);

    end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  }

  if (period === 'month') {
  start = new Date(now.getFullYear(), now.getMonth(), 1);
  start.setHours(0, 0, 0, 0);   // ← ВАЖНО

  end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
}

 if (period === 'custom') {
    const from = document.getElementById('customFrom')?.value
              || document.getElementById('moneyCustomFrom')?.value;
    const to   = document.getElementById('customTo')?.value
              || document.getElementById('moneyCustomTo')?.value;

    start = from ? new Date(from) : new Date();
    end = to ? new Date(to) : new Date();

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  }

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString()
  };
}

// ---- ТАБ 1: Все операции cash_transactions ----
async function loadReportCash() {
  if (!COMPANY_ID) return;
  const { startDate, endDate } = getPeriodDates(currentPeriod);
  const container = document.getElementById('rCashTable');
  if (container) container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Загрузка...</div>';

  try {
    const { data, error } = await supabase
      .from('cash_transactions')
      .select('id, type, amount, comment, created_at, sale_id, payment_methods(name)')
      .eq('company_id', COMPANY_ID)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false });

    if (error) throw error;
    const rows = data || [];

    const income  = rows.filter(r => r.type === 'income');
    const expense = rows.filter(r => r.type === 'expense');
    const incomeSum  = income.reduce((s, r) => s + Number(r.amount), 0);
    const expenseSum = expense.reduce((s, r) => s + Number(r.amount), 0);
    const balance = incomeSum - expenseSum;

    document.getElementById('rCashIncome').textContent      = formatMoney(incomeSum);
    document.getElementById('rCashIncomeCount').textContent = `${income.length} операций`;
    document.getElementById('rCashExpense').textContent      = formatMoney(expenseSum);
    document.getElementById('rCashExpenseCount').textContent = `${expense.length} операций`;
    const balEl = document.getElementById('rCashBalance');
    balEl.textContent = formatMoney(balance);
    balEl.style.color = balance >= 0 ? '#10b981' : '#ef4444';

    if (!rows.length) {
      container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">Нет операций за период</div>';
      return;
    }

    const REASON_LABELS = { income: '📈 Приход', expense: '📉 Расход' };

    container.innerHTML = `
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="border-bottom:2px solid var(--border-color);">
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">ТИП</th>
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">СПОСОБ ОПЛАТЫ</th>
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">КОММЕНТАРИЙ</th>
            <th style="text-align:right;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">СУММА</th>
            <th style="text-align:right;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">ДАТА</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const isIncome = r.type === 'income';
            const color = isIncome ? '#10b981' : '#ef4444';
            const sign  = isIncome ? '+' : '−';
            return `
              <tr style="border-bottom:1px solid var(--border-color);" onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background=''">
                <td style="padding:10px 8px;">
                  <span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;background:transparent;color:${color};border:1px solid ${color};">
                    ${REASON_LABELS[r.type] || r.type}
                  </span>
                </td>
                <td style="padding:10px 8px;color:var(--text-secondary);">${r.payment_methods?.name || '—'}</td>
                <td style="padding:10px 8px;color:var(--text-secondary);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.comment || '—'}</td>
                <td style="padding:10px 8px;text-align:right;font-weight:600;color:${color};">${sign}${formatMoney(r.amount)}</td>
                <td style="padding:10px 8px;text-align:right;color:var(--text-secondary);white-space:nowrap;">${window.formatDate(r.created_at)}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>`;
  } catch(err) {
    console.error('loadReportCash:', err);
    if (container) container.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;">Ошибка: ${err.message}</div>`;
  }
}

// ---- ТАБ 2: Продажи ----
async function loadReportSales() {
  if (!COMPANY_ID) return;
  const { startDate, endDate } = getPeriodDates(currentPeriod);
  const container = document.getElementById('rSalesTable');
  if (container) container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Загрузка...</div>';

  try {
    const { data, error } = await supabase
      .from('sales')
      .select(`
        id, total_amount, operation_at, status, comment,
        discount_percent, discount_amount, source_type,
        payment_methods(name),
        customers(name),
        sale_items(quantity, price, cost_price, products(name))
      `)
      .eq('company_id', COMPANY_ID)
      .is('deleted_at', null)
      .gte('operation_at', startDate)
      .lte('operation_at', endDate)
      .order('operation_at', { ascending: false });

    if (error) throw error;
    const rows = data || [];

    const completed = rows.filter(r => r.status === 'completed' && Number(r.total_amount) > 0);
    const totalSum  = completed.reduce((s, r) => s + Number(r.total_amount), 0);
    const totalDisc = rows.reduce((s, r) => s + Number(r.discount_amount || 0), 0);
    const avg = completed.length ? totalSum / completed.length : 0;

    document.getElementById('rSalesTotal').textContent    = formatMoney(totalSum);
    document.getElementById('rSalesCount').textContent    = `${completed.length} продаж`;
    document.getElementById('rSalesAvg').textContent      = formatMoney(avg);
    document.getElementById('rSalesDiscount').textContent = formatMoney(totalDisc);

    if (!rows.length) {
      container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">Нет продаж за период</div>';
      return;
    }

    const STATUS = { completed: '✅ Завершена', refunded: '↩ Возврат', cancelled: '❌ Отменена' };

    container.innerHTML = `
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="border-bottom:2px solid var(--border-color);">
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">ДАТА</th>
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">ТОВАРЫ</th>
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">КЛИЕНТ</th>
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">ОПЛАТА</th>
            <th style="text-align:right;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">СКИДКА</th>
            <th style="text-align:right;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">СУММА</th>
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">СТАТУС</th>
            <th style="text-align:center;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">УДАЛИТЬ</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const items = r.sale_items?.map(i => `${i.products?.name || '?'} ×${i.quantity}`).join(', ') || '—';
            const disc  = Number(r.discount_amount || 0);
            const isReturn = Number(r.total_amount) < 0;
            const rowColor = '';
            const deleteBtn = r.status === 'completed'
              ? `<button class="btn-delete-sale" onclick="deleteSale('${r.id}')" style="background:transparent;color:#ef4444;border:none;cursor:pointer;font-size:16px;padding:4px;">🗑</button>`
              : '';
            return `
              <tr style="border-bottom:1px solid var(--border-color);background:${rowColor};" onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background='${rowColor}'">
                <td style="padding:10px 8px;color:var(--text-secondary);white-space:nowrap;">${window.formatDate(r.operation_at)}</td>
                <td style="padding:10px 8px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${items}">${items}</td>
                <td style="padding:10px 8px;color:var(--text-secondary);">${r.customers?.name || r.client || '—'}</td>
                <td style="padding:10px 8px;color:var(--text-secondary);">${r.payment_methods?.name || '—'}</td>
                <td style="padding:10px 8px;text-align:right;color:${disc > 0 ? '#f59e0b' : 'var(--text-secondary)'};">${disc > 0 ? '−' + formatMoney(disc) : '—'}</td>
                <td style="padding:10px 8px;text-align:right;font-weight:600;color:${isReturn ? '#ef4444' : 'var(--text-primary)'};">${formatMoney(r.total_amount)}</td>
                <td style="padding:10px 8px;font-size:12px;">${STATUS[r.status] || r.status}</td>
                <td style="padding:10px 8px;text-align:center;">${deleteBtn}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>`;
  } catch(err) {
    console.error('loadReportSales:', err);
    if (container) container.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;">Ошибка: ${err.message}</div>`;
  }
}

window.deleteSale = async function(saleId) {
  if (!confirm('Удалить продажу безвозвратно?')) return;
  const { error } = await supabase.rpc('delete_sale_cascade', {
    p_sale_id: saleId
  });
  if (error) {
    showToast('Ошибка удаления', 'error');
    return;
  }
  showToast('Продажа удалена', 'success');
  loadReportSales();
};

// ---- ТАБ 2.5: Возвраты (refunded/negative sales) ----
async function loadReportReturns() {
  if (!COMPANY_ID) return;
  const { startDate, endDate } = getPeriodDates(currentPeriod);
  const container = document.getElementById('rReturnsTable');
  if (container) container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Загрузка...</div>';

  try {
    const { data, error } = await supabase
      .from('sales')
      .select(`
        id, total_amount, operation_at, status, comment,
        discount_percent, discount_amount, source_type,
        payment_methods(name),
        customers(name),
        sale_items(quantity, price, cost_price, products(name))
      `)
      .eq('company_id', COMPANY_ID)
      .is('deleted_at', null)
      .lt('total_amount', 0)  // Только возвраты (отрицательные суммы)
      .gte('operation_at', startDate)
      .lte('operation_at', endDate)
      .order('operation_at', { ascending: false });

    if (error) throw error;
    const rows = data || [];

    const totalSum = rows.reduce((s, r) => s + Number(r.total_amount), 0);
    const avg = rows.length ? totalSum / rows.length : 0;

    document.getElementById('rReturnsTotal').textContent = formatMoney(Math.abs(totalSum));
    document.getElementById('rReturnsCount').textContent = `${rows.length} возвратов`;
    document.getElementById('rReturnsAvg').textContent = formatMoney(Math.abs(avg));

    if (!rows.length) {
      container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">Нет возвратов за период</div>';
      return;
    }

    container.innerHTML = `
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="border-bottom:2px solid var(--border-color);">
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">ДАТА</th>
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">ТОВАРЫ</th>
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">КЛИЕНТ</th>
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">ОПЛАТА</th>
            <th style="text-align:right;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">СУММА</th>
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">КОММЕНТАРИЙ</th>
            <th style="text-align:center;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">УДАЛИТЬ</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const items = r.sale_items?.map(i => `${i.products?.name || '?'} ×${Math.abs(i.quantity)}`).join(', ') || '—';
            return `
              <tr style="border-bottom:1px solid var(--border-color);" onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background=''">
                <td style="padding:10px 8px;color:var(--text-secondary);white-space:nowrap;">${window.formatDate(r.operation_at)}</td>
                <td style="padding:10px 8px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${items}">${items}</td>
                <td style="padding:10px 8px;color:var(--text-secondary);">${r.customers?.name || r.client || '—'}</td>
                <td style="padding:10px 8px;color:var(--text-secondary);">${r.payment_methods?.name || '—'}</td>
                <td style="padding:10px 8px;text-align:right;font-weight:600;color:#ef4444;">${formatMoney(Math.abs(r.total_amount))}</td>
                <td style="padding:10px 8px;color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${r.comment || ''}">${r.comment || '—'}</td>
                <td style="padding:10px 8px;text-align:center;"><button class="btn-delete-return" onclick="deleteSale('${r.id}')" style="background:transparent;color:#ef4444;border:none;cursor:pointer;font-size:16px;padding:4px;">🗑</button></td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>`;
  } catch(err) {
    console.error('loadReportReturns:', err);
    if (container) container.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;">Ошибка: ${err.message}</div>`;
  }
}

// ---- ТАБ 3: Движение товаров (stock_movements) ----
async function loadReportStock() {
  if (!COMPANY_ID) return;
  const { startDate, endDate } = getPeriodDates(currentPeriod);
  const container = document.getElementById('rStockTable');
  if (container) container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Загрузка...</div>';

  try {
    const { data, error } = await supabase
      .from('stock_movements')
      .select('id, type, reason, quantity, price, comment, operation_at, products(name, sku), warehouses(name)')
      .eq('company_id', COMPANY_ID)
      .is('deleted_at', null)
      .gte('operation_at', startDate)
      .lte('operation_at', endDate)
      .order('operation_at', { ascending: false });

    if (error) throw error;
    const rows = data || [];

    const inRows  = rows.filter(r => r.type === 'in');
    const outRows = rows.filter(r => r.type === 'out');
    const inQty   = inRows.reduce((s, r) => s + Number(r.quantity), 0);
    const outQty  = outRows.reduce((s, r) => s + Number(r.quantity), 0);

    document.getElementById('rStockIn').textContent       = inQty;
    document.getElementById('rStockOut').textContent      = outQty;
    document.getElementById('rStockOpsCount').textContent = rows.length;

    if (!rows.length) {
      container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">Нет движений за период</div>';
      return;
    }

    const REASON_MAP = {
      sale: '🛒 Продажа', purchase: '📥 Приход', refund: '↩ Возврат',
      write_off: '🗑 Списание', supplier_return: '↩️ Возврат поставщику',
      receive: '📥 Приход', writeoff: '🗑 Списание'
    };

    container.innerHTML = `
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="border-bottom:2px solid var(--border-color);">
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">ДАТА</th>
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">ТОВАР</th>
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">ОПЕРАЦИЯ</th>
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">СКЛАД</th>
            <th style="text-align:right;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">КОЛ-ВО</th>
            <th style="text-align:right;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">ЦЕНА</th>
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">КОММЕНТАРИЙ</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const isIn  = r.type === 'in';
            const color = isIn ? '#10b981' : '#ef4444';
            const sign  = isIn ? '+' : '−';
            const label = REASON_MAP[r.reason] || (isIn ? '📥 Приход' : '📤 Расход');
            return `
              <tr style="border-bottom:1px solid var(--border-color);" onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background=''">
                <td style="padding:10px 8px;color:var(--text-secondary);white-space:nowrap;">${window.formatDate(r.operation_at)}</td>
                <td style="padding:10px 8px;font-weight:500;">${r.products?.name || '—'}<br><span style="font-size:11px;color:var(--text-secondary);">${r.products?.sku || ''}</span></td>
                <td style="padding:10px 8px;">
                  <span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;background:transparent;color:${color};border:1px solid ${color};">${label}</span>
                </td>
                <td style="padding:10px 8px;color:var(--text-secondary);">${r.warehouses?.name || '—'}</td>
                <td style="padding:10px 8px;text-align:right;font-weight:600;color:${color};">${sign}${r.quantity}</td>
                <td style="padding:10px 8px;text-align:right;color:var(--text-secondary);">${formatMoney(r.price)}</td>
                <td style="padding:10px 8px;color:var(--text-secondary);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.comment || '—'}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>`;
  } catch(err) {
    console.error('loadReportStock:', err);
    if (container) container.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;">Ошибка: ${err.message}</div>`;
  }
}

// ---- ТАБ 4: Остатки (product_balances) ----
async function loadReportBalance() {
  if (!COMPANY_ID) return;
  const container = document.getElementById('rBalanceTable');
  if (container) container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Загрузка...</div>';

  try {
  const { data, error } = await supabase
  .from('product_balances')
  .select(`
    quantity,
    warehouse_id,
    store_location_id,
    products!inner (
      id,
      name,
      sku,
      purchase_price,
      sale_price,
      company_id,
      active
    ),
    warehouses(name)
  `)
  .eq('products.company_id', COMPANY_ID)
  .gt('quantity', 0);

    if (error) throw error;

    // фильтруем только товары нашей компании через PRODUCTS_CACHE

    const rows = data || [];


    const totalQty   = rows.reduce((s, r) => s + Number(r.quantity), 0);
    const totalValue = rows.reduce((s, r) => s + Number(r.quantity) * Number(r.products?.purchase_price || 0), 0);

    document.getElementById('rBalanceItems').textContent = rows.length;
    document.getElementById('rBalanceQty').textContent   = totalQty;
    document.getElementById('rBalanceValue').textContent = formatMoney(totalValue);

    if (!rows.length) {
      container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">Нет товаров в наличии</div>';
      return;
    }

    // Сортируем по имени
    rows.sort((a, b) => (a.products?.name || '').localeCompare(b.products?.name || ''));

    container.innerHTML = `
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="border-bottom:2px solid var(--border-color);">
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">ТОВАР</th>
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">АРТИКУЛ</th>
            <th style="text-align:left;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">СКЛАД</th>
            <th style="text-align:right;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">ОСТАТОК</th>
            <th style="text-align:right;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">СЕБЕСТ.</th>
            <th style="text-align:right;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">ЦЕНА</th>
            <th style="text-align:right;padding:9px 8px;color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.05em;">СТОИМОСТЬ</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const qty   = Number(r.quantity);
            const cost  = Number(r.products?.purchase_price || 0);
            const price = Number(r.products?.sale_price || 0);
            const total = qty * cost;
            const lowStock = qty <= 3;
            return `
              <tr style="border-bottom:1px solid var(--border-color);" onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background=''">
                <td style="padding:10px 8px;font-weight:500;">${r.products?.name || '—'}</td>
                <td style="padding:10px 8px;color:var(--text-secondary);">${r.products?.sku || '—'}</td>
                <td style="padding:10px 8px;color:var(--text-secondary);">${r.warehouses?.name || '—'}</td>
                <td style="padding:10px 8px;text-align:right;font-weight:700;color:${lowStock ? '#f59e0b' : 'var(--text-primary)'};">
                  ${qty}${lowStock ? ' ⚠️' : ''}
                </td>
                <td style="padding:10px 8px;text-align:right;color:var(--text-secondary);">${formatMoney(cost)}</td>
                <td style="padding:10px 8px;text-align:right;color:var(--text-secondary);">${formatMoney(price)}</td>
                <td style="padding:10px 8px;text-align:right;font-weight:600;">${formatMoney(total)}</td>
              </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--border-color);background:var(--bg-secondary);">
            <td colspan="3" style="padding:10px 8px;font-weight:700;">ИТОГО</td>
            <td style="padding:10px 8px;text-align:right;font-weight:700;">${totalQty}</td>
            <td colspan="2"></td>
            <td style="padding:10px 8px;text-align:right;font-weight:700;">${formatMoney(totalValue)}</td>
          </tr>
        </tfoot>
      </table>
      </div>`;
  } catch(err) {
    console.error('loadReportBalance:', err);
    if (container) container.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;">Ошибка: ${err.message}</div>`;
  }
}

function renderSalesHistory() {} // заглушка — больше не нужна


// =============================================
// СКЛАД - ТАБЛИЦА ОСТАТКОВ
// =============================================
let STOCK_DATA_CACHE = [];

window.loadProductsTable = async function() {
  if (!COMPANY_ID) return;
  
  if (!PRODUCTS_CACHE || PRODUCTS_CACHE.length === 0) {
    await loadInitialData();
  }
  
  const stockData = PRODUCTS_CACHE.map(product => ({
    ...product,
    stock_quantity: Number(product.quantity || 0),
    purchase_price: Number(product.cost_price || 0),
    sale_price: Number(product.base_price || 0)
  }));
  
  renderStockTable(stockData);
};

// Состояние сортировки таблицы склада
let _stockSortCol = null;
let _stockSortDir = 'asc';

function renderStockTable(products) {
  const container = document.getElementById('stockTable');
  if (!container) return;

  if (!products.length) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">Нет товаров на складе</div>';
    return;
  }

  // Сортировка
  let sorted = [...products];
  if (_stockSortCol) {
    sorted.sort((a, b) => {
      let va = a[_stockSortCol], vb = b[_stockSortCol];
      if (_stockSortCol === 'name') {
        va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase();
        return _stockSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      va = Number(va || 0); vb = Number(vb || 0);
      return _stockSortDir === 'asc' ? va - vb : vb - va;
    });
  }

  // Итоги только по товарам
  const goods = products.filter(p => p.type !== 'service');
  const totalQty = goods.reduce((s, p) => s + Number(p.stock_quantity || 0), 0);
  const totalPurchaseSum = goods.reduce((s, p) => s + Number(p.purchase_price || 0) * Number(p.stock_quantity || 0), 0);
  const totalSaleSum = goods.reduce((s, p) => s + Number(p.sale_price || 0) * Number(p.stock_quantity || 0), 0);
  const totalProfit = totalSaleSum - totalPurchaseSum;

  // Иконка сортировки
  const sortIcon = (col) => {
    if (_stockSortCol !== col) return '<span style="opacity:.3;font-size:10px;">⇅</span>';
    return _stockSortDir === 'asc' ? '↑' : '↓';
  };
  const thStyle = (col, align='left') =>
    `style="text-align:${align};cursor:pointer;user-select:none;padding:10px;" onclick="toggleStockSort('${col}')"`;

  container.innerHTML = `
    <div style="padding:12px 0;margin-bottom:12px;display:flex;gap:24px;flex-wrap:wrap;">
      <div>
        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Всего позиций</div>
        <div style="font-size:20px;font-weight:700;color:var(--primary-color);">${totalQty} шт</div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">На сумму (себест.)</div>
        <div style="font-size:20px;font-weight:700;color:#b45309;">${formatMoney(totalPurchaseSum)}</div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">На сумму (продажа)</div>
        <div style="font-size:20px;font-weight:700;color:#059669;">${formatMoney(totalSaleSum)}</div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Потенциальная прибыль</div>
        <div style="font-size:20px;font-weight:700;color:#6d28d9;">${formatMoney(totalProfit)}</div>
      </div>
    </div>
    
    <table class="operations-table">
      <thead>
        <tr style="background:var(--bg-secondary);color:var(--text-secondary);">
          <th ${thStyle('name')}>Название ${sortIcon('name')}</th>
          <th ${thStyle('purchase_price','right')}>Себест. ${sortIcon('purchase_price')}</th>
          <th ${thStyle('sale_price','right')}>Цена ${sortIcon('sale_price')}</th>
          <th ${thStyle('stock_quantity','center')}>Кол-во ${sortIcon('stock_quantity')}</th>
          <th style="text-align:center;padding:10px;width:120px;">Действия</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(product => {
          const purchasePrice = Number(product.purchase_price || 0);
          const salePrice = Number(product.sale_price || 0);
          const quantity = Number(product.stock_quantity || 0);
          const isService = product.type === 'service';
          const isLow = !isService && quantity > 0 && quantity < 2;
          const isZero = !isService && quantity === 0;

          // Цвет строки по остатку
          const rowBg = isZero ? 'background:rgba(239,68,68,0.04);' : isLow ? 'background:rgba(245,158,11,0.04);' : '';

          // Бейдж остатка
          let qtyBadge;
          if (isService) {
            qtyBadge = '<span style="color:var(--text-secondary);">∞</span>';
          } else if (isZero) {
            qtyBadge = '<span style="color:#dc2626;font-weight:700;">0 шт 🔴</span>';
          } else if (isLow) {
            qtyBadge = `<span style="color:#d97706;font-weight:700;">${quantity} шт ⚠️</span>`;
          } else {
            qtyBadge = `<span style="color:#059669;font-weight:600;">${quantity} шт</span>`;
          }

          return `
            <tr style="${rowBg}border-bottom:1px solid var(--border-color);">
              <td style="padding:10px;">
                <div style="font-weight:500;margin-bottom:2px;">${product.name}</div>
                ${product.sku ? `<div style="font-size:11px;color:var(--text-secondary);">Артикул: ${product.sku}</div>` : ''}
                ${isService ? '<div style="font-size:11px;color:var(--text-secondary);">(услуга)</div>' : ''}
              </td>
              <td style="text-align:right;padding:10px;color:var(--text-secondary);">${formatMoney(purchasePrice)}</td>
              <td style="text-align:right;padding:10px;font-weight:600;color:var(--primary-color);">${formatMoney(salePrice)}</td>
              <td style="text-align:center;padding:10px;">${qtyBadge}</td>
              <td style="text-align:center;padding:10px;">
                <div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap;">
                  <button class="btn-icon-sm" onclick="openEditProduct('${product.id}')" title="Редактировать">✏️</button>
                  ${!isService ? `
                    <button class="btn-icon-sm" onclick="quickWriteoff('${product.id}')" title="Списать">📝</button>
                    <button class="btn-icon-sm" onclick="quickSupplierReturn('${product.id}')" title="Возврат поставщику">↩️</button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

window.toggleStockSort = function(col) {
  if (_stockSortCol === col) {
    _stockSortDir = _stockSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    _stockSortCol = col;
    _stockSortDir = 'asc';
  }
  filterStockTable();
};

// =============================================
// БЫСТРОЕ СПИСАНИЕ И ВОЗВРАТ ПОСТАВЩИКУ СО СКЛАДА
// =============================================
let _quickStockAction = { productId: null, actionType: null };

window.quickWriteoff = function(productId) {
  const product = PRODUCTS_CACHE.find(p => p.id === productId);
  if (!product) return;
  
  _quickStockAction = { productId, actionType: 'writeoff' };
  
  document.getElementById('quickStockModalTitle').textContent = 'Списание товара';
  document.getElementById('quickStockProductName').textContent = product.name;
  document.getElementById('quickStockAvailable').textContent = (product.quantity || 0) + ' шт';
  document.getElementById('quickStockQty').value = '';
  document.getElementById('quickStockReason').value = '';
  document.getElementById('quickStockReasonLabel').textContent = 'Причина списания *';
  document.getElementById('quickStockReasonGroup').style.display = 'block';
  document.getElementById('quickStockSubmitBtn').textContent = 'Списать';
  document.getElementById('quickStockSubmitBtn').style.background = '#ef4444';
  
  openModal('quickStockModal');
};

window.quickSupplierReturn = function(productId) {
  const product = PRODUCTS_CACHE.find(p => p.id === productId);
  if (!product) return;
  
  _quickStockAction = { productId, actionType: 'supplier_return' };
  
  document.getElementById('quickStockModalTitle').textContent = 'Возврат поставщику';
  document.getElementById('quickStockProductName').textContent = product.name;
  document.getElementById('quickStockAvailable').textContent = (product.quantity || 0) + ' шт';
  document.getElementById('quickStockQty').value = '';
  document.getElementById('quickStockReason').value = '';
  document.getElementById('quickStockReasonLabel').textContent = 'Комментарий (необязательно)';
  document.getElementById('quickStockReasonGroup').style.display = 'block';
  document.getElementById('quickStockSubmitBtn').textContent = 'Вернуть поставщику';
  document.getElementById('quickStockSubmitBtn').style.background = '#f59e0b';
  
  openModal('quickStockModal');
};

window.submitQuickStockModal = async function() {
  const { productId, actionType } = _quickStockAction;
  if (!productId) return;
  
  const qty = parseInt(document.getElementById('quickStockQty').value);
  const reason = document.getElementById('quickStockReason').value.trim();
  
  if (!qty || qty <= 0) {
    showToast('Укажите количество', 'error');
    return;
  }
  if (actionType === 'writeoff' && !reason) {
    showToast('Укажите причину списания', 'error');
    return;
  }
  
  closeModal('quickStockModal');
  await doQuickStockAction(productId, qty, reason, actionType);
};

async function doQuickStockAction(productId, qty, comment, actionType) {
  try {
    // Берём себестоимость — price > 0 обязателен по constraint БД
    const product = PRODUCTS_CACHE.find(p => p.id === productId);
    const price = product?.purchase_price || product?.cost_price || product?.sale_price || 1;

    const items = [{ product_id: productId, quantity: qty, price }];
    const rpcName = actionType === 'writeoff' ? 'process_writeoff' : 'process_supplier_return';

    const { data, error } = await supabase.rpc(rpcName, {
      p_company_id: COMPANY_ID,
      p_store_location_id: STORE_LOCATION_ID,
      p_warehouse_id: null,
      p_comment: comment || null,
      p_items: items
    });

    if (error) throw error;
    if (!data || data.length === 0 || !data[0].success) {
      throw new Error(data?.[0]?.message || 'Неизвестная ошибка');
    }

    const label = actionType === 'writeoff' ? 'Списание' : 'Возврат поставщику';
    const color = actionType === 'writeoff' ? '#ef4444' : '#f59e0b';
    const icon = actionType === 'writeoff' ? '📝' : '↩️';
    
    if (window.showQuickStockSuccess) {
      window.showQuickStockSuccess(label + ' оформлено', qty, color, icon);
    } else {
      showToast(`✅ ${label}: ${qty} шт`);
    }
    
    await loadInitialData();
    loadProductsTable();
    
  } catch (err) {
    console.error('Quick stock action error:', err);
    if (window.showQuickStockError) {
      window.showQuickStockError('Ошибка операции', err.message || 'Неизвестная ошибка');
    } else {
      showToast('❌ ' + (err.message || 'Ошибка'), 'error');
    }
  }
}

window.filterStockTable = function() {
  const search = document.getElementById('stockSearchInput')?.value.toLowerCase() || '';
  const typeFilter = document.getElementById('stockTypeFilter')?.value || '';
  const statusFilter = document.getElementById('stockStatusFilter')?.value || '';
  
  const filtered = PRODUCTS_CACHE
    .map(p => ({
      ...p,
      stock_quantity: Number(p.quantity || 0),
      purchase_price: Number(p.cost_price || 0),
      sale_price: Number(p.base_price || 0)
    }))
    .filter(p => {
      const matchSearch = !search || 
        (p.name || '').toLowerCase().includes(search) ||
        (p.sku || '').toLowerCase().includes(search) ||
        (p.barcode || '').toLowerCase().includes(search);
      
      const matchType = !typeFilter || p.type === typeFilter;
      
      let matchStatus = true;
      if (statusFilter && p.type !== 'service') {
        const qty = Number(p.stock_quantity || 0);
        if (statusFilter === 'zero') matchStatus = qty === 0;
        else if (statusFilter === 'low') matchStatus = qty > 0 && qty < 2;
        else if (statusFilter === 'ok') matchStatus = qty >= 2;
      }
      
      return matchSearch && matchType && matchStatus;
    });
  
  renderStockTable(filtered);
};

window.openAddNewProductIncome = function() {
  document.getElementById('incomeProductName').value = '';
  document.getElementById('incomeProductSKU').value = '';
  document.getElementById('incomeProductBarcode').value = '';
  document.getElementById('incomeProductCost').value = '';
  document.getElementById('incomeProductPrice').value = '';
  document.getElementById('incomeProductQuantity').value = '';
  
  // Сброс чекбокса и скрытие блока оплаты
  const checkbox = document.getElementById('payToSupplier');
  const paymentBlock = document.getElementById('supplierPaymentBlock');
  if (checkbox) checkbox.checked = false;
  if (paymentBlock) paymentBlock.style.display = 'none';
  
  // Заполняем способы оплаты
  fillSupplierPaymentMethods();
  
  openModal('modalNewProductIncome');
};

// =============================================
// ФУНКЦИЯ ПЕРЕКЛЮЧЕНИЯ БЛОКА ОПЛАТЫ ПОСТАВЩИКУ
// =============================================
window.toggleSupplierPayment = function() {
  const checkbox = document.getElementById('payToSupplier');
  const paymentBlock = document.getElementById('supplierPaymentBlock');
  
  if (checkbox && paymentBlock) {
    if (checkbox.checked) {
      paymentBlock.style.display = 'block';
    } else {
      paymentBlock.style.display = 'none';
    }
  }
};

// =============================================
// ЗАПОЛНЕНИЕ МЕТОДОВ ОПЛАТЫ ДЛЯ ОПЛАТЫ ПОСТАВЩИКУ
// =============================================
function fillSupplierPaymentMethods() {
  const select = document.getElementById('incomeSupplierPaymentMethod');
  console.log('🔍 fillSupplierPaymentMethods вызвана');
  console.log('📦 PAYMENT_METHODS:', PAYMENT_METHODS);
  console.log('🎯 Select element:', select);
  
  if (!select) {
    console.error('❌ Select #incomeSupplierPaymentMethod не найден!');
    return;
  }
  
  // Очищаем текущие опции
  select.innerHTML = '';
  
  // Если нет методов оплаты - показываем сообщение
  if (!PAYMENT_METHODS || PAYMENT_METHODS.length === 0) {
    console.warn('⚠️ PAYMENT_METHODS пустой!');
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Методы оплаты не загружены';
    select.appendChild(option);
    return;
  }
  
  console.log('✅ Найдено методов:', PAYMENT_METHODS.length);
  
  // Добавляем опцию по умолчанию
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Выберите способ оплаты';
  select.appendChild(defaultOption);
  
  // Заполняем из PAYMENT_METHODS
  PAYMENT_METHODS.forEach(method => {
    console.log('➕ Добавляю метод:', method.name, 'id:', method.id);
    const option = document.createElement('option');
    option.value = method.id;
    option.textContent = method.name;
    select.appendChild(option);
  });
  
  // Выбираем первый доступный метод, если он есть
  if (PAYMENT_METHODS.length > 0) {
    select.value = PAYMENT_METHODS[0].id;
    console.log('✅ Выбран метод по умолчанию:', PAYMENT_METHODS[0].name);
  }
  
  console.log('✅ fillSupplierPaymentMethods завершена, опций в select:', select.options.length);
}

// Экспортируем в window для доступа из других модулей
window.fillSupplierPaymentMethods = fillSupplierPaymentMethods;

window.saveNewProductIncome = async function() {
  const name = document.getElementById('incomeProductName').value.trim();
  const sku = document.getElementById('incomeProductSKU').value.trim();
  const barcode = document.getElementById('incomeProductBarcode').value.trim();
  const cost = parseFloat(document.getElementById('incomeProductCost').value) || 0;
  const price = parseFloat(document.getElementById('incomeProductPrice').value) || 0;
  const quantity = parseInt(document.getElementById('incomeProductQuantity').value) || 0;

  // Проверяем чекбокс оплаты
  const shouldPay = document.getElementById('payToSupplier')?.checked || false;
  const paymentMethodId = document.getElementById('incomeSupplierPaymentMethod')?.value;

  if (!name || !sku || !price || quantity <= 0) {
    window.showToast('Заполните все обязательные поля', 'error');
    return;
  }

  // Валидация способа оплаты, если включена оплата
  if (shouldPay && !paymentMethodId) {
    window.showToast('Выберите способ оплаты', 'error');
    return;
  }

  try {
    // Проверяем существование товара с таким SKU
    const { data: existingProduct } = await supabase
      .from('products')
      .select('id, name')
      .eq('company_id', COMPANY_ID)
      .eq('sku', sku)
      .maybeSingle();

    if (existingProduct) {
      window.showToast(`Товар с артикулом "${sku}" уже существует: ${existingProduct.name}`, 'error');
      return;
    }

    const { data: newProduct, error: productError } = await supabase
      .from('products')
      .insert({
        company_id:     COMPANY_ID,
        name:           name,
        sku:            sku,
        barcode:        barcode || null,
        purchase_price: cost,
        sale_price:     price,
        type:           'product'
      })
      .select()
      .single();

    if (productError) throw productError;

    // Определяем куда направить товар
    const destStoreId = await getIncomeDestination();

    await insertIncomeWithTransfer({
      companyId:   COMPANY_ID,
      productId:   newProduct.id,
      quantity,
      price:       cost,
      warehouseId: window.WAREHOUSE_CACHE,
      destStoreId
    });

    // Оплата поставщику — отдельная финансовая операция (расход без sale_id)
    if (shouldPay) {
      const total = quantity * cost;
      const { error: paymentError } = await supabase
        .from('cash_transactions')
        .insert({
          company_id:     COMPANY_ID,
          type:           'expense',
          amount:         total,
          payment_method: paymentMethodId,
          comment:        `Оплата поставщику за ${name}`
        });
      if (paymentError) throw paymentError;
    }

    closeModal('modalNewProductIncome');
    
    const total = quantity * cost;
    if (window.showQuickStockSuccess) {
      window.showQuickStockSuccess('Товар оприходован!', quantity, '#3b82f6', '📦');
    } else {
      window.showToast(`✅ Товар "${name}" создан и оприходован`);
    }
    
    await loadInitialData();
  } catch (error) {
    console.error('Ошибка создания товара:', error);
    if (window.showQuickStockError) {
      window.showQuickStockError('Ошибка создания товара', error.message || 'Неизвестная ошибка');
    } else {
      window.showToast('❌ Ошибка: ' + (error.message || 'Неизвестная ошибка'), 'error');
    }
  }
};

// =============================================
// УСЛУГИ
// =============================================
window.openAddNewServiceIncome = function() {
  const serviceName = prompt('Название услуги:');
  if (!serviceName || !serviceName.trim()) return;
  
  const servicePrice = parseFloat(prompt('Цена услуги (₸):'));
  if (!servicePrice || servicePrice <= 0) {
    alert('Укажите корректную цену');
    return;
  }
  
  createService(serviceName.trim(), servicePrice);
};

async function createService(name, price) {
  try {
    const { data: newService, error } = await supabase
      .from('products')
      .insert({
        company_id:     COMPANY_ID,
        name:           name,
        sku:            'SERVICE-' + Date.now(),
        sale_price:     price,
        purchase_price: 0,
        type:           'service'
      })
      .select()
      .single();
    
    if (error) throw error;
    
    window.showToast(`✅ Услуга "${name}" создана`);
    await loadInitialData();
    
  } catch (error) {
    console.error('Ошибка создания услуги:', error);
    window.showToast('❌ Ошибка: ' + (error.message || 'Неизвестная ошибка'), 'error');
  }
}

// =============================================
// ПОИСК В ПРИХОДЕ
// =============================================
window.filterIncomeProducts = function() {
  const search = document.getElementById('incomeSearchInput')?.value.toLowerCase() || '';
  
  const filtered = PRODUCTS_CACHE.filter(p => {
    return !search || 
      (p.name || '').toLowerCase().includes(search) ||
      (p.sku || '').toLowerCase().includes(search) ||
      (p.barcode || '').toLowerCase().includes(search);
  });
  
  renderIncomeProductsList(filtered);
};

// =============================================
// ДЕНЬГИ / P&L
// =============================================
let currentMoneyPeriod = 'day';

window.changeMoneyPeriod = async function(period) {
  currentMoneyPeriod = period;
  document.querySelectorAll('#section-money .period-btn').forEach(btn => btn.classList.remove('active'));
  if (event && event.target) event.target.classList.add('active');

  const customBlock = document.getElementById('moneyCustomPeriodBlock');
  if (customBlock) {
    if (period === 'custom') {
      customBlock.style.display = 'flex';
      return;
    } else {
      customBlock.style.display = 'none';
    }
  }

  await loadMoneyStats();
};

window.applyMoneyCustomPeriod = async function() {
  currentMoneyPeriod = 'custom';
  await loadMoneyStats();
};

// ---- ВНЕСТИ / СНЯТЬ ДЕНЬГИ ----
let _cashModalType = 'in'; // 'in' | 'out'

window.openCashModal = function(type) {
  _cashModalType = type;
  const isIn = type === 'in';
  document.getElementById('cashModalTitle').textContent = isIn ? '💵 Внести деньги' : '💸 Снять деньги';
  const btn = document.getElementById('cashModalSubmit');
  btn.style.background  = isIn ? '#10b981' : '#ef4444';
  btn.style.borderColor = isIn ? '#10b981' : '#ef4444';
  btn.textContent = isIn ? 'Внести' : 'Снять';
  document.getElementById('cashModalAmount').value  = '';
  document.getElementById('cashModalComment').value = '';
  // Заполняем способы оплаты
  const sel = document.getElementById('cashModalPayment');
  sel.innerHTML = PAYMENT_METHODS.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  openModal('cashModal');
};

window.saveCashOperation = async function() {
  const amount    = parseFloat(document.getElementById('cashModalAmount').value);
  const paymentId = document.getElementById('cashModalPayment').value;
  const comment   = document.getElementById('cashModalComment').value.trim();

  if (!amount || amount <= 0) { showToast('Введите сумму', 'error'); return; }
  if (!paymentId)              { showToast('Выберите способ оплаты', 'error'); return; }

  try {
    const type = _cashModalType === 'in' ? 'income' : 'expense';
    const defaultComment = _cashModalType === 'in' ? 'Внесение наличных' : 'Снятие наличных';
    const { error } = await supabase
      .from('cash_transactions')
      .insert({
        company_id:     COMPANY_ID,
        type,
        amount,
        payment_method: paymentId,
        comment:        comment || defaultComment
      });
    if (error) throw error;

    closeModal('cashModal');
    showToast(_cashModalType === 'in' ? '✅ Деньги внесены' : '✅ Деньги сняты');
    await loadMoneyStats();
  } catch(err) {
    showToast('❌ Ошибка: ' + err.message, 'error');
  }
};

// =============================================
// ЗАГРУЗКА ТЕКУЩЕГО БАЛАНСА ДЕНЕГ
// =============================================
async function loadCashBalance() {
  if (!COMPANY_ID) return;

  try {
    // Получаем все транзакции компании с названиями способов оплаты
    const { data: transactions, error } = await supabase
      .from('cash_transactions')
      .select(`
        type, 
        amount, 
        payment_method,
        payment_methods(name)
      `)
      .eq('company_id', COMPANY_ID);

    if (error) throw error;

    let cashBalance = 0;    // Наличные
    let cardBalance = 0;    // Безнал
    
    console.log('💰 Всего транзакций:', transactions?.length || 0);
    console.log('💰 Первая транзакция (полная):', transactions?.[0]);
    
    (transactions || []).forEach(t => {
      const amount = Number(t.amount) || 0;
      // Получаем название из связанной таблицы payment_methods
      const paymentName = (t.payment_methods?.name || t.payment_method || '').toLowerCase().trim();
      
      console.log(`  Transaction:`, t);
      console.log(`  - type: ${t.type}, amount: ${amount}₸, payment_method: "${t.payment_method}", метод: "${paymentName}"`);
      
      // Определяем тип оплаты - гибкая проверка
      const isCash = 
        paymentName === 'нал' || 
        paymentName === 'наличные' || 
        paymentName === 'наличными' ||
        paymentName === 'cash' ||
        (paymentName.includes('нал') && !paymentName.includes('безнал'));
      
      const isCard = 
        paymentName === 'безнал' || 
        paymentName === 'безналичные' ||
        paymentName === 'безналичными' ||
        paymentName === 'card' ||
        paymentName === 'карта' ||
        paymentName.includes('безнал');
      
      // Прибавляем или вычитаем в зависимости от типа транзакции
      if (t.type === 'in' || t.type === 'sale' || t.type === 'income') {
        // Приход денег
        if (isCash) {
          cashBalance += amount;
        } else if (isCard) {
          cardBalance += amount;
        }
      } else if (t.type === 'out' || t.type === 'expense') {
        // Расход денег
        if (isCash) {
          cashBalance -= amount;
        } else if (isCard) {
          cardBalance -= amount;
        }
      }
    });

    const totalBalance = cashBalance + cardBalance;
    
    console.log('💵 Наличные:', cashBalance);
    console.log('💳 Безнал:', cardBalance);
    console.log('💼 Всего:', totalBalance);

    // Обновляем UI
    const balanceCashEl = document.getElementById('balanceCash');
    const balanceCardEl = document.getElementById('balanceCard');
    const balanceTotalEl = document.getElementById('balanceTotal');

    if (balanceCashEl) {
      balanceCashEl.textContent = formatMoney(cashBalance);
      balanceCashEl.style.color = cashBalance >= 0 ? '#10b981' : '#ef4444';
    }
    if (balanceCardEl) {
      balanceCardEl.textContent = formatMoney(cardBalance);
      balanceCardEl.style.color = cardBalance >= 0 ? '#3b82f6' : '#ef4444';
    }
    if (balanceTotalEl) {
      balanceTotalEl.textContent = formatMoney(totalBalance);
      balanceTotalEl.style.color = totalBalance >= 0 ? '#8b5cf6' : '#ef4444';
    }

  } catch(err) {
    console.error('loadCashBalance error:', err);
  }
}

async function loadMoneyStats() {
  if (!COMPANY_ID) return;

  const { startDate, endDate } = getPeriodDates(currentMoneyPeriod);

  try {
    // НОВОЕ: Загрузка текущего баланса
    await loadCashBalance();

    // 1. Продажи — выручка + себестоимость
    const { data: sales, error: salesErr } = await supabase
      .from('sales')
      .select('total_amount, external_id, kaspi_commission_amount, kaspi_delivery_cost, kaspi_net_amount, sale_items(quantity, price, cost_price)')     .eq('company_id', COMPANY_ID)
      .eq('status', 'completed')
      .gt('total_amount', 0)
      .is('deleted_at', null)
      .gte('operation_at', startDate)
      .lte('operation_at', endDate);
    if (salesErr) throw salesErr;

    let revenue = 0, cost = 0;
    let revenueShop = 0, revenueKaspi = 0;
    let shopCount = 0, kaspiCount = 0;
    (sales || []).forEach(s => {
      const amt = Number(s.total_amount);
      if (s.external_id) {
        const netAmt = Number(s.kaspi_net_amount || 0);
        revenueKaspi += netAmt;
        revenue += netAmt;
        kaspiCount++;
      } else {
        revenueShop += amt;
        revenue += amt;
        shopCount++;
      }
      (s.sale_items || []).forEach(i => {
        cost += Number(i.cost_price || 0) * Number(i.quantity || 0);
      });
    });

    // 2. Расходы из cash_transactions (type=expense, без продажных возвратов)
    const { data: expRows, error: expErr } = await supabase
      .from('cash_transactions')
      .select('amount, comment, payment_methods(name)')
      .eq('company_id', COMPANY_ID)
      .eq('type', 'expense')
      .is('sale_id', null)
      .gte('created_at', startDate)
      .lte('created_at', endDate);
    if (expErr) throw expErr;

    let totalExpenses = 0;
    const catMap = {}; // { "Аренда": 15000, ... }
    (expRows || []).forEach(r => {
      const amt = Number(r.amount);
      totalExpenses += amt;
      // Парсим категорию из comment "Категория: описание"
      const cat = r.comment ? (r.comment.match(/^([^:]+):/) ? r.comment.match(/^([^:]+):/)[1].trim() : r.comment) : 'Прочее';
      catMap[cat] = (catMap[cat] || 0) + amt;
    });

    // 3. Списания из stock_movements (reason=write_off)
    const { data: writeoffRows, error: woErr } = await supabase
      .from('stock_movements')
      .select('quantity, price')
      .eq('company_id', COMPANY_ID)
      .eq('type', 'out')
      .eq('reason', 'write_off')
      .is('deleted_at', null)
      .gte('operation_at', startDate)
      .lte('operation_at', endDate);
    if (woErr) throw woErr;

    const writeoffTotal = (writeoffRows || []).reduce((s, r) => s + Number(r.quantity) * Number(r.price || 0), 0);

    // Расчёты
    const gross     = revenue - cost;
    const opExpenses = writeoffTotal + totalExpenses;
    const operating  = gross - opExpenses;
    const net        = operating;

    // --- Карточки ---
    const mNet = document.getElementById('mNet');
    document.getElementById('mRevenue').textContent      = formatMoney(revenue);
    document.getElementById('mRevenueCount').textContent = `${(sales||[]).length} продаж`;
    
    // Разбивка магазин / Kaspi
    const revenueBreakdown = document.getElementById('revenueBreakdown');
    if (revenueBreakdown) {
      if (kaspiCount > 0) {
        revenueBreakdown.style.display = 'flex';
        document.getElementById('mRevenueShop').textContent = formatMoney(revenueShop);
        document.getElementById('mRevenueShopCount').textContent = `${shopCount} продаж`;
        document.getElementById('mRevenueKaspi').textContent = formatMoney(revenueKaspi);
        document.getElementById('mRevenueKaspiCount').textContent = `${kaspiCount} заказов`;
      } else {
        revenueBreakdown.style.display = 'none';
      }
    }
    document.getElementById('mExpenses').textContent     = formatMoney(totalExpenses);
    document.getElementById('mExpensesCount').textContent = `${(expRows||[]).length} операций`;
    document.getElementById('mCost').textContent         = formatMoney(cost);
    mNet.textContent   = formatMoney(net);
    mNet.style.color   = net >= 0 ? '#10b981' : '#ef4444';

    // --- P&L строки ---
    document.getElementById('plRevenue').textContent  = formatMoney(revenue);
    document.getElementById('plCost').textContent     = formatMoney(cost);
    document.getElementById('plGross').textContent    = formatMoney(gross);
    document.getElementById('plExpenses').textContent = formatMoney(opExpenses);
    document.getElementById('plWriteoff').textContent = formatMoney(writeoffTotal);
    document.getElementById('plOperating').textContent = formatMoney(operating);
    document.getElementById('plNet').textContent       = formatMoney(net);

    // Динамические строки по категориям расходов
    const catsEl = document.getElementById('plExpenseCats');
    if (catsEl) {
      catsEl.innerHTML = Object.entries(catMap)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, amt]) => `
          <div class="pl-row">
            <div style="padding-left:20px;color:var(--text-secondary);">${cat}</div>
            <div>${formatMoney(amt)}</div>
          </div>`)
        .join('');
    }

    // Цвет чистой прибыли в P&L
    const plNetEl = document.getElementById('plNet');
    if (plNetEl) {
      plNetEl.closest('.pl-net').style.background = net >= 0
        ? 'linear-gradient(135deg,#10b981 0%,#059669 100%)'
        : 'linear-gradient(135deg,#ef4444 0%,#dc2626 100%)';
    }

    // --- График (только для неделя/месяц) ---
    renderMoneyChart(startDate, endDate);

  } catch(err) {
    console.error('loadMoneyStats error:', err);
    showToast('❌ Ошибка загрузки: ' + err.message, 'error');
  }
}

async function renderMoneyChart(startDate, endDate) {
  const chartCard = document.getElementById('moneyChartCard');
  const chartEl   = document.getElementById('moneyChart');
  if (!chartCard || !chartEl) return;

  // Показываем только для недели/месяца
  if (currentMoneyPeriod === 'day') { chartCard.style.display = 'none'; return; }
  chartCard.style.display = '';

  try {
    // Загружаем cash_transactions за период для графика
    const { data: cashRows } = await supabase
      .from('cash_transactions')
      .select('type, amount, created_at')
      .eq('company_id', COMPANY_ID)
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    // Группируем по дням
    const byDay = {};
    (cashRows || []).forEach(r => {
      const day = r.created_at.slice(0, 10);
      if (!byDay[day]) byDay[day] = { income: 0, expense: 0 };
      if (r.type === 'income') byDay[day].income += Number(r.amount);
      else byDay[day].expense += Number(r.amount);
    });

    const days = Object.keys(byDay).sort();
    if (!days.length) { chartCard.style.display = 'none'; return; }

    const maxVal = Math.max(...days.map(d => Math.max(byDay[d].income, byDay[d].expense)), 1);
    const BAR_H  = 140;

    chartEl.innerHTML = `
      <div style="display:flex;align-items:flex-end;gap:6px;min-height:${BAR_H + 40}px;padding:0 4px;">
        ${days.map(day => {
          const { income, expense } = byDay[day];
          const iH = Math.round((income  / maxVal) * BAR_H);
          const eH = Math.round((expense / maxVal) * BAR_H);
          const label = new Date(day).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit' });
          return `
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:28px;">
              <div style="width:100%;display:flex;gap:2px;align-items:flex-end;height:${BAR_H}px;">
                <div title="Приход: ${formatMoney(income)}"  style="flex:1;height:${iH}px;background:#10b981;border-radius:3px 3px 0 0;min-height:${income>0?2:0}px;"></div>
                <div title="Расход: ${formatMoney(expense)}" style="flex:1;height:${eH}px;background:#ef4444;border-radius:3px 3px 0 0;min-height:${expense>0?2:0}px;"></div>
              </div>
              <div style="font-size:10px;color:var(--text-secondary);white-space:nowrap;">${label}</div>
            </div>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:16px;margin-top:12px;font-size:12px;">
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:#10b981;border-radius:2px;display:inline-block;"></span> Приход</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:#ef4444;border-radius:2px;display:inline-block;"></span> Расход</span>
      </div>`;
  } catch(e) {
    chartCard.style.display = 'none';
  }
}

// =============================================
// ПОСТАВЩИКИ
// =============================================
async function loadSuppliersTable() {
  if (!COMPANY_ID) return;
  const container = document.getElementById('suppliersTable');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Загрузка...</div>';
  try {
    SUPPLIERS_CACHE = await loadSuppliersFromDB(COMPANY_ID);
    renderSuppliersTable(SUPPLIERS_CACHE);
    fillSupplierDropdowns();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#ef4444;">Ошибка загрузки</div>';
  }
}

function renderSuppliersTable(suppliers) {
  const container = document.getElementById('suppliersTable');
  if (!container) return;
  if (!suppliers.length) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">Поставщики не найдены</div>';
    return;
  }
  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:2px solid var(--border-color);">
          <th style="text-align:left;padding:10px 8px;font-size:12px;color:var(--text-secondary);font-weight:600;letter-spacing:.05em;">НАЗВАНИЕ</th>
          <th style="text-align:left;padding:10px 8px;font-size:12px;color:var(--text-secondary);font-weight:600;letter-spacing:.05em;">КОНТАКТ</th>
          <th style="text-align:left;padding:10px 8px;font-size:12px;color:var(--text-secondary);font-weight:600;letter-spacing:.05em;">КОММЕНТАРИЙ</th>
          <th style="text-align:center;padding:10px 8px;font-size:12px;color:var(--text-secondary);font-weight:600;letter-spacing:.05em;width:80px;">ДЕЙСТВИЯ</th>
        </tr>
      </thead>
      <tbody>
        ${suppliers.map(s => `
          <tr style="border-bottom:1px solid var(--border-color);transition:background .15s;" onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background=''">
            <td style="padding:12px 8px;font-weight:600;">${s.name || '—'}</td>
            <td style="padding:12px 8px;color:var(--text-secondary);">${s.contact || s.phone || '—'}</td>
            <td style="padding:12px 8px;color:var(--text-secondary);font-size:13px;">${s.comment || s.notes || '—'}</td>
            <td style="padding:12px 8px;text-align:center;">
              <button onclick="openEditSupplier('${s.id}')" style="background:none;border:none;cursor:pointer;font-size:16px;" title="Редактировать">✏️</button>
              <button onclick="deleteSupplier('${s.id}', '${(s.name||'').replace(/'/g, "\\'")}')" style="background:none;border:none;cursor:pointer;font-size:16px;margin-left:4px;" title="Удалить">🗑️</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

window.filterSuppliers = function() {
  const q = document.getElementById('supplierSearchInput')?.value.toLowerCase().trim() || '';
  if (!q) { renderSuppliersTable(SUPPLIERS_CACHE); return; }
  renderSuppliersTable(SUPPLIERS_CACHE.filter(s =>
    (s.name||'').toLowerCase().includes(q) ||
    (s.contact||'').toLowerCase().includes(q) ||
    (s.phone||'').toLowerCase().includes(q)
  ));
};

window.openNewSupplier = function() {
  document.getElementById('supplierModalTitle').textContent = 'Новый поставщик';
  document.getElementById('editSupplierId').value = '';
  document.getElementById('supplierName').value = '';
  document.getElementById('supplierContact').value = '';
  document.getElementById('supplierComment').value = '';
  openModal('supplierModal');
};

window.openEditSupplier = function(id) {
  const s = SUPPLIERS_CACHE.find(x => x.id === id);
  if (!s) return;
  document.getElementById('supplierModalTitle').textContent = 'Редактировать поставщика';
  document.getElementById('editSupplierId').value = s.id;
  document.getElementById('supplierName').value = s.name || '';
  document.getElementById('supplierContact').value = s.contact || s.phone || '';
  document.getElementById('supplierComment').value = s.notes || s.comment || '';
  openModal('supplierModal');
};

window.saveSupplier = async function() {
  const id = document.getElementById('editSupplierId').value;
  const name = document.getElementById('supplierName').value.trim();
  const contact = document.getElementById('supplierContact').value.trim();
  const notes = document.getElementById('supplierComment').value.trim();
  if (!name) { showToast('Введите название поставщика', 'error'); return; }
  try {
    if (id) {
      const { error } = await supabase.from('suppliers').update({ name, contact, notes }).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('suppliers').insert({ company_id: COMPANY_ID, name, contact, notes });
      if (error) throw error;
    }
    closeModal('supplierModal');
    showToast('✅ Поставщик сохранён');
    await loadSuppliersTable();
  } catch (err) {
    if (window.showQuickStockError) window.showQuickStockError('Ошибка сохранения', err.message);
    else showToast('❌ ' + err.message, 'error');
  }
};

// Заполняет все дропдауны выбора поставщика (класс supplier-select)
function fillSupplierDropdowns() {
  document.querySelectorAll('.supplier-select').forEach(sel => {
    const current = sel.value;
    sel.innerHTML = '<option value="">— Без поставщика —</option>' +
      SUPPLIERS_CACHE.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    if (current) sel.value = current;
  });
}
window.fillSupplierDropdowns = fillSupplierDropdowns;

window.deleteSupplier = async function(id, name) {
  if (!confirm(`Удалить поставщика "${name}"?\n\nЭто действие нельзя отменить.`)) return;
  try {
    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) {
      if (error.code === '23503') {
        showToast('❌ Нельзя удалить: у поставщика есть связанные документы или движения', 'error');
      } else {
        throw error;
      }
      return;
    }
    SUPPLIERS_CACHE = SUPPLIERS_CACHE.filter(s => s.id !== id);
    renderSuppliersTable(SUPPLIERS_CACHE);
    fillSupplierDropdowns();
    showToast('✅ Поставщик удалён');
  } catch (err) {
    if (window.showQuickStockError) window.showQuickStockError('Ошибка удаления', err.message);
    else showToast('❌ ' + err.message, 'error');
  }
};

// =============================================
// КЛИЕНТЫ
// =============================================
async function loadClientsTable() {
  if (!COMPANY_ID) return;
  const container = document.getElementById('clientsTable');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Загрузка...</div>';
  try {
    CLIENTS_CACHE = await loadClientsFromDB(COMPANY_ID);
    renderClientsTable(CLIENTS_CACHE);
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#ef4444;">Ошибка загрузки</div>';
  }
}

function renderClientsTable(clients) {
  const container = document.getElementById('clientsTable');
  if (!container) return;
  if (!clients.length) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">Клиенты не найдены</div>';
    return;
  }
  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:2px solid var(--border-color);">
          <th style="text-align:left;padding:10px 8px;font-size:12px;color:var(--text-secondary);font-weight:600;letter-spacing:.05em;">ИМЯ</th>
          <th style="text-align:left;padding:10px 8px;font-size:12px;color:var(--text-secondary);font-weight:600;letter-spacing:.05em;">ТЕЛЕФОН</th>
          <th style="text-align:left;padding:10px 8px;font-size:12px;color:var(--text-secondary);font-weight:600;letter-spacing:.05em;">КОММЕНТАРИЙ</th>
          <th style="text-align:center;padding:10px 8px;font-size:12px;color:var(--text-secondary);font-weight:600;letter-spacing:.05em;width:80px;">ДЕЙСТВИЯ</th>
        </tr>
      </thead>
      <tbody>
        ${clients.map(c => `
          <tr style="border-bottom:1px solid var(--border-color);transition:background .15s;" onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background=''">
            <td style="padding:12px 8px;font-weight:600;">${c.name || '—'}</td>
            <td style="padding:12px 8px;color:var(--text-secondary);">${c.phone || '—'}</td>
            <td style="padding:12px 8px;color:var(--text-secondary);font-size:13px;">${c.comment || '—'}</td>
            <td style="padding:12px 8px;text-align:center;">
              <button onclick="openEditClient('${c.id}')" style="background:none;border:none;cursor:pointer;font-size:16px;" title="Редактировать">✏️</button>
              <button onclick="deleteClient('${c.id}', '${(c.name||'').replace(/'/g, "\\'")}')" style="background:none;border:none;cursor:pointer;font-size:16px;margin-left:4px;" title="Удалить">🗑️</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

window.filterClients = function() {
  const q = document.getElementById('clientSearchInput')?.value.toLowerCase().trim() || '';
  if (!q) { renderClientsTable(CLIENTS_CACHE); return; }
  renderClientsTable(CLIENTS_CACHE.filter(c =>
    (c.name||'').toLowerCase().includes(q) ||
    (c.phone||'').toLowerCase().includes(q)
  ));
};

window.openNewClient = function() {
  document.getElementById('clientModalTitle').textContent = 'Новый клиент';
  document.getElementById('editClientId').value = '';
  document.getElementById('newClientName').value = '';
  document.getElementById('newClientPhone').value = '';
  document.getElementById('newClientComment').value = '';
  openModal('newClientModal');
};
window.openNewClientModal = window.openNewClient;

window.openEditClient = function(id) {
  const c = CLIENTS_CACHE.find(x => x.id === id);
  if (!c) return;
  document.getElementById('clientModalTitle').textContent = 'Редактировать клиента';
  document.getElementById('editClientId').value = c.id;
  document.getElementById('newClientName').value = c.name || '';
  document.getElementById('newClientPhone').value = c.phone || '';
  document.getElementById('newClientComment').value = c.comment || '';
  openModal('newClientModal');
};

window.saveNewClient = async function() {
  const id = document.getElementById('editClientId').value;
  const name = document.getElementById('newClientName').value.trim();
  const phone = document.getElementById('newClientPhone').value.trim();
  const comment = document.getElementById('newClientComment').value.trim();
  if (!name) { showToast('Введите имя клиента', 'error'); return; }
  try {
    if (id) {
      const { error } = await supabase.from('customers').update({ name, phone, comment }).eq('id', id);
      if (error) throw error;
    } else {
      await createCustomer(COMPANY_ID, name, phone, comment);
    }
    closeModal('newClientModal');
    showToast('✅ Клиент сохранён');
    await loadClientsTable();
    // Обновляем дропдаун клиентов в форме продажи
    const clientSelect = document.getElementById('clientSelect');
    if (clientSelect) {
      const current = clientSelect.value;
      clientSelect.innerHTML = '<option value="">— Без клиента —</option>' +
        CLIENTS_CACHE.map(c => `<option value="${c.id}">${c.name}${c.phone ? ' · ' + c.phone : ''}</option>`).join('');
      if (current) clientSelect.value = current;
    }
  } catch (err) {
    if (window.showQuickStockError) window.showQuickStockError('Ошибка сохранения', err.message);
    else showToast('❌ ' + err.message, 'error');
  }
};

window.deleteClient = async function(id, name) {
  if (!confirm(`Удалить клиента "${name}"?\n\nЭто действие нельзя отменить.`)) return;
  try {
    const { error } = await supabase.from('customers').update({ active: false }).eq('id', id);
    if (error) throw error;
    CLIENTS_CACHE = CLIENTS_CACHE.filter(c => c.id !== id);
    renderClientsTable(CLIENTS_CACHE);
    // Обновляем дропдаун клиентов в форме продажи
    const clientSelect = document.getElementById('clientSelect');
    if (clientSelect) {
      const current = clientSelect.value;
      clientSelect.innerHTML = '<option value="">— Без клиента —</option>' +
        CLIENTS_CACHE.map(c => `<option value="${c.id}">${c.name}${c.phone ? ' · ' + c.phone : ''}</option>`).join('');
      if (current && current !== id) clientSelect.value = current;
    }
    showToast('✅ Клиент удалён');
  } catch (err) {
    if (window.showQuickStockError) window.showQuickStockError('Ошибка удаления', err.message);
    else showToast('❌ ' + err.message, 'error');
  }
};

window.onClientSelect = function() {
  const clientSelect = document.getElementById('clientSelect');
  if (!clientSelect) return;
  const clientId = clientSelect.value;
  const state = getCurrentState();
  state.selectedClientId = clientId || null;
};

// =============================================
// РАСХОДЫ - ФУНКЦИИ
// =============================================
window.openNewExpense = function() {
  window.openModal('newExpenseModal');
  // Устанавливаем сегодняшнюю дату по умолчанию
  const dateInput = document.getElementById('newExpenseDate');
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.value = today;
  }
};

window.toggleNewCategoryInput = function() {
  const categorySelect = document.getElementById('newExpenseCategory');
  const newCategoryGroup = document.getElementById('newCategoryGroup');
  
  if (categorySelect && newCategoryGroup) {
    if (categorySelect.value === 'new') {
      newCategoryGroup.style.display = 'block';
    } else {
      newCategoryGroup.style.display = 'none';
    }
  }
};

// =============================================
// ПРИХОД - ФУНКЦИИ
// =============================================
window.openAddNewProductIncome = function() {
  // Заполняем дропдаун поставщиков при открытии
  fillSupplierDropdowns();
  document.getElementById('incomeProductSupplier').value = '';
  window.openModal('modalNewProductIncome');
};

// Открыть модал поставщика поверх текущего (не закрывая приход)
window.openNewSupplierInline = function() {
  document.getElementById('supplierModalTitle').textContent = 'Новый поставщик';
  document.getElementById('editSupplierId').value = '';
  document.getElementById('supplierName').value = '';
  document.getElementById('supplierContact').value = '';
  document.getElementById('supplierComment').value = '';
  openModal('supplierModal');
};

window.openAddNewServiceIncome = function() {
  window.openModal('modalNewServiceIncome');
};

window.saveNewServiceIncome = async function() {
  const name = document.getElementById('incomeServiceName')?.value?.trim();
  const sku = document.getElementById('incomeServiceSKU')?.value?.trim();
  const barcode = document.getElementById('incomeServiceBarcode')?.value?.trim() || null;
  const cost = parseFloat(document.getElementById('incomeServiceCost')?.value) || 0;
  const price = parseFloat(document.getElementById('incomeServicePrice')?.value) || 0;

  if (!name) { window.showToast('Введите название услуги', 'error'); return; }
  if (!sku)  { window.showToast('Введите артикул', 'error'); return; }
  if (price <= 0) { window.showToast('Укажите цену продажи', 'error'); return; }

  try {
    const { error } = await supabase
      .from('products')
      .insert({
        company_id: COMPANY_ID,
        name,
        sku,
        barcode,
        sale_price: price,
        purchase_price: cost,
        type: 'service'
      });

    if (error) throw error;

    window.showToast(`✅ Услуга "${name}" добавлена`);
    window.closeModal('modalNewServiceIncome');

    // Сброс формы
    ['incomeServiceName','incomeServiceSKU','incomeServiceBarcode','incomeServiceCost','incomeServicePrice']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

    await loadInitialData();
    window.renderIncomeProductsList && window.renderIncomeProductsList();

  } catch (err) {
    console.error('Ошибка создания услуги:', err);
    window.showToast('❌ Ошибка: ' + (err.message || 'Неизвестная ошибка'), 'error');
  }
};

// =============================================
// СКИДКА - ФУНКЦИИ
// =============================================
window.calculateDiscount = function() {
  const percentInput = document.getElementById('discountPercent');
  const amountInput = document.getElementById('discountAmount');
  const resultText = document.getElementById('discountResultText');
  
  if (!percentInput || !amountInput || !resultText) return;
  
  const percent = parseFloat(percentInput.value) || 0;
  const total = calculateTotal();
  
  if (percent > 0 && percent <= 100) {
    const discountAmount = (total * percent) / 100;
    amountInput.value = Math.round(discountAmount);
    resultText.textContent = formatMoney(discountAmount);
    
    const state = getCurrentState();
    state.discountPercent = percent;
    state.discountAmount = discountAmount;
  } else {
    amountInput.value = '';
    resultText.textContent = '0 ₸';
    
    const state = getCurrentState();
    state.discountPercent = 0;
    state.discountAmount = 0;
  }
  
  updateFinalTotal();
};

window.calculateDiscountReverse = function() {
  const percentInput = document.getElementById('discountPercent');
  const amountInput = document.getElementById('discountAmount');
  const resultText = document.getElementById('discountResultText');
  
  if (!percentInput || !amountInput || !resultText) return;
  
  const amount = parseFloat(amountInput.value) || 0;
  const total = calculateTotal();
  
  if (amount > 0 && amount <= total) {
    const percent = (amount / total) * 100;
    percentInput.value = percent.toFixed(2);
    resultText.textContent = formatMoney(amount);
    
    const state = getCurrentState();
    state.discountPercent = percent;
    state.discountAmount = amount;
  } else {
    percentInput.value = '';
    resultText.textContent = '0 ₸';
    
    const state = getCurrentState();
    state.discountPercent = 0;
    state.discountAmount = 0;
  }
  
  updateFinalTotal();
};

function updateFinalTotal() {
  // Просто перерисовываем корзину, которая уже учитывает скидку
  if (window.renderCart) {
    window.renderCart();
  }
}
// =============================================
// СОЗДАНИЕ СКЛАДА
// =============================================
window.createWarehouse = async function () {
  if (!window.COMPANY_ID) {
    alert('Компания не определена');
    return;
  }

  const name = prompt('Название склада:');
  if (!name) return;

  try {
    const { data, error } = await supabase
      .from('warehouses')
      .insert({
        company_id: window.COMPANY_ID,
        name: name
      })
      .select()
      .single();

    if (error) throw error;

    window.WAREHOUSE_CACHE = data.id;
    window.WAREHOUSE_NAME = data.name;
    
    displayWarehouseName();

    alert('✅ Склад создан и выбран');

  } catch (err) {
    console.error(err);
    alert('❌ Ошибка: ' + err.message);
  }
};


// =============================================
// РАСХОДЫ - ФУНКЦИИ
// =============================================
let currentExpensePeriod = 'day';

window.changeExpensePeriod = async function(period) {
  currentExpensePeriod = period;
  document.querySelectorAll('#section-expenses .period-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  if (event && event.target) event.target.classList.add('active');
  await loadExpenseStats();
};

async function loadExpenseStats() {
  if (!COMPANY_ID) return;
  const { startDate, endDate } = getPeriodDates(currentExpensePeriod);

  try {
    const data = await loadExpensesFromDB(COMPANY_ID, startDate, endDate);

    const total = data.reduce((sum, e) => sum + Number(e.amount), 0);
    const countEl = document.getElementById('statExpensesCount');
    const totalEl = document.getElementById('statExpenses');
    if (countEl) countEl.textContent = `${data.length} операций`;
    if (totalEl) totalEl.textContent = formatMoney(total);

    const historyEl = document.getElementById('expensesHistory');
    if (!historyEl) return;

    if (!data.length) {
      historyEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Нет расходов за период</div>';
      return;
    }

    historyEl.innerHTML = data.map(exp => `
      <div class="history-item" style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-color);">
        <div>
          <div style="font-weight:500;">${exp.expense_categories?.name || '—'}</div>
          <div style="font-size:12px;color:var(--text-secondary);">${exp.description || ''} · ${new Date(exp.operation_at).toLocaleDateString('ru-RU', {day:'2-digit',month:'2-digit',year:'numeric'})}</div>
        </div>
        <div style="font-weight:600;color:#ef4444;">−${formatMoney(exp.amount)}</div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error loading expenses:', err);
    window.showToast('❌ Ошибка загрузки расходов', 'error');
  }
}

window.saveNewExpense = async function() {
  const categorySelect = document.getElementById('newExpenseCategory');
  const newCategoryNameInput = document.getElementById('newCategoryName');
  const amountInput = document.getElementById('newExpenseAmount');
  const descriptionInput = document.getElementById('newExpenseDescription');
  const dateInput = document.getElementById('newExpenseDate');

  const categoryValue = categorySelect?.value;
  const amount = parseFloat(amountInput?.value);
  const description = descriptionInput?.value?.trim() || '';
  const date = dateInput?.value;

  if (!categoryValue) {
    window.showToast('Выберите категорию', 'error');
    return;
  }

  let categoryName;
  if (categoryValue === 'new') {
    categoryName = newCategoryNameInput?.value?.trim();
    if (!categoryName) {
      window.showToast('Введите название категории', 'error');
      return;
    }
  } else {
    categoryName = EXPENSE_CATEGORIES[categoryValue] || categoryValue;
  }

  if (!amount || amount <= 0) {
    window.showToast('Введите сумму', 'error');
    return;
  }

  if (!date) {
    window.showToast('Укажите дату', 'error');
    return;
  }

  try {
    // Берём выбранную дату + текущее локальное время (иначе new Date("2026-02-10") = UTC полночь)
    const [ey, em, ed] = date.split("-").map(Number);
    const enow = new Date();
    const localDate = new Date(ey, em - 1, ed, enow.getHours(), enow.getMinutes(), enow.getSeconds());
    await createExpense(COMPANY_ID, categoryName, amount, description, localDate.toISOString());
    window.showToast('✅ Расход добавлен');
    window.closeModal('newExpenseModal');

    // Сброс формы
    if (categorySelect) categorySelect.value = '';
    if (amountInput) amountInput.value = '';
    if (descriptionInput) descriptionInput.value = '';
    if (newCategoryNameInput) newCategoryNameInput.value = '';
    document.getElementById('newCategoryGroup').style.display = 'none';

    await loadExpenseStats();
  } catch (err) {
    console.error('Error saving expense:', err);
    window.showToast('❌ Ошибка сохранения расхода: ' + err.message, 'error');
  }
};


// =============================================
// РЕДАКТИРОВАНИЕ ТОВАРА СО СКЛАДА
// =============================================
window.openEditProduct = function(productId) {
  const product = PRODUCTS_CACHE.find(p => p.id === productId);
  if (!product) return;

  document.getElementById('editProductId').value      = product.id;
  document.getElementById('editProductName').value    = product.name || '';
  document.getElementById('editProductSku').value     = product.sku  || '';
  document.getElementById('editProductBarcode').value = product.barcode || '';
  document.getElementById('editProductPurchase').value = product.cost_price  || product.purchase_price || 0;
  document.getElementById('editProductSale').value    = product.base_price   || product.sale_price     || 0;
  document.getElementById('editProductUnit').value    = product.unit    || 'шт';
  document.getElementById('editProductComment').value = product.comment || '';

  openModal('editProductModal');
};

window.saveEditProduct = async function() {
  const id      = document.getElementById('editProductId').value;
  const name    = document.getElementById('editProductName').value.trim();
  const sku     = document.getElementById('editProductSku').value.trim();
  const barcode = document.getElementById('editProductBarcode').value.trim();
  const purchase = parseFloat(document.getElementById('editProductPurchase').value) || 0;
  const sale     = parseFloat(document.getElementById('editProductSale').value)     || 0;
  const unit     = document.getElementById('editProductUnit').value.trim()    || 'шт';
  const comment  = document.getElementById('editProductComment').value.trim() || null;

  if (!name) { showToast('Введите название', 'error'); return; }
  if (sale < 0 || purchase < 0) { showToast('Цены не могут быть отрицательными', 'error'); return; }

  try {
    const { error } = await supabase
      .from('products')
      .update({
        name,
        sku:            sku     || null,
        barcode:        barcode || null,
        purchase_price: purchase,
        sale_price:     sale,
        unit,
        comment,
      })
      .eq('id', id);

    if (error) throw error;

    closeModal('editProductModal');
    showToast('✅ Товар обновлён');

    // Обновляем кеш и таблицу без полной перезагрузки
    const idx = PRODUCTS_CACHE.findIndex(p => p.id === id);
    if (idx !== -1) {
      PRODUCTS_CACHE[idx] = {
        ...PRODUCTS_CACHE[idx],
        name, sku, barcode, purchase_price: purchase,
        cost_price: purchase, sale_price: sale, base_price: sale,
        unit, comment,
      };
    }
    loadProductsTable();
    renderIncomeProductsList && renderIncomeProductsList();

  } catch (err) {
    if (window.showQuickStockError) window.showQuickStockError('Ошибка сохранения', err.message);
    else showToast('❌ ' + err.message, 'error');
  }
};

// =============================================
// УДАЛЕНИЕ ТОВАРА (мягкое — active = false)
// =============================================
window.deleteProduct = async function(productId, productName) {
  if (!confirm(`Удалить товар "${productName}"?\n\nТовар будет скрыт из каталога. История продаж сохранится.`)) {
    return;
  }

  try {
    const { error } = await supabase
      .from('products')
      .update({ active: false })
      .eq('id', productId);

    if (error) throw error;

    showToast('✅ Товар удалён');

    // Убираем из кеша
    PRODUCTS_CACHE = PRODUCTS_CACHE.filter(p => p.id !== productId);
    window.PRODUCTS_CACHE = PRODUCTS_CACHE;

    // Обновляем таблицу
    loadProductsTable();
    if (typeof renderIncomeProductsList === 'function') renderIncomeProductsList();

  } catch (err) {
    console.error('Delete product error:', err);
    showToast('❌ Ошибка: ' + (err.message || 'Неизвестная ошибка'), 'error');
  }
};

// Запуск приложения
init();
// ═══════════════════════════════════════════════════════════════════
// УЛУЧШЕННЫЕ ФУНКЦИИ ДЛЯ ВКЛАДОК ТОВАРЫ/ОСТАТКИ/ПРИХОД
// ═══════════════════════════════════════════════════════════════════

// Переключение вкладок
window.switchProductsTab = function(tabName) {
  console.log('📍 switchProductsTab:', tabName);
  
  // Переключаем кнопки вкладок
  document.querySelectorAll('.trading-tabs .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  
  // Переключаем контент вкладок
  document.querySelectorAll('.trading-tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabName}`);
  });
  
  // Загружаем данные для активной вкладки
  if (tabName === 'catalog') {
    loadCatalogTable();
  } else if (tabName === 'stock') {
    loadStockTable();
  } else if (tabName === 'income') {
    loadIncomeTable();
  } else if (tabName === 'transfer') {
    loadTransferTab();
  } else if (tabName === 'warehouse') {
    loadWarehouseTab();
  }
};

// Вкладка ТОВАРЫ (каталог)
window.loadCatalogTable = async function() {
  if (!COMPANY_ID) return;
  
  if (!PRODUCTS_CACHE || PRODUCTS_CACHE.length === 0) {
    await loadInitialData();
  }
  
  renderCatalogTable(PRODUCTS_CACHE);
};

function renderCatalogTable(products) {
  const container = document.getElementById('catalogTable');
  if (!container) return;
  
  if (!products.length) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">Нет товаров в каталоге</div>';
    return;
  }
  
  container.innerHTML = `
    <table class="products-table-full">
      <thead>
        <tr style="background:var(--bg-secondary);color:var(--text-secondary);">
          <th style="text-align:left;padding:10px;">Название</th>
          <th style="text-align:left;width:100px;">Артикул</th>
          <th style="text-align:center;width:80px;">Тип</th>
          <th style="text-align:right;width:110px;">Себестоимость</th>
          <th style="text-align:right;width:110px;">Цена продажи</th>
          <th style="text-align:center;width:100px;">Остаток</th>
          <th style="text-align:center;width:100px;">Действия</th>
        </tr>
      </thead>
      <tbody>
        ${products.map(product => {
          const isService = product.type === 'service';
          const quantity = Number(product.quantity || 0);
          const isLow = !isService && quantity > 0 && quantity < 2;
          const isZero = !isService && quantity === 0;
          
          // Цвет остатка
          let qtyBadge = quantity + ' шт';
          if (isService) {
            qtyBadge = '<span style="color:var(--text-secondary);">∞</span>';
          } else if (isZero) {
            qtyBadge = '<span style="color:#dc2626;font-weight:600;">0 🔴</span>';
          } else if (isLow) {
            qtyBadge = `<span style="color:#d97706;font-weight:600;">${quantity} ⚠️</span>`;
          } else {
            qtyBadge = `<span style="color:#059669;font-weight:500;">${quantity}</span>`;
          }
          
          return `
            <tr style="border-bottom:1px solid var(--border-color);">
              <td style="padding:10px;">
                <div style="font-weight:500;margin-bottom:2px;">${product.name}</div>
                ${product.barcode ? `<div style="font-size:11px;color:var(--text-secondary);">📊 ${product.barcode}</div>` : ''}
              </td>
              <td style="color:var(--text-secondary);font-size:13px;">${product.sku || '—'}</td>
              <td style="text-align:center;">
                <span class="type-badge ${isService ? 'type-service' : 'type-product'}">
                  ${isService ? '🔧 Услуга' : '📦 Товар'}
                </span>
              </td>
              <td style="text-align:right;color:var(--text-secondary);">${formatMoney(product.cost_price || 0)}</td>
              <td style="text-align:right;font-weight:600;color:var(--primary-color);">${formatMoney(product.base_price || 0)}</td>
              <td style="text-align:center;">${qtyBadge}</td>
              <td style="text-align:center;">
                <div style="display:flex;gap:4px;justify-content:center;">
                  <button class="btn-icon-sm" onclick="openEditProduct('${product.id}')" title="Редактировать">
                    ✏️
                  </button>
                  ${!isService ? `
                    <button class="btn-icon-sm" onclick="openQuickIncome('${product.id}')" title="Оприходовать">
                      ⬇️
                    </button>
                  ` : ''}
                  <button class="btn-icon-sm" onclick="deleteProduct('${product.id}', '${product.name.replace(/'/g, "\\'")}')" title="Удалить" style="color:#ef4444;">
                    🗑️
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

window.filterCatalogTable = function() {
  const search = document.getElementById('catalogSearchInput')?.value.toLowerCase() || '';
  const typeFilter = document.getElementById('catalogTypeFilter')?.value || '';
  
  const filtered = PRODUCTS_CACHE.filter(p => {
    const matchSearch = !search || 
      (p.name || '').toLowerCase().includes(search) ||
      (p.sku || '').toLowerCase().includes(search) ||
      (p.barcode || '').toLowerCase().includes(search);
    
    const matchType = !typeFilter || p.type === typeFilter;
    
    return matchSearch && matchType;
  });
  
  renderCatalogTable(filtered);
};

// Вкладка ОСТАТКИ
window.loadStockTable = async function() {
  await window.loadProductsTable();
};

// Вкладка ПРИХОД
window.loadIncomeTable = async function() {
  if (!COMPANY_ID) return;
  
  if (!PRODUCTS_CACHE || PRODUCTS_CACHE.length === 0) {
    await loadInitialData();
  }
  
  renderIncomeProductsList(PRODUCTS_CACHE);
};

// ─── СОЗДАНИЕ НОВОГО ТОВАРА/УСЛУГИ ────────────────────────────────────────
window.toggleProductQuantityField = function() {
  const isService = document.getElementById('productTypeService').checked;
  const quantityGroup = document.getElementById('newProductQuantityGroup');
  if (quantityGroup) {
    quantityGroup.style.display = isService ? 'none' : 'block';
  }
};

window.openNewProduct = function(type = 'product') {
  // Очищаем форму
  document.getElementById('newProductName').value = '';
  document.getElementById('newProductSKU').value = '';
  document.getElementById('newProductBarcode').value = '';
  document.getElementById('newProductPurchase').value = '0';
  document.getElementById('newProductSale').value = '0';
  document.getElementById('newProductQuantity').value = '0';
  
  // Устанавливаем тип
  if (type === 'service') {
    document.getElementById('productTypeService').checked = true;
    // Скрываем поле количества для услуг
    document.getElementById('newProductQuantityGroup').style.display = 'none';
  } else {
    document.getElementById('productTypeProduct').checked = true;
    // Показываем поле количества для товаров
    document.getElementById('newProductQuantityGroup').style.display = 'block';
  }
  
  // Сбрасываем кнопку при открытии
  const btn = document.getElementById('btnSaveNewProduct');
  if (btn) { btn.textContent = 'Сохранить'; btn.disabled = false; }

  openModal('modalNewProduct');
};

window.saveNewProduct = async function() {
  const btn = document.getElementById('btnSaveNewProduct');
  const originalText = btn ? btn.textContent : 'Сохранить';
  if (btn) { btn.disabled = true; btn.textContent = 'Сохранение...'; }

  const name = document.getElementById('newProductName').value.trim();
  const sku = document.getElementById('newProductSKU').value.trim();
  const barcode = document.getElementById('newProductBarcode').value.trim();
  const purchase = parseFloat(document.getElementById('newProductPurchase').value) || 0;
  const sale = parseFloat(document.getElementById('newProductSale').value) || 0;
  const quantity = parseInt(document.getElementById('newProductQuantity').value) || 0;
  const type = document.getElementById('productTypeService').checked ? 'service' : 'product';

  if (!name) { 
    showToast('Введите название товара', 'error'); 
    return; 
  }
  if (!sku) { 
    showToast('Введите артикул (SKU)', 'error'); 
    return; 
  }
  if (sale <= 0) { 
    showToast('Цена продажи должна быть больше 0', 'error'); 
    return; 
  }
  if (purchase < 0 || sale < 0) { 
    showToast('Цены не могут быть отрицательными', 'error'); 
    return; 
  }
  if (quantity < 0) {
    showToast('Количество не может быть отрицательным', 'error');
    return;
  }

  try {
    // ШАГ 1: Создаём товар
    const { data, error } = await supabase
      .from('products')
      .insert({
        company_id: COMPANY_ID,
        name,
        sku,
        barcode: barcode || null,
        type,
        purchase_price: purchase,
        sale_price: sale,
        unit: 'шт',
        active: true,
      })
      .select()
      .single();

    if (error) throw error;

    // ШАГ 2: Если есть количество и это товар (не услуга) - оприходуем
    if (quantity > 0 && type === 'product') {
      try {
        // Определяем куда направить товар
        const destStoreId = await getIncomeDestination();

        await insertIncomeWithTransfer({
          companyId:   COMPANY_ID,
          productId:   data.id,
          quantity:    Number(quantity),
          price:       Number(purchase),
          warehouseId: window.WAREHOUSE_CACHE,
          destStoreId
        });
      } catch (rpcErr) {
        console.warn('Ошибка прихода:', rpcErr);
      }
    }

    closeModal('modalNewProduct');
    await loadInitialData();

    if (quantity > 0 && type === 'product') {
      if (window.showQuickStockSuccess) {
        window.showQuickStockSuccess(`Товар создан и оприходован`, quantity, '#3b82f6', '📦');
      } else {
        window.showToast(`✅ Товар создан и оприходовано ${quantity} шт`);
      }
    } else {
      window.showToast(`✅ ${type === 'service' ? 'Услуга' : 'Товар'} создан`);
    }

    // Обновляем таблицу (loadInitialData уже вызван выше)
    if (window.loadProductsTable) loadProductsTable();
    if (window.renderIncomeProductsList) renderIncomeProductsList();

  } catch (err) {
    console.error('Error creating product:', err);
    showToast('❌ ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
};

// Функция открытия создания услуги
window.openNewService = function() {
  openNewProduct('service');
};
// =============================================
// ВКЛАДКА ПЕРЕМЕЩЕНИЕ
// =============================================

let transferState = {
  sourceId: null,
  sourceType: null, // 'warehouse' или 'store'
  destId: null,
  destType: null,
  products: [],
  selectedProducts: new Map() // productId -> quantity
};

// Загрузка вкладки перемещения
async function loadTransferTab() {
  console.log('📦 Загрузка вкладки перемещения');
  await loadTransferLocations();
}

// Загрузка локаций в селекты
async function loadTransferLocations() {
  try {
    // Загружаем склады
    const { data: warehouses, error: whError } = await supabase
      .from('warehouses')
      .select('id, name')
      .eq('company_id', COMPANY_ID)
      .order('name');
    
    // Загружаем магазины
    const { data: stores, error: stError } = await supabase
      .from('store_locations')
      .select('id, name')
      .eq('company_id', COMPANY_ID)
      .order('name');
    
    if (whError) throw whError;
    if (stError) throw stError;
    
    const sourceSelect = document.getElementById('transferSourceSelect');
    const destSelect = document.getElementById('transferDestSelect');
    
    if (!sourceSelect || !destSelect) return;
    
    // Формируем опции
    let options = '<option value="">Выберите локацию...</option>';
    
    if (warehouses && warehouses.length > 0) {
      warehouses.forEach(wh => {
        options += `<option value="warehouse:${wh.id}">🏭 ${wh.name}</option>`;
      });
    }
    
    if (stores && stores.length > 0) {
      stores.forEach(store => {
        options += `<option value="store:${store.id}">🏪 ${store.name}</option>`;
      });
    }
    
    sourceSelect.innerHTML = options;
    destSelect.innerHTML = options;
    
    // Обработчик выбора источника
    sourceSelect.onchange = async () => {
      const value = sourceSelect.value;
      if (!value) {
        transferState.sourceId = null;
        transferState.sourceType = null;
        transferState.products = [];
        transferState.selectedProducts.clear();
        renderTransferProducts();
        updateTransferUI();
        return;
      }
      
      const [type, id] = value.split(':');
      transferState.sourceId = id;
      transferState.sourceType = type;
      
      // Обновляем опции назначения (убираем выбранный источник)
      updateDestinationOptions();
      
      // Загружаем товары
      await loadTransferProducts();
    };
    
    // Обработчик выбора назначения
    destSelect.onchange = () => {
      const value = destSelect.value;
      if (!value) {
        transferState.destId = null;
        transferState.destType = null;
      } else {
        const [type, id] = value.split(':');
        transferState.destId = id;
        transferState.destType = type;
      }
      updateTransferUI();
    };
    
  } catch (err) {
    console.error('Ошибка загрузки локаций:', err);
    showToast('❌ Ошибка загрузки локаций', 'error');
  }
}

// Обновление опций назначения
function updateDestinationOptions() {
  const sourceSelect = document.getElementById('transferSourceSelect');
  const destSelect = document.getElementById('transferDestSelect');
  
  if (!sourceSelect || !destSelect) return;
  
  const sourceValue = sourceSelect.value;
  
  // Копируем все опции кроме выбранной в источнике
  let newOptions = '<option value="">Выберите локацию...</option>';
  
  Array.from(sourceSelect.options).forEach(option => {
    if (option.value && option.value !== sourceValue) {
      newOptions += `<option value="${option.value}">${option.text}</option>`;
    }
  });
  
  const currentDestValue = destSelect.value;
  destSelect.innerHTML = newOptions;
  
  // Восстанавливаем выбор если он валиден
  if (currentDestValue && currentDestValue !== sourceValue) {
    destSelect.value = currentDestValue;
  }
}

// Загрузка товаров с остатками из источника
async function loadTransferProducts() {
  if (!transferState.sourceId || !transferState.sourceType) {
    transferState.products = [];
    renderTransferProducts();
    return;
  }
  
  try {
    const whereField = transferState.sourceType === 'warehouse' ? 'warehouse_id' : 'store_location_id';
    
    const { data, error } = await supabase
      .from('product_balances')
      .select('product_id, quantity, products(id, name, sku, barcode, sale_price, company_id)')
      .eq(whereField, transferState.sourceId)
      .gt('quantity', 0);
    
    if (error) throw error;
    
    // Фильтруем только товары нашей компании
    const filtered = (data || []).filter(item => 
      item.products && item.products.company_id === COMPANY_ID
    );
    
    transferState.products = filtered.map(item => ({
      id: item.product_id,
      name: item.products.name,
      sku: item.products.sku || '—',
      barcode: item.products.barcode || '—',
      price: item.products.sale_price || 0,
      balance: item.quantity
    }));
    
    renderTransferProducts();
    
  } catch (err) {
    console.error('Ошибка загрузки товаров:', err);
    showToast('❌ Ошибка загрузки товаров', 'error');
  }
}

// Рендер таблицы товаров
function renderTransferProducts() {
  const container = document.getElementById('transferProductsTable');
  if (!container) return;
  
  if (!transferState.products.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px;color:#9ca3af;font-size:14px;">
        ${transferState.sourceId ? '📦 Нет товаров с остатком в выбранной локации' : '👆 Выберите локацию "Откуда" для загрузки товаров'}
      </div>
    `;
    document.getElementById('transferSelectAllBtn').style.display = 'none';
    document.getElementById('transferDeselectAllBtn').style.display = 'none';
    return;
  }
  
  // Показываем кнопки массового выбора
  document.getElementById('transferSelectAllBtn').style.display = 'inline-block';
  document.getElementById('transferDeselectAllBtn').style.display = 'inline-block';
  
  const searchTerm = document.getElementById('transferSearchInput').value.toLowerCase();
  const filteredProducts = transferState.products.filter(p => 
    p.name.toLowerCase().includes(searchTerm) ||
    p.sku.toLowerCase().includes(searchTerm) ||
    p.barcode.toLowerCase().includes(searchTerm)
  );
  
  container.innerHTML = `
    <table class="products-table-full" style="width:100%;">
      <thead>
        <tr style="background:var(--bg-secondary);">
          <th style="width:40px;padding:10px;text-align:center;">
            <input type="checkbox" id="transferCheckAll" onchange="toggleAllTransferProducts(this.checked)">
          </th>
          <th style="text-align:left;padding:10px;">Товар</th>
          <th style="text-align:left;padding:10px;width:120px;">Артикул</th>
          <th style="text-align:right;padding:10px;width:100px;">Остаток</th>
          <th style="text-align:center;padding:10px;width:140px;">Количество</th>
        </tr>
      </thead>
      <tbody>
        ${filteredProducts.map(p => {
          const isSelected = transferState.selectedProducts.has(p.id);
          const quantity = transferState.selectedProducts.get(p.id) || '';
          return `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:10px;text-align:center;">
                <input type="checkbox" 
                  ${isSelected ? 'checked' : ''} 
                  onchange="toggleTransferProduct('${p.id}', this.checked)">
              </td>
              <td style="padding:10px;">
                <div style="font-weight:600;">${p.name}</div>
              </td>
              <td style="padding:10px;color:var(--text-secondary);">${p.sku}</td>
              <td style="padding:10px;text-align:right;font-weight:600;">${p.balance}</td>
              <td style="padding:10px;text-align:center;">
                <input type="number" 
                  id="qty-${p.id}"
                  class="input" 
                  style="width:100%;text-align:center;padding:6px;" 
                  min="1" 
                  step="1"
                  max="${p.balance}"
                  value="${quantity}"
                  placeholder="0"
                  onchange="updateTransferQuantity('${p.id}', this.value, ${p.balance})">
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// Переключение всех товаров
window.toggleAllTransferProducts = function(checked) {
  if (checked) {
    // Выбираем все
    transferState.products.forEach(p => {
      if (!transferState.selectedProducts.has(p.id)) {
        transferState.selectedProducts.set(p.id, p.balance);
      }
    });
  } else {
    // Снимаем все
    transferState.selectedProducts.clear();
  }
  renderTransferProducts();
  updateTransferUI();
};

// Переключение одного товара
window.toggleTransferProduct = function(productId, checked) {
  if (checked) {
    const product = transferState.products.find(p => p.id === productId);
    if (product) {
      transferState.selectedProducts.set(productId, product.balance);
      // Устанавливаем значение в поле
      const input = document.getElementById(`qty-${productId}`);
      if (input) input.value = product.balance;
    }
  } else {
    transferState.selectedProducts.delete(productId);
  }
  updateTransferUI();
};

// Обновление количества
window.updateTransferQuantity = function(productId, value, maxBalance) {
  const qty = parseFloat(value) || 0;
  
  if (qty <= 0) {
    transferState.selectedProducts.delete(productId);
    const checkbox = document.querySelector(`input[onchange*="toggleTransferProduct('${productId}"`);
    if (checkbox) checkbox.checked = false;
  } else if (qty > maxBalance) {
    showToast(`❌ Количество не может быть больше остатка (${maxBalance})`, 'error');
    document.getElementById(`qty-${productId}`).value = maxBalance;
    transferState.selectedProducts.set(productId, maxBalance);
  } else {
    transferState.selectedProducts.set(productId, qty);
    const checkbox = document.querySelector(`input[onchange*="toggleTransferProduct('${productId}"`);
    if (checkbox) checkbox.checked = true;
  }
  
  updateTransferUI();
};

// Обновление UI (счетчики, кнопка)
function updateTransferUI() {
  const selectedBlock = document.getElementById('transferSelectedBlock');
  const selectedList = document.getElementById('transferSelectedList');
  const selectedCount = document.getElementById('transferSelectedCount');
  const executeBtn = document.getElementById('executeTransferBtn');
  
  const count = transferState.selectedProducts.size;
  
  if (count > 0) {
    selectedBlock.style.display = 'block';
    selectedCount.textContent = count;
    
    // Рендерим список выбранных
    let html = '';
    transferState.selectedProducts.forEach((qty, productId) => {
      const product = transferState.products.find(p => p.id === productId);
      if (product) {
        html += `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:rgba(34, 197, 94, 0.1);border-radius:6px;border:1px solid rgba(34, 197, 94, 0.3);">
            <div>
              <div style="font-weight:600;color:#e2e8f0;">${product.name}</div>
              <div style="font-size:12px;color:#94a3b8;">Количество: ${qty} из ${product.balance}</div>
            </div>
            <button onclick="removeFromTransfer('${productId}')" 
              style="padding:4px 8px;background:transparent;border:1px solid #ef4444;border-radius:4px;color:#ef4444;cursor:pointer;">
              ✕
            </button>
          </div>
        `;
      }
    });
    selectedList.innerHTML = html;
  } else {
    selectedBlock.style.display = 'none';
  }
  
  // Кнопка активна если: есть источник, есть цель, есть выбранные товары
  const canExecute = transferState.sourceId && transferState.destId && count > 0;
  executeBtn.disabled = !canExecute;
}

// Удаление из выбранных
window.removeFromTransfer = function(productId) {
  transferState.selectedProducts.delete(productId);
  renderTransferProducts();
  updateTransferUI();
};

// Очистка всех выбранных
document.getElementById('transferClearSelectedBtn')?.addEventListener('click', () => {
  transferState.selectedProducts.clear();
  renderTransferProducts();
  updateTransferUI();
});

// Поиск
document.getElementById('transferSearchInput')?.addEventListener('input', () => {
  renderTransferProducts();
});

// Кнопки массового выбора
document.getElementById('transferSelectAllBtn')?.addEventListener('click', () => {
  toggleAllTransferProducts(true);
});

document.getElementById('transferDeselectAllBtn')?.addEventListener('click', () => {
  toggleAllTransferProducts(false);
});

// Выполнение перемещения
document.getElementById('executeTransferBtn')?.addEventListener('click', async () => {
  if (!transferState.sourceId || !transferState.destId || transferState.selectedProducts.size === 0) {
    showToast('❌ Заполните все поля', 'error');
    return;
  }
  
  const btn = document.getElementById('executeTransferBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Перемещение...';
  
  try {
    // Формируем массив товаров для RPC
    const items = [];
    transferState.selectedProducts.forEach((quantity, productId) => {
      const product = transferState.products.find(p => p.id === productId);
      if (product) {
        items.push({
          product_id: productId,
          quantity: Number(quantity),
          price: Number(product.price || 0)
        });
      }
    });
    
    if (items.length === 0) {
      throw new Error('Нет товаров для перемещения');
    }
    
    console.log('📦 Вызов create_transfer_document:', {
      source: transferState.sourceType + ':' + transferState.sourceId,
      dest: transferState.destType + ':' + transferState.destId,
      items: items.length
    });
    
    // Вызываем RPC
    const { data, error } = await supabase.rpc('create_transfer_document', {
      p_company_id: COMPANY_ID,
      p_source_warehouse_id: transferState.sourceType === 'warehouse' ? transferState.sourceId : null,
      p_source_store_id: transferState.sourceType === 'store' ? transferState.sourceId : null,
      p_dest_warehouse_id: transferState.destType === 'warehouse' ? transferState.destId : null,
      p_dest_store_id: transferState.destType === 'store' ? transferState.destId : null,
      p_items: items
    });
    
    if (error) throw error;
    
    console.log('✅ Перемещение выполнено:', data);
    
    showToast(`✅ Перемещено ${items.length} товаров`);
    
    // Сброс состояния
    transferState.selectedProducts.clear();
    
    // Перезагружаем товары из источника
    await loadTransferProducts();
    updateTransferUI();
    
    // Обновляем кеш товаров если есть функция
    if (window.refreshProductsCache) {
      await window.refreshProductsCache();
    }
    
  } catch (err) {
    console.error('❌ Ошибка перемещения:', err);
    showToast('❌ ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// =============================================
// ОСНОВНОЙ СКЛАД - ПРОСМОТР ТОВАРОВ
// =============================================
let WAREHOUSE_PRODUCTS_CACHE = [];

async function loadWarehouseTab() {
  await loadWarehouseProducts();
  renderWarehouseProductsList();
}

async function loadWarehouseProducts() {
  if (!window.COMPANY_ID) {
    console.warn("⚠️ COMPANY_ID не установлен");
    return;
  }
  
  if (!window.WAREHOUSE_CACHE) {
    console.warn("⚠️ WAREHOUSE_CACHE не установлен");
    WAREHOUSE_PRODUCTS_CACHE = [];
    renderWarehouseProductsList();
    return;
  }
  
  try {
    const { data, error } = await supabase
      .from("product_balances")
      .select(`
        quantity,
        updated_at,
        product_id,
        products!inner (
          id,
          name,
          sku
        )
      `)
      .eq("warehouse_id", window.WAREHOUSE_CACHE)
      .is("store_location_id", null)
      .order("updated_at", { ascending: false });
    
    if (error) throw error;
    
    WAREHOUSE_PRODUCTS_CACHE = (data || []).map(pb => ({
      id: pb.products.id,
      name: pb.products.name,
      sku: pb.products.sku || "",
      quantity: Number(pb.quantity || 0),
      updated_at: pb.updated_at
    }));
    
    console.log("✅ Товары склада загружены:", WAREHOUSE_PRODUCTS_CACHE.length);
    
  } catch (err) {
    console.error("❌ Ошибка загрузки товаров склада:", err);
    WAREHOUSE_PRODUCTS_CACHE = [];
  }
}

function renderWarehouseProductsList() {
  const container = document.getElementById("warehouseProductsTable");
  if (!container) return;
  
  const searchTerm = (document.getElementById("warehouseSearchInput")?.value || "").toLowerCase();
  
  const filtered = WAREHOUSE_PRODUCTS_CACHE.filter(p => {
    if (!searchTerm) return true;
    return (
      (p.name || "").toLowerCase().includes(searchTerm) ||
      (p.sku || "").toLowerCase().includes(searchTerm)
    );
  });
  
  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--text-secondary);">
        ${WAREHOUSE_PRODUCTS_CACHE.length === 0 ? "Нет товаров на складе" : "Ничего не найдено"}
      </div>
    `;
    return;
  }
  
  container.innerHTML = `
    <table class="products-table-full">
      <thead>
        <tr style="background:var(--bg-secondary);color:var(--text-secondary);">
          <th style="text-align:left;padding:10px;">Название</th>
          <th style="text-align:left;padding:10px;width:120px;">Артикул</th>
          <th style="text-align:right;padding:10px;width:100px;">Остаток</th>
          <th style="text-align:center;padding:10px;width:160px;">Обновлено</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(p => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:10px;">
              <div style="font-weight:600;">${p.name}</div>
            </td>
            <td style="padding:10px;color:var(--text-secondary);">${p.sku}</td>
            <td style="padding:10px;text-align:right;font-weight:600;">${p.quantity}</td>
            <td style="padding:10px;text-align:center;color:var(--text-secondary);font-size:13px;">
              ${p.updated_at ? new Date(p.updated_at).toLocaleString("ru-RU", {
                day: "2-digit",
                month: "2-digit", 
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit"
              }) : "-"}
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}
window.getPeriodDates = getPeriodDates;

window.filterWarehouseProducts = function() {
  renderWarehouseProductsList();
};
