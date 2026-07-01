// =============================================
// POS FULLSCREEN MODE ("Режим продаж") — pos.html chrome
// Purely additive: reuses window.addToCart/renderCart/switchTradingTab/
// showSection/showToast/formatMoney and the shared tabStates.js state
// objects. Does not reimplement cart/sale/discount logic.
// =============================================

import { supabase } from './supabaseClient.js';
import { saleState, getCurrentState, getCurrentTab } from './tabStates.js';

function toast(msg, type) {
  if (window.showToast) window.showToast(msg, type);
  else alert(msg);
}
function fmt(n) {
  return window.formatMoney ? window.formatMoney(n) : (Number(n) || 0) + ' ₸';
}

let lastReceipt = null;
let universalProductCache = null;
let historyCache = [];

// =============================================
// 1. RELOCATE EXISTING DOM NODES INTO THE NEW CHROME
// =============================================
function relocatePosNodes() {
  const sectionTrading = document.getElementById('section-trading');
  if (!sectionTrading) return;

  const receiptArea = document.createElement('div');
  receiptArea.className = 'pos-receipt-area';
  sectionTrading.insertBefore(receiptArea, sectionTrading.firstChild);

  // Whole left-panel (search box + product grid inside tab-sale, return-finder
  // inside tab-return) keeps working via the existing switchTradingTab() logic
  // no matter where in the DOM it physically lives.
  const leftPanel = sectionTrading.querySelector('.left-panel');
  if (leftPanel) receiptArea.appendChild(leftPanel);

  const cartCard = document.getElementById('cart')?.closest('.card');
  if (cartCard) receiptArea.appendChild(cartCard);

  const discountCard = document.getElementById('discountCard');
  const discountSlot = document.getElementById('posDiscountSlot');
  if (discountCard && discountSlot) discountSlot.appendChild(discountCard);

  const clientCard = document.getElementById('clientCard');
  const clientSlot = document.getElementById('posClientSlot');
  if (clientCard && clientSlot) clientSlot.appendChild(clientCard);

  const bottombar = document.getElementById('posBottombar');
  const paymentCard = document.getElementById('paymentButtons')?.closest('.card');
  const totalCard = sectionTrading.querySelector('.total-card');
  const actionBtn = document.getElementById('actionBtn');
  if (bottombar && paymentCard) bottombar.appendChild(paymentCard);
  if (bottombar && totalCard) bottombar.appendChild(totalCard);
  if (bottombar && actionBtn) bottombar.appendChild(actionBtn);

  const mainContent = document.querySelector('.main-content');
  const historyPanel = document.getElementById('posHistoryPanel');
  const shiftPanel = document.getElementById('posShiftPanel');
  if (mainContent && historyPanel) mainContent.appendChild(historyPanel);
  if (mainContent && shiftPanel) mainContent.appendChild(shiftPanel);
}

// =============================================
// 2. TOP TABS (Продажа / Возврат / История / Смена / Покупатели)
// =============================================
function setChromeMinimal(minimal) {
  document.body.classList.toggle('pos-chrome-minimal', minimal);
}

function posSwitchTab(tab) {
  document.querySelectorAll('.pos-tab').forEach(b => b.classList.toggle('active', b.dataset.postab === tab));
  closeAllFlyouts();

  const historyPanel = document.getElementById('posHistoryPanel');
  const shiftPanel = document.getElementById('posShiftPanel');
  historyPanel.classList.remove('active');
  shiftPanel.classList.remove('active');

  if (tab === 'sale' || tab === 'return') {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('section-trading').classList.add('active');
    window.switchTradingTab && window.switchTradingTab(tab);
    setChromeMinimal(false);
  } else if (tab === 'clients') {
    window.showSection && window.showSection('clients');
    renderCustomerDebtsSummary();
    setChromeMinimal(true);
  } else if (tab === 'history') {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    historyPanel.classList.add('active');
    loadHistoryPanel();
    setChromeMinimal(true);
  } else if (tab === 'shift') {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    shiftPanel.classList.add('active');
    loadShiftPanel();
    setChromeMinimal(true);
  }
}

function wireTopTabs() {
  document.getElementById('posTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.pos-tab');
    if (!btn) return;
    posSwitchTab(btn.dataset.postab);
  });
}

// =============================================
// 3. HISTORY / SHIFT PANELS (independent read-only queries —
//    the return tab's RECENT_SALES_CACHE is private to that flow
//    and already excludes/deducts returned quantities, so it isn't reused here)
// =============================================
async function fetchCompanySales(sinceDays, limit) {
  if (!window.COMPANY_ID) return [];
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);
  try {
    const { data, error } = await supabase
      .from('sales')
      .select('id, total_amount, operation_at, payment_methods(name), customers(name), sale_items(quantity)')
      .eq('company_id', window.COMPANY_ID)
      .eq('status', 'completed')
      .is('deleted_at', null)
      .is('related_sale_id', null)
      .gte('operation_at', since.toISOString())
      .order('operation_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('fetchCompanySales error', err);
    return [];
  }
}

async function loadHistoryPanel() {
  const list = document.getElementById('posHistoryList');
  list.innerHTML = '<div style="padding:20px;color:var(--text-secondary);">Загрузка...</div>';
  historyCache = await fetchCompanySales(30, 150);
  renderHistoryList(historyCache);
}

function renderHistoryList(sales) {
  const list = document.getElementById('posHistoryList');
  if (!sales.length) {
    list.innerHTML = '<div style="padding:20px;color:var(--text-secondary);">Продажи не найдены</div>';
    return;
  }
  list.innerHTML = sales.map(s => {
    const itemsCount = (s.sale_items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
    const dateStr = new Date(s.operation_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `
      <div class="pos-history-row">
        <div><strong>${dateStr}</strong> · ${itemsCount} шт · ${s.customers?.name || 'Без клиента'}</div>
        <div><span style="opacity:.7;margin-right:10px;">${s.payment_methods?.name || '—'}</span><strong>${fmt(s.total_amount)}</strong></div>
      </div>
    `;
  }).join('');
}

function wireHistorySearch() {
  document.getElementById('posHistorySearch').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) { renderHistoryList(historyCache); return; }
    renderHistoryList(historyCache.filter(s =>
      (s.customers?.name || '').toLowerCase().includes(q) ||
      (s.payment_methods?.name || '').toLowerCase().includes(q) ||
      String(s.total_amount).includes(q)
    ));
  });
}

async function loadShiftPanel() {
  const stats = document.getElementById('posShiftStats');
  stats.innerHTML = '<div style="padding:20px;color:var(--text-secondary);">Загрузка...</div>';
  const sales = await fetchCompanySales(1, 500);
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const today = sales.filter(s => new Date(s.operation_at) >= startOfDay);
  const total = today.reduce((sum, s) => sum + Number(s.total_amount || 0), 0);
  stats.innerHTML = `
    <div class="pos-shift-stat-card"><div class="pos-stat-label">Продаж сегодня</div><div class="pos-stat-value">${today.length}</div></div>
    <div class="pos-shift-stat-card"><div class="pos-stat-label">Сумма за сегодня</div><div class="pos-stat-value">${fmt(total)}</div></div>
  `;
}

// =============================================
// 4. CUSTOMER DEBTS (Покупатели tab summary)
// =============================================
async function renderCustomerDebtsSummary() {
  const clientsSection = document.getElementById('section-clients');
  if (!clientsSection || !window.COMPANY_ID) return;

  let box = document.getElementById('posDebtsSummary');
  if (!box) {
    box = document.createElement('div');
    box.id = 'posDebtsSummary';
    box.style.marginBottom = '16px';
    clientsSection.insertBefore(box, clientsSection.firstChild);
  }
  try {
    const { data, error } = await supabase
      .from('customer_debts')
      .select('client_id, amount, customers(name)')
      .eq('company_id', window.COMPANY_ID)
      .eq('status', 'open');
    if (error) throw error;

    const byClient = {};
    (data || []).forEach(d => {
      if (!byClient[d.client_id]) byClient[d.client_id] = { name: d.customers?.name || '—', total: 0 };
      byClient[d.client_id].total += Number(d.amount || 0);
    });
    const rows = Object.entries(byClient);
    if (!rows.length) { box.innerHTML = ''; return; }

    box.innerHTML = `
      <div class="card">
        <div class="card-title">Клиенты с долгом</div>
        ${rows.map(([clientId, info]) => `
          <div class="pos-history-row">
            <div>${info.name}</div>
            <div><strong style="color:var(--red);">${fmt(info.total)}</strong>
              <button class="btn-secondary" style="margin-left:10px;padding:4px 10px;" data-pay-debt="${clientId}">Оплачено</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    console.error('renderCustomerDebtsSummary error', err);
    box.innerHTML = '';
  }
}

function wireDebtPayoff() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pay-debt]');
    if (!btn) return;
    if (!confirm('Отметить долг этого клиента как оплаченный?')) return;
    try {
      await supabase.from('customer_debts')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('client_id', btn.dataset.payDebt)
        .eq('company_id', window.COMPANY_ID)
        .eq('status', 'open');
      renderCustomerDebtsSummary();
    } catch (err) {
      console.error(err);
      toast('Не удалось обновить долг', 'error');
    }
  });
}

// =============================================
// 5. FLYOUTS (Быстрые товары / Наценка / Скидка / Покупатель / Отложить)
// =============================================
function openFlyout(name) {
  document.querySelectorAll('.pos-flyout').forEach(f => f.classList.toggle('open', f.dataset.flyout === name));
  document.querySelectorAll('.pos-rail-btn[data-posflyout]').forEach(b => b.classList.toggle('active', b.dataset.posflyout === name));
}
function closeFlyout(name) {
  const f = document.querySelector(`.pos-flyout[data-flyout="${name}"]`);
  if (f) f.classList.remove('open');
  const b = document.querySelector(`.pos-rail-btn[data-posflyout="${name}"]`);
  if (b) b.classList.remove('active');
}
function closeAllFlyouts() {
  document.querySelectorAll('.pos-flyout').forEach(f => f.classList.remove('open'));
  document.querySelectorAll('.pos-rail-btn[data-posflyout]').forEach(b => b.classList.remove('active'));
}
function toggleFlyout(name) {
  const f = document.querySelector(`.pos-flyout[data-flyout="${name}"]`);
  if (f && f.classList.contains('open')) closeFlyout(name);
  else { closeAllFlyouts(); openFlyout(name); }
}

function wireRail() {
  document.getElementById('posRail').addEventListener('click', (e) => {
    if (e.target.closest('#posCollapseBtn')) {
      document.body.classList.toggle('pos-rail-collapsed');
      localStorage.setItem('pos_rail_collapsed', document.body.classList.contains('pos-rail-collapsed') ? 'true' : 'false');
      return;
    }
    const flyoutBtn = e.target.closest('[data-posflyout]');
    const modalBtn = e.target.closest('[data-posmodal]');
    if (!flyoutBtn && !modalBtn) return;

    if (getCurrentTab() !== 'sale') {
      toast('Доступно только на вкладке Продажа', 'error');
      return;
    }
    if (flyoutBtn) {
      const name = flyoutBtn.dataset.posflyout;
      toggleFlyout(name);
      if (name === 'quick') renderQuickPins();
      if (name === 'hold') renderParkedList();
    } else if (modalBtn) {
      window.openModal && window.openModal(modalBtn.dataset.posmodal);
    }
  });

  document.querySelectorAll('[data-close-flyout]').forEach(btn => {
    btn.addEventListener('click', () => {
      const flyout = btn.closest('.pos-flyout');
      if (flyout) closeFlyout(flyout.dataset.flyout);
    });
  });

  if (localStorage.getItem('pos_rail_collapsed') === 'true') {
    document.body.classList.add('pos-rail-collapsed');
  }
}

// ---------- Быстрые товары (all company products from DB cache) ----------
function renderQuickPins() {
  const container = document.getElementById('posQuickPins');
  if (!container) return;
  const products = window.PRODUCTS_CACHE || [];
  if (!products.length) {
    container.innerHTML = '<div class="pos-quick-empty-hint">Товары загружаются...</div>';
    return;
  }
  container.innerHTML = products.map(p => `
    <div class="pos-quick-pin-tile" data-pin-tile="${p.id}">
      <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.name}</div>
      <div style="opacity:.65;font-size:12px;margin-top:2px;">${fmt(p.base_price)}</div>
    </div>
  `).join('');
}

function wireQuickPins() {
  document.getElementById('posQuickPins').addEventListener('click', (e) => {
    const tile = e.target.closest('[data-pin-tile]');
    if (tile) window.addToCart && window.addToCart(tile.dataset.pinTile);
  });
}

// ---------- Наценка на чек ----------
function wireMarkup() {
  document.getElementById('posMarkupApplyBtn').addEventListener('click', () => {
    const amount = parseFloat(document.getElementById('posMarkupInput').value) || 0;
    if (amount <= 0) { toast('Введите сумму наценки', 'error'); return; }
    const state = getCurrentState();
    state.discountPercent = 0;
    state.discountAmount = -Math.abs(amount);
    const dp = document.getElementById('discountPercent'); if (dp) dp.value = '';
    const da = document.getElementById('discountAmount'); if (da) da.value = '';
    const dr = document.getElementById('discountResultText'); if (dr) dr.textContent = '0 ₸';
    window.renderCart && window.renderCart();
    closeFlyout('markup');
    toast('Наценка применена', 'success');
  });
  document.getElementById('posMarkupClearBtn').addEventListener('click', () => {
    const state = getCurrentState();
    if (state.discountAmount < 0) { state.discountAmount = 0; state.discountPercent = 0; window.renderCart && window.renderCart(); }
    document.getElementById('posMarkupInput').value = '';
    closeFlyout('markup');
  });
}

// ---------- Отложить продажу ----------
function parkedKey() { return `pos_parked_sales_${window.COMPANY_ID}_${window.STORE_LOCATION_ID}`; }
function getParkedSales() {
  try { return JSON.parse(localStorage.getItem(parkedKey()) || '[]'); } catch { return []; }
}
function saveParkedSales(list) { localStorage.setItem(parkedKey(), JSON.stringify(list)); }

function renderParkedList() {
  const list = document.getElementById('posHoldList');
  const parked = getParkedSales();
  if (!parked.length) {
    list.innerHTML = '<div style="padding:10px;color:var(--text-secondary);">Нет отложенных продаж</div>';
    return;
  }
  list.innerHTML = parked.map(p => {
    const count = (p.cart || []).reduce((s, i) => s + Number(i.quantity || 0), 0);
    const total = (p.cart || []).reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0);
    const dateStr = new Date(p.savedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `
      <div class="pos-hold-row" data-resume="${p.id}">
        <div>${dateStr} · ${count} шт · ${fmt(total)}</div>
        <button class="btn-secondary" data-delete-parked="${p.id}" style="padding:4px 10px;">✕</button>
      </div>
    `;
  }).join('');
}

function wireHold() {
  document.getElementById('posHoldSaveBtn').addEventListener('click', () => {
    const state = getCurrentState();
    if (!state.cart.length) { toast('Чек пуст — нечего откладывать', 'error'); return; }
    const list = getParkedSales();
    list.push({
      id: 'p' + Date.now() + Math.random().toString(36).slice(2, 7),
      cart: state.cart,
      selectedClientId: state.selectedClientId || null,
      discountAmount: state.discountAmount || 0,
      discountPercent: state.discountPercent || 0,
      comment: document.getElementById('commentInput')?.value || '',
      savedAt: new Date().toISOString()
    });
    saveParkedSales(list);
    window.resetCart && window.resetCart();
    state.selectedClientId = null;
    state.discountAmount = 0;
    state.discountPercent = 0;
    const commentEl = document.getElementById('commentInput'); if (commentEl) commentEl.value = '';
    const clientSelect = document.getElementById('clientSelect'); if (clientSelect) clientSelect.value = '';
    renderParkedList();
    toast('Продажа отложена', 'success');
  });

  document.getElementById('posHoldList').addEventListener('click', (e) => {
    const del = e.target.closest('[data-delete-parked]');
    if (del) {
      saveParkedSales(getParkedSales().filter(p => p.id !== del.dataset.deleteParked));
      renderParkedList();
      return;
    }
    const resume = e.target.closest('[data-resume]');
    if (!resume) return;
    const list = getParkedSales();
    const idx = list.findIndex(p => p.id === resume.dataset.resume);
    if (idx === -1) return;
    const state = getCurrentState();
    if (state.cart.length && !confirm('Текущий чек не пустой. Заменить его отложенной продажей?')) return;
    const entry = list[idx];
    state.cart = entry.cart;
    state.selectedClientId = entry.selectedClientId || null;
    state.discountAmount = entry.discountAmount || 0;
    state.discountPercent = entry.discountPercent || 0;
    const commentEl = document.getElementById('commentInput'); if (commentEl) commentEl.value = entry.comment || '';
    const clientSelect = document.getElementById('clientSelect');
    if (clientSelect) { clientSelect.value = entry.selectedClientId || ''; window.onClientSelect && window.onClientSelect(); }
    list.splice(idx, 1);
    saveParkedSales(list);
    window.renderCart && window.renderCart();
    renderParkedList();
    closeFlyout('hold');
    toast('Продажа восстановлена', 'success');
  });
}

// =============================================
// 6. УНИВЕРСАЛЬНЫЙ ТОВАР
// =============================================
async function ensureUniversalProduct() {
  if (universalProductCache) return universalProductCache;
  const name = 'Универсальный товар';
  try {
    let { data } = await supabase.from('products').select('id')
      .eq('company_id', window.COMPANY_ID).eq('name', name).eq('type', 'service').maybeSingle();
    if (!data) {
      const created = await supabase.from('products').insert({
        company_id: window.COMPANY_ID,
        name,
        type: 'service',
        inventory_mode: 'on_demand',
        base_price: 0
      }).select('id').single();
      if (created.error) throw created.error;
      data = created.data;
    }
    universalProductCache = data;
    return data;
  } catch (err) {
    console.error('ensureUniversalProduct error', err);
    toast('Не удалось создать универсальный товар', 'error');
    return null;
  }
}

function wireUniversalProduct() {
  document.getElementById('posUniversalAddBtn').addEventListener('click', async () => {
    const name = document.getElementById('posUniversalName').value.trim() || 'Товар';
    const price = parseFloat(document.getElementById('posUniversalPrice').value) || 0;
    const qty = parseInt(document.getElementById('posUniversalQty').value) || 1;
    if (price <= 0) { toast('Укажите цену', 'error'); return; }
    const placeholder = await ensureUniversalProduct();
    if (!placeholder) return;
    const state = getCurrentState();
    state.cart.push({ id: placeholder.id, name, price, quantity: qty, type: 'service', purchase_price: 0 });
    window.renderCart && window.renderCart();
    window.closeModal && window.closeModal('posUniversalModal');
    document.getElementById('posUniversalName').value = '';
    document.getElementById('posUniversalPrice').value = '';
    document.getElementById('posUniversalQty').value = '1';
    toast('Товар добавлен в чек', 'success');
  });
}

// =============================================
// 7. ОПЛАТА ДОЛГ / СМЕШАННАЯ — real customer debt
// =============================================
function findDebtMethodId() {
  const methods = window.PAYMENT_METHODS || [];
  const m = methods.find(m => /долг|смешан/i.test(m.name || ''));
  return m ? m.id : null;
}

let debtProvisionPromise = null;
function ensureDebtMethodProvisioned() {
  if (findDebtMethodId() || debtProvisionPromise) return;
  debtProvisionPromise = (async () => {
    if (!window.COMPANY_ID) return;
    try {
      const { data, error } = await supabase.from('payment_methods')
        .insert({ company_id: window.COMPANY_ID, name: 'Смешанная/Долг', is_system: false })
        .select().single();
      if (!error && data) {
        window.PAYMENT_METHODS = window.PAYMENT_METHODS || [];
        window.PAYMENT_METHODS.push(data);
        window.renderPaymentMethods && window.renderPaymentMethods();
      }
    } catch (err) {
      console.error('Could not provision debt payment method', err);
    }
  })();
}

function waitAndProvisionDebtMethod(retries = 40) {
  if (window.COMPANY_ID && window.PAYMENT_METHODS) { ensureDebtMethodProvisioned(); return; }
  if (retries <= 0) return;
  setTimeout(() => waitAndProvisionDebtMethod(retries - 1), 200);
}

function wrapSubmitOperation() {
  const original = window.submitOperation;
  if (!original || original.__posWrapped) return;

  window.submitOperation = async function () {
    const isSale = getCurrentTab() === 'sale';
    const debtId = isSale ? findDebtMethodId() : null;

    if (isSale && debtId && saleState.selectedPaymentId === debtId && !saleState.selectedClientId) {
      toast('Для оплаты в долг выберите покупателя', 'error');
      return;
    }

    const snapshot = isSale ? {
      items: saleState.cart.map(i => ({ ...i })),
      paymentId: saleState.selectedPaymentId,
      clientId: saleState.selectedClientId,
      discountAmount: saleState.discountAmount
    } : null;

    const result = await original.apply(this, arguments);

    if (isSale && snapshot && result && result.saleId) {
      lastReceipt = { ...snapshot, total: result.total, saleId: result.saleId, at: new Date().toISOString() };
      if (debtId && snapshot.paymentId === debtId && snapshot.clientId) {
        try {
          await supabase.from('customer_debts').insert({
            company_id: window.COMPANY_ID,
            store_location_id: window.STORE_LOCATION_ID,
            client_id: snapshot.clientId,
            sale_id: result.saleId,
            amount: result.total,
            status: 'open'
          });
        } catch (err) {
          console.error('Debt insert failed', err);
          toast('Продажа сохранена, но не удалось записать долг', 'error');
        }
      }
    }
    return result;
  };
  window.submitOperation.__posWrapped = true;
}

// =============================================
// 8. ПЕЧАТЬ ПОСЛЕДНЕГО ЧЕКА
// =============================================
function printLastReceipt() {
  if (!lastReceipt) { toast('Нет последнего чека для печати', 'error'); return; }
  const w = window.open('', '_blank', 'width=400,height=600');
  if (!w) { toast('Разрешите всплывающие окна для печати чека', 'error'); return; }
  const itemsHtml = lastReceipt.items.map(i => `
    <tr><td>${i.name}</td><td style="text-align:center;">${i.quantity}</td><td style="text-align:right;">${fmt(i.price * i.quantity)}</td></tr>
  `).join('');
  w.document.write(`
    <html><head><title>Чек</title><meta charset="UTF-8"><style>
      body{font-family:monospace;padding:16px;font-size:13px;}
      table{width:100%;border-collapse:collapse;}
      td{padding:4px 0;}
      .total{font-weight:bold;font-size:16px;border-top:1px dashed #000;padding-top:8px;margin-top:8px;}
    </style></head><body>
      <h3 style="text-align:center;">Чек</h3>
      <div>${new Date(lastReceipt.at).toLocaleString('ru-RU')}</div>
      <table>${itemsHtml}</table>
      <div class="total">Итого: ${fmt(lastReceipt.total)}</div>
      <script>window.onload = function(){ window.print(); };</script>
    </body></html>
  `);
  w.document.close();
}

// =============================================
// 9. БЫСТРАЯ ПРИЕМКА (reuses existing openQuickIncome modal)
// =============================================
function openQuickReceivePicker() {
  window.openModal && window.openModal('posQuickReceiveModal');
  const input = document.getElementById('posQuickReceiveInput');
  input.value = '';
  renderQuickReceiveList('');
  setTimeout(() => input.focus(), 50);
}
function renderQuickReceiveList(query) {
  const list = document.getElementById('posQuickReceiveList');
  const q = (query || '').toLowerCase();
  const products = (window.PRODUCTS_CACHE || [])
    .filter(p => !q || (p.name || '').toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q))
    .slice(0, 30);
  list.innerHTML = products.map(p => `
    <div class="pos-quick-receive-row" data-receive-id="${p.id}">
      <span>${p.name}</span><span style="opacity:.6;">${p.type === 'service' ? 'Услуга' : (p.quantity || 0) + ' шт'}</span>
    </div>
  `).join('');
}
function wireQuickReceive() {
  document.getElementById('posQuickReceiveInput').addEventListener('input', (e) => renderQuickReceiveList(e.target.value));
  document.getElementById('posQuickReceiveList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-receive-id]');
    if (!row) return;
    window.closeModal && window.closeModal('posQuickReceiveModal');
    window.openQuickIncome && window.openQuickIncome(row.dataset.receiveId);
  });
}

// =============================================
// 10. ПРОВЕРКА ЦЕНЫ ТОВАРА
// =============================================
function openPriceCheck() {
  window.openModal && window.openModal('posPriceCheckModal');
  const input = document.getElementById('posPriceCheckInput');
  input.value = '';
  document.getElementById('posPriceCheckResult').innerHTML = '';
  setTimeout(() => input.focus(), 50);
}
function renderPriceCheck(query) {
  const box = document.getElementById('posPriceCheckResult');
  const q = (query || '').toLowerCase().trim();
  if (!q) { box.innerHTML = ''; return; }
  const matches = (window.PRODUCTS_CACHE || [])
    .filter(p => (p.name || '').toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
    .slice(0, 15);
  box.innerHTML = matches.length
    ? matches.map(p => `<div class="pos-price-row"><span>${p.name}</span><strong>${fmt(p.base_price)}</strong></div>`).join('')
    : '<div style="padding:10px;color:var(--text-secondary);">Не найдено</div>';
}
function wirePriceCheck() {
  document.getElementById('posPriceCheckInput').addEventListener('input', (e) => renderPriceCheck(e.target.value));
}

// =============================================
// 11. СМЕНИТЬ КАССУ (switch store_location)
// =============================================
async function openSwitchStoreModal() {
  window.openModal && window.openModal('posSwitchStoreModal');
  const list = document.getElementById('posSwitchStoreList');
  list.innerHTML = '<div style="padding:10px;color:var(--text-secondary);">Загрузка...</div>';
  try {
    const { data, error } = await supabase.from('store_locations')
      .select('id,name').eq('company_id', window.COMPANY_ID).eq('active', true).order('name');
    if (error) throw error;
    const currentId = localStorage.getItem('selected_store_id');
    list.innerHTML = (data || []).map(s => `
      <div class="pos-history-row" data-switch-store="${s.id}" data-switch-store-name="${s.name}" style="${s.id === currentId ? 'border-color:var(--blue);' : ''}">
        <span>${s.name}</span>${s.id === currentId ? '<span style="color:var(--blue);">✓ текущая</span>' : ''}
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
    list.innerHTML = '<div style="padding:10px;color:var(--red);">Ошибка загрузки</div>';
  }
}
function wireSwitchStore() {
  document.getElementById('posSwitchStoreList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-switch-store]');
    if (!row) return;
    window.closeModal && window.closeModal('posSwitchStoreModal');
    window.selectStoreLocation && window.selectStoreLocation(row.dataset.switchStore, row.dataset.switchStoreName);
  });
}

// =============================================
// 12. HAMBURGER DRAWER (Функции / Касса / Система)
// =============================================
function openDrawer() {
  document.getElementById('posDrawer').classList.add('open');
  document.getElementById('posDrawerOverlay').classList.add('open');
}
function closeDrawer() {
  document.getElementById('posDrawer').classList.remove('open');
  document.getElementById('posDrawerOverlay').classList.remove('open');
}

function wireDrawer() {
  document.getElementById('posBurgerBtn').addEventListener('click', openDrawer);
  document.getElementById('posDrawerCloseBtn').addEventListener('click', closeDrawer);
  document.getElementById('posDrawerOverlay').addEventListener('click', closeDrawer);

  document.getElementById('posDrawerPrintLast').addEventListener('click', () => { closeDrawer(); printLastReceipt(); });
  document.getElementById('posDrawerQuickReceive').addEventListener('click', () => { closeDrawer(); openQuickReceivePicker(); });
  document.getElementById('posDrawerPriceCheck').addEventListener('click', () => { closeDrawer(); openPriceCheck(); });
  document.getElementById('posDrawerSwitchStore').addEventListener('click', () => { closeDrawer(); openSwitchStoreModal(); });
  document.getElementById('posDrawerOpenDrawer').addEventListener('click', () => {
    closeDrawer();
    toast('Открытие денежного ящика недоступно — нет интеграции с оборудованием', 'error');
  });
  document.getElementById('posDrawerSettings').addEventListener('click', () => {
    closeDrawer();
    toast('Настройки — скоро', 'success');
  });
  document.getElementById('posDrawerGoToDashboard').addEventListener('click', () => {
    closeDrawer();
    window.location.href = 'index.html';
  });
  document.getElementById('posDrawerLogout').addEventListener('click', async () => {
    closeDrawer();
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  });
}

// =============================================
// 13. GENERIC MODAL CLOSE (data-close-modal buttons)
// =============================================
function wireGenericModalClose() {
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => window.closeModal && window.closeModal(btn.dataset.closeModal));
  });
}

// =============================================
// 14. SEARCH BAR: auto-open quick flyout, Enter-to-add on exact barcode
// =============================================
function wireSearchBar() {
  const input = document.getElementById('barcodeInput');
  if (!input) return;
  input.addEventListener('input', () => {
    if (getCurrentTab() !== 'sale') return;
    if (input.value.trim()) openFlyout('quick');
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = input.value.trim().toLowerCase();
    if (!q) return;
    const match = (window.PRODUCTS_CACHE || []).find(p => (p.barcode || '').toLowerCase() === q);
    if (match) {
      window.addToCart && window.addToCart(match.id);
      input.value = '';
      window.renderProductsList && window.renderProductsList();
      const clearBtn = document.getElementById('clearSearchBtn');
      if (clearBtn) clearBtn.style.display = 'none';
      closeFlyout('quick');
    }
  });
}

// =============================================
// INIT
// =============================================
function init() {
  relocatePosNodes();
  wireTopTabs();
  wireHistorySearch();
  wireDebtPayoff();
  wireRail();
  wireQuickPins();
  wireMarkup();
  wireHold();
  wireUniversalProduct();
  wireQuickReceive();
  wirePriceCheck();
  wireSwitchStore();
  wireDrawer();
  wireGenericModalClose();
  wireSearchBar();
  wrapSubmitOperation();
  waitAndProvisionDebtMethod();

  // switchTradingTab/showSection may not be attached yet (modules load in
  // parallel) — retry until ready, mirroring script.js's own initTrading().
  function ready() {
    if (typeof window.switchTradingTab === 'function' && typeof window.showSection === 'function') {
      posSwitchTab('sale');
    } else {
      setTimeout(ready, 30);
    }
  }
  ready();
}

init();
