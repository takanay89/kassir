// =============================================
// РАБОТА С ДЕНЬГАМИ (напрямую в тенге)
// =============================================
// Все суммы хранятся и обрабатываются в тенге (целые числа)
// Тийыны не используются

/**
 * Конвертировать тенге в тийыны (НЕ ИСПОЛЬЗУЕТСЯ - возвращает как есть)
 * @param {number} tenge - сумма в тенге
 * @returns {number} сумма в тенге
 */
export function toTiyin(tenge) {
  return tenge;
}

/**
 * Конвертировать тийыны в тенге (НЕ ИСПОЛЬЗУЕТСЯ - возвращает как есть)
 * @param {number} tiyin - сумма в тенге
 * @returns {number} сумма в тенге
 */
export function toTenge(tiyin) {
  return tiyin;
}

/**
 * Сложить суммы
 * @param {...number} amounts - суммы в тенге
 * @returns {number} сумма в тенге
 */
export function add(...amounts) {
  return amounts.reduce((sum, amt) => sum + amt, 0);
}

/**
 * Вычесть суммы
 * @param {number} a - первая сумма в тенге
 * @param {number} b - вторая сумма в тенге
 * @returns {number} разница в тенге
 */
export function subtract(a, b) {
  return a - b;
}

/**
 * Умножить цену на количество
 * @param {number} price - цена в тенге
 * @param {number} quantity - количество
 * @returns {number} сумма в тенге
 */
export function multiply(price, quantity) {
  return price * quantity;
}

/**
 * Применить скидку
 * @param {number} amount - сумма в тенге
 * @param {number} discountValue - значение скидки
 * @param {boolean} isPercent - это процент или фиксированная сумма
 * @returns {number} сумма со скидкой в тенге
 */
export function applyDiscount(amount, discountValue, isPercent = false) {
  if (isPercent) {
    // discountValue - это проценты (например, 10 = 10%)
    const discountAmount = Math.round(amount * discountValue / 100);
    return amount - discountAmount;
  } else {
    // discountValue - это фиксированная сумма в тенге
    return amount - discountValue;
  }
}

/**
 * Рассчитать сумму скидки
 * @param {number} amount - сумма в тенге
 * @param {number} discountValue - значение скидки
 * @param {boolean} isPercent - это процент или фиксированная сумма
 * @returns {number} сумма скидки в тенге
 */
export function calculateDiscount(amount, discountValue, isPercent = false) {
  if (isPercent) {
    return Math.round(amount * discountValue / 100);
  } else {
    return discountValue;
  }
}

/**
 * Форматировать для отображения
 * @param {number} amount - сумма в тенге
 * @returns {string} отформатированная строка
 */
export function format(amount) {
  return new Intl.NumberFormat('ru-KZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount) + ' ₸';
}

/**
 * Рассчитать итоговую сумму для товаров в корзине
 * @param {Array} items - массив товаров [{price, quantity}, ...]
 * @returns {number} итоговая сумма в тенге
 */
export function calculateCartTotal(items) {
  return items.reduce((total, item) => {
    return total + multiply(item.price, item.quantity);
  }, 0);
}

/**
 * Безопасное округление (не требуется, возвращаем как есть)
 * @param {number} value - значение для округления
 * @returns {number} округленное значение
 */
export function roundMoney(value) {
  return Math.round(value);
}