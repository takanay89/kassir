// =============================================
// ИЗОЛИРОВАННЫЕ СОСТОЯНИЯ ВКЛАДОК
// =============================================

// Состояние для ПРОДАЖИ
export const saleState = {
  cart: [],
  selectedPaymentId: null,
  selectedClientId: null,
  discountPercent: 0,
  discountAmount: 0,
  comment: '',
  operationType: 'sale' // ✅ ТИП ОПЕРАЦИИ
};

// Состояние для ПРИХОДА
export const incomeState = {
  cart: [],
  selectedPaymentId: null,
  comment: '',
  operationType: 'purchase' // ✅ ТИП ОПЕРАЦИИ
};

// Состояние для ВОЗВРАТА
export const returnState = {
  cart: [],
  selectedPaymentId: null,
  selectedSaleId: null,
  comment: '',
  operationType: 'refund' // ✅ ТИП ОПЕРАЦИИ
};

// Состояние для СПИСАНИЯ
export const writeoffState = {
  cart: [],
  comment: '',
  operationType: 'write_off' // ✅ ТИП ОПЕРАЦИИ
};

// Состояние для ВОЗВРАТА ПОСТАВЩИКУ
export const supplierReturnState = {
  cart: [],
  comment: '',
  operationType: 'supplier_return' // ✅ ТИП ОПЕРАЦИИ
};

// Текущая активная вкладка
export let currentTab = 'sale';

export function setCurrentTab(tab) {
  currentTab = tab;
  console.log(`📍 Current tab: ${tab}, operation: ${getCurrentState().operationType}`);
}

export function getCurrentTab() {
  return currentTab;
}

// Получить текущее состояние
export function getCurrentState() {
  switch(currentTab) {
    case 'sale': return saleState;
    case 'income': return incomeState;
    case 'return': return returnState;
    case 'writeoff': return writeoffState;
    case 'supplier-return': return supplierReturnState;
    default: return saleState;
  }
}

// Очистить состояние текущей вкладки
export function clearCurrentState() {
  const state = getCurrentState();
  state.cart = [];
  state.selectedPaymentId = null;
  state.comment = '';
  
  if (state.selectedClientId !== undefined) {
    state.selectedClientId = null;
  }
  if (state.selectedSaleId !== undefined) {
    state.selectedSaleId = null;
  }
  if (state.discountPercent !== undefined) {
    state.discountPercent = 0;
    state.discountAmount = 0;
  }
}
