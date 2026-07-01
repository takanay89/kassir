// =============================================
// ЭКРАН ОПЛАТЫ (Наличные / Безналичная / Смешанная / В долг)
// =============================================

import { supabase } from './supabaseClient.js';
import { saleState, getCurrentState } from './tabStates.js';

// ---------- ЛОКАЛЬНОЕ СОСТОЯНИЕ ЭКРАНА ОПЛАТЫ ----------
let coActiveTab = 'cash';
let coTotal = 0;

let cashEntered = 0;      // введено кассиром на вкладке "Наличные" (строка ввода)
let debtEntered = 0;      // введено кассиром на вкладке "В долг" (оплачено сейчас)
let selectedCardMethodId = null;

let mixedRows = [];       // [{ id, methodId, amount }]
let mixedActiveRowId = null;
let mixedRowSeq = 0;

let coSelectedCustomer = null; // { id, name, phone }
let coSubmitting = false;

let CUSTOMERS_CACHE = [];

// =============================================
// ПРОВИЗИЯ (авто-создание) СПЕЦИАЛЬНЫХ СПОСОБОВ ОПЛАТЫ
// =============================================
function isCashName(name) {
  const n = (name || '').toLowerCase().trim();
  if (n.includes('безнал')) return false;
  return n === 'нал' || n === 'наличные' || n.startsWith('налич');
}
function isDebtName(name) {
  const n = (name || '').toLowerCase();
  return n.includes('долг');
}

async function ensurePaymentMethodByPredicate(predicate, createName) {
  const methods = window.PAYMENT_METHODS || [];
  const found = methods.find(m => predicate(m.name));
  if (found) return found;

  const { data, error } = await supabase
    .from('payment_methods')
    .insert({ name: createName, company_id: window.COMPANY_ID, is_system: false })
    .select('id, name')
    .single();

  if (error) {
    console.error('Не удалось создать способ оплаты', createName, error);
    return null;
  }
  window.PAYMENT_METHODS = [...(window.PAYMENT_METHODS || []), data];
  return data;
}

async function ensurePaymentMethodByName(exactName) {
  const methods = window.PAYMENT_METHODS || [];
  const found = methods.find(m => (m.name || '').toLowerCase() === exactName.toLowerCase());
  if (found) return found;
  return ensurePaymentMethodByPredicate(n => (n || '').toLowerCase() === exactName.toLowerCase(), exactName);
}

async function getCashMethod() {
  return ensurePaymentMethodByPredicate(isCashName, 'Наличные');
}
async function getDebtMethod() {
  return ensurePaymentMethodByPredicate(isDebtName, 'Долг');
}
async function getKaspiCardMethod() {
  return ensurePaymentMethodByName('Kaspi карта');
}
async function getKaspiQrMethod() {
  return ensurePaymentMethodByName('Kaspi QR, удаленка');
}

// =============================================
// ОТКРЫТИЕ / ЗАКРЫТИЕ ЭКРАНА
// =============================================
window.openCheckout = function () {
  const state = getCurrentState();
  if (!state || !state.cart || !state.cart.length) {
    window.showToast('Корзина пуста', 'error');
    return;
  }

  const subtotal = window.calculateTotal();
  const discount = state.discountAmount || 0;
  coTotal = Math.max(0, subtotal - discount);

  // сброс состояния экрана
  cashEntered = coTotal;
  debtEntered = 0;
  selectedCardMethodId = null;
  mixedRows = [];
  mixedRowSeq = 0;
  coSelectedCustomer = state.selectedClientId ? { id: state.selectedClientId, name: '', phone: '' } : null;
  coSubmitting = false;

  document.getElementById('checkoutOverlay').classList.add('open');
  window.switchCheckoutTab('cash');
  addMixedRow();
  addMixedRow();
  renderCardMethods();
  updateCustomerButton();
  renderCashDisplay();
  renderDebtDisplay();
  renderMixed();
  renderFooter();
};

window.closeCheckout = function () {
  document.getElementById('checkoutOverlay').classList.remove('open');
};

// =============================================
// ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК
// =============================================
window.switchCheckoutTab = function (tab) {
  coActiveTab = tab;
  document.querySelectorAll('.co-tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
  });
  document.querySelectorAll('.co-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('co-panel-' + tab).classList.add('active');
  renderFooter();
};

// =============================================
// ФОРМАТИРОВАНИЕ
// =============================================
function fmt(n) {
  return (Math.round((n || 0) * 100) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₸';
}

// =============================================
// НАЛИЧНЫЕ — ввод суммы
// =============================================
function renderCashDisplay() {
  document.getElementById('cashAmountInput').value = String(cashEntered) + '₸';
}

window.coCashAdd = function (val) {
  cashEntered = (cashEntered || 0) + val;
  renderCashDisplay();
  renderFooter();
};

window.coCashNoChange = function () {
  cashEntered = coTotal;
  renderCashDisplay();
  renderFooter();
};

// =============================================
// В ДОЛГ — ввод суммы (оплачено сейчас, может быть 0)
// =============================================
function renderDebtDisplay() {
  document.getElementById('debtAmountInput').value = String(debtEntered) + '₸';
}

window.coDebtAdd = function (val) {
  debtEntered = (debtEntered || 0) + val;
  renderDebtDisplay();
  renderFooter();
};

window.coDebtNoChange = function () {
  debtEntered = coTotal;
  renderDebtDisplay();
  renderFooter();
};

// =============================================
// ОБЩАЯ КЛАВИАТУРА (используется наличными/долгом/смешанной)
// =============================================
window.coKeypad = function (scope, key) {
  let getVal, setVal;

  if (scope === 'cash') {
    getVal = () => cashEntered;
    setVal = (v) => { cashEntered = v; renderCashDisplay(); };
  } else if (scope === 'debt') {
    getVal = () => debtEntered;
    setVal = (v) => { debtEntered = v; renderDebtDisplay(); };
  } else if (scope === 'mixed') {
    const row = mixedRows.find(r => r.id === mixedActiveRowId);
    if (!row) return;
    getVal = () => row.amount;
    setVal = (v) => { row.amount = v; renderMixed(); };
  } else {
    return;
  }

  let current = String(getVal() || 0);

  if (key === 'clear') {
    setVal(0);
    renderFooter();
    return;
  }
  if (key === 'back') {
    current = current.slice(0, -1) || '0';
    setVal(parseFloat(current) || 0);
    renderFooter();
    return;
  }
  if (key === '.') {
    if (current.includes('.')) return;
    current = current + '.';
    // временно храним как строку через data — упрощаем: просто не даём двоеточие сломать число
    setVal(parseFloat(current) || 0);
    renderFooter();
    return;
  }

  if (current === '0') current = '';
  current += key;
  setVal(parseFloat(current) || 0);
  renderFooter();
};

// =============================================
// БЕЗНАЛИЧНАЯ — рендер способов
// =============================================
async function renderCardMethods() {
  const container = document.getElementById('cardMethodsList');
  if (!container) return;
  container.innerHTML = '<div style="padding:20px;color:#94a3b8;">Загрузка...</div>';

  const [cardM, qrM] = await Promise.all([getKaspiCardMethod(), getKaspiQrMethod()]);
  const options = [cardM, qrM].filter(Boolean);

  if (!options.length) {
    container.innerHTML = '<div style="padding:20px;color:#94a3b8;">Нет доступных способов оплаты</div>';
    return;
  }

  if (!selectedCardMethodId) selectedCardMethodId = options[0].id;

  container.innerHTML = options.map(m => `
    <div class="co-card-method ${m.id === selectedCardMethodId ? 'selected' : ''}" onclick="window.coSelectCard('${m.id}')">
      <div class="co-card-method-icon">💳<span class="co-pos-badge">POS</span></div>
      <div class="co-card-method-name">${m.name}</div>
    </div>
  `).join('');
}

window.coSelectCard = function (id) {
  selectedCardMethodId = id;
  renderCardMethods();
  renderFooter();
};

// =============================================
// СМЕШАННАЯ — строки способов оплаты
// =============================================
function addMixedRow() {
  mixedRowSeq++;
  const row = { id: 'row' + mixedRowSeq, methodId: null, amount: 0 };
  mixedRows.push(row);
  mixedActiveRowId = row.id;
  return row;
}

window.coAddMixedRow = function () {
  addMixedRow();
  renderMixed();
};

window.coRemoveMixedRow = function (id) {
  mixedRows = mixedRows.filter(r => r.id !== id);
  if (mixedActiveRowId === id) mixedActiveRowId = mixedRows.length ? mixedRows[0].id : null;
  renderMixed();
  renderFooter();
};

window.coSetMixedMethod = function (id, methodId) {
  const row = mixedRows.find(r => r.id === id);
  if (row) row.methodId = methodId || null;
  renderFooter();
};

window.coFocusMixedRow = function (id) {
  mixedActiveRowId = id;
  renderMixed();
};

function renderMixed() {
  const container = document.getElementById('mixedRows');
  if (!container) return;

  const methods = window.PAYMENT_METHODS || [];

  container.innerHTML = mixedRows.map((row, idx) => `
    <div class="co-mixed-row ${row.id === mixedActiveRowId ? 'active' : ''}">
      <select class="input co-mixed-select" onchange="window.coSetMixedMethod('${row.id}', this.value)">
        <option value="">Способ оплаты</option>
        ${methods.map(m => `<option value="${m.id}" ${row.methodId === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}
      </select>
      <div class="co-mixed-amount-wrap" onclick="window.coFocusMixedRow('${row.id}')">
        <label>Сумма</label>
        <input type="text" class="input" readonly value="${row.amount}₸">
      </div>
      ${mixedRows.length > 1 ? `<button class="co-mixed-remove" onclick="window.coRemoveMixedRow('${row.id}')">✕</button>` : '<span style="width:28px;"></span>'}
    </div>
  `).join('') + `
    <button class="co-add-method-btn" onclick="window.coAddMixedRow()">+ Способ оплаты</button>
  `;
}

// =============================================
// ПОДВАЛ — итоги
// =============================================
function computePaidAndChange() {
  if (coActiveTab === 'cash') {
    const paid = Math.min(cashEntered, coTotal);
    const change = Math.max(0, cashEntered - coTotal);
    return { paid, remaining: Math.max(0, coTotal - cashEntered), change };
  }
  if (coActiveTab === 'card') {
    const paid = selectedCardMethodId ? coTotal : 0;
    return { paid, remaining: coTotal - paid, change: 0 };
  }
  if (coActiveTab === 'mixed') {
    const entered = mixedRows.reduce((s, r) => s + (r.amount || 0), 0);
    const paid = Math.min(entered, coTotal);
    const change = Math.max(0, entered - coTotal);
    return { paid, remaining: Math.max(0, coTotal - entered), change };
  }
  if (coActiveTab === 'debt') {
    const paid = Math.min(debtEntered, coTotal);
    return { paid, remaining: Math.max(0, coTotal - debtEntered), change: 0 };
  }
  return { paid: 0, remaining: coTotal, change: 0 };
}

function renderFooter() {
  const { paid, remaining, change } = computePaidAndChange();
  document.getElementById('coTotalAmount').textContent = fmt(coTotal);
  document.getElementById('coPaidAmount').textContent = fmt(paid);
  document.getElementById('coRemainingAmount').textContent = fmt(remaining);
  document.getElementById('coChangeAmount').textContent = fmt(change);

  const hint = document.getElementById('coDebtHint');
  if (hint) hint.style.display = coActiveTab === 'debt' ? 'block' : 'none';

  const btn = document.getElementById('checkoutConfirmBtn');
  btn.disabled = !isCheckoutValid();
}

function isCheckoutValid() {
  if (coActiveTab === 'cash') return cashEntered >= coTotal;
  if (coActiveTab === 'card') return !!selectedCardMethodId;
  if (coActiveTab === 'mixed') {
    const entered = mixedRows.reduce((s, r) => s + (r.amount || 0), 0);
    const allHaveMethod = mixedRows.every(r => r.amount <= 0 || !!r.methodId);
    return entered >= coTotal && allHaveMethod && mixedRows.some(r => r.amount > 0);
  }
  if (coActiveTab === 'debt') return !!coSelectedCustomer; // сумма может быть 0 — это ок
  return false;
}

// =============================================
// ПОКУПАТЕЛЬ
// =============================================
function updateCustomerButton() {
  const btn = document.getElementById('coCustomerBtn');
  if (!btn) return;
  btn.textContent = coSelectedCustomer && coSelectedCustomer.name
    ? '👤 ' + coSelectedCustomer.name
    : 'Выбрать покупателя';
}

window.openCheckoutCustomer = async function () {
  document.getElementById('coCustSearch').value = '';
  document.getElementById('coCustPhone').value = '+7';
  document.getElementById('coCustName').value = '';
  document.getElementById('coCustIin').value = '';
  document.getElementById('coCustCode').value = '';
  document.getElementById('coCustComment').value = '';
  document.getElementById('coCustSelectedId').value = '';

  window.openModal('checkoutCustomerModal');

  try {
    const { data, error } = await supabase
      .from('customers')
      .select('id, name, phone, comment')
      .eq('company_id', window.COMPANY_ID)
      .eq('active', true)
      .order('name');
    if (!error) CUSTOMERS_CACHE = data || [];
  } catch (e) { /* игнор — просто не покажем список */ }

  renderCheckoutCustomerResults(CUSTOMERS_CACHE);
};

window.filterCheckoutCustomers = function () {
  const q = (document.getElementById('coCustSearch').value || '').toLowerCase().trim();
  if (!q) return renderCheckoutCustomerResults(CUSTOMERS_CACHE);
  renderCheckoutCustomerResults(CUSTOMERS_CACHE.filter(c =>
    (c.name || '').toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q)
  ));
};

function renderCheckoutCustomerResults(list) {
  const container = document.getElementById('coCustResults');
  if (!container) return;
  if (!list.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = list.slice(0, 20).map(c => `
    <div class="co-cust-item" onclick="window.pickCheckoutCustomer('${c.id}', '${(c.name || '').replace(/'/g, "\\'")}', '${(c.phone || '').replace(/'/g, "\\'")}')">
      <strong>${c.name || '—'}</strong>${c.phone ? ' · ' + c.phone : ''}
    </div>
  `).join('');
}

window.pickCheckoutCustomer = function (id, name, phone) {
  coSelectedCustomer = { id, name, phone };
  updateCustomerButton();
  window.closeModal('checkoutCustomerModal');
  renderFooter();
};

window.saveCheckoutCustomer = async function () {
  const phone = document.getElementById('coCustPhone').value.trim();
  const name = document.getElementById('coCustName').value.trim();
  const iin = document.getElementById('coCustIin').value.trim();
  const code = document.getElementById('coCustCode').value.trim();
  const comment = document.getElementById('coCustComment').value.trim();

  if (!phone || phone === '+7') { window.showToast('Введите номер телефона', 'error'); return; }
  if (!name) { window.showToast('Введите имя покупателя', 'error'); return; }

  try {
    const { data, error } = await supabase
      .from('customers')
      .insert({
        company_id: window.COMPANY_ID,
        name, phone,
        iin_bin: iin || null,
        customer_code: code || null,
        comment: comment || null
      })
      .select('id, name, phone')
      .single();

    if (error) throw error;

    CUSTOMERS_CACHE.push(data);
    coSelectedCustomer = { id: data.id, name: data.name, phone: data.phone };
    updateCustomerButton();
    window.closeModal('checkoutCustomerModal');
    renderFooter();
    window.showToast('✅ Покупатель добавлен');
  } catch (err) {
    window.showToast('❌ Ошибка: ' + (err.message || 'не удалось сохранить'), 'error');
  }
};

// =============================================
// ПОДТВЕРЖДЕНИЕ ОПЛАТЫ
// =============================================
window.confirmCheckoutPayment = async function () {
  if (coSubmitting) return;
  if (!isCheckoutValid()) return;

  coSubmitting = true;
  const btn = document.getElementById('checkoutConfirmBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Сохранение...';

  try {
    let payments = [];
    let primaryPaymentMethod = null;
    let isDebt = false;
    let debtAmount = 0;

    if (coActiveTab === 'cash') {
      const cashMethod = await getCashMethod();
      if (!cashMethod) throw new Error('Не удалось определить способ оплаты "Наличные"');
      primaryPaymentMethod = cashMethod.id;
      payments = [{ payment_method: cashMethod.id, amount: coTotal }];

    } else if (coActiveTab === 'card') {
      if (!selectedCardMethodId) throw new Error('Выберите способ оплаты');
      primaryPaymentMethod = selectedCardMethodId;
      payments = [{ payment_method: selectedCardMethodId, amount: coTotal }];

    } else if (coActiveTab === 'mixed') {
      const rows = mixedRows.filter(r => r.amount > 0 && r.methodId);
      if (!rows.length) throw new Error('Добавьте способы оплаты');
      payments = rows.map(r => ({ payment_method: r.methodId, amount: r.amount }));
      // основной способ — тот, где сумма больше
      const primary = rows.reduce((a, b) => (b.amount > a.amount ? b : a));
      primaryPaymentMethod = primary.methodId;

    } else if (coActiveTab === 'debt') {
      if (!coSelectedCustomer) throw new Error('Выберите покупателя');
      const debtMethod = await getDebtMethod();
      if (!debtMethod) throw new Error('Не удалось определить способ оплаты "Долг"');

      isDebt = debtEntered < coTotal;
      debtAmount = Math.max(0, coTotal - debtEntered);

      if (debtEntered > 0) {
        const cashMethod = await getCashMethod();
        payments = [{ payment_method: cashMethod.id, amount: Math.min(debtEntered, coTotal) }];
        primaryPaymentMethod = isDebt ? debtMethod.id : cashMethod.id;
      } else {
        payments = [];
        primaryPaymentMethod = debtMethod.id;
      }
    }

    const result = await window.submitSale({
      payments,
      primaryPaymentMethod,
      isDebt,
      debtAmount,
      customerId: coSelectedCustomer ? coSelectedCustomer.id : null
    });

    if (result) {
      window.closeCheckout();
    }

  } catch (err) {
    console.error('Checkout error:', err);
    window.showToast('❌ ' + (err.message || 'Ошибка оплаты'), 'error');
  } finally {
    coSubmitting = false;
    btn.disabled = !isCheckoutValid();
    btn.textContent = originalText;
  }
};
