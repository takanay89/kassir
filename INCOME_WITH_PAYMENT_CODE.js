// =============================================
// ОБНОВЛЕНИЕ ДЛЯ trading-operations.js
// Вставить эти функции в конец файла
// =============================================

// =============================================
// СОЗДАНИЕ ПРИХОДА С ОПЦИЕЙ ОПЛАТЫ
// =============================================

/**
 * Создать приход товара с опциональной оплатой
 * Заменяет старую функцию createIncome
 */
window.createIncomeWithPayment = async function() {
  if (isProcessing) {
    window.showToast('Операция уже выполняется', 'error');
    return;
  }

  const items = incomeState.items;
  if (!items || items.length === 0) {
    window.showToast('Добавьте товары в приход', 'error');
    return;
  }

  const supplierId = document.getElementById('incomeSupplier')?.value;
  const supplierName = document.getElementById('incomeSupplier')?.selectedOptions[0]?.text || 'Не указан';
  const paymentMethodId = document.getElementById('incomePaymentMethod')?.value;
  const comment = document.getElementById('incomeComment')?.value || '';

  // Новые поля для оплаты
  const payNowCheckbox = document.getElementById('incomePayNow');
  const payNow = payNowCheckbox ? payNowCheckbox.checked : false;
  const paymentAmount = payNow ? parseFloat(document.getElementById('incomePaymentAmount')?.value || 0) : 0;

  if (!supplierId) {
    window.showToast('Выберите поставщика', 'error');
    return;
  }

  if (!paymentMethodId) {
    window.showToast('Выберите способ оплаты', 'error');
    return;
  }

  // Расчёт общей суммы документа
  const totalAmount = items.reduce((sum, item) => {
    return sum + (Number(item.quantity) * Number(item.cost_price));
  }, 0);

  // Валидация суммы оплаты
  if (payNow && paymentAmount > totalAmount) {
    window.showToast(`Сумма оплаты (${paymentAmount.toFixed(2)} ₸) превышает сумму документа (${totalAmount.toFixed(2)} ₸)`, 'error');
    return;
  }

  if (payNow && paymentAmount <= 0) {
    window.showToast('Укажите сумму оплаты', 'error');
    return;
  }

  try {
    isProcessing = true;

    // Получаем warehouse_id
    const warehouseId = await getWarehouseWithFallback();

    // Формируем данные для функции
    const purchaseData = {
      p_company_id: window.COMPANY_ID,
      p_warehouse_id: warehouseId,
      p_store_location_id: window.STORE_LOCATION_ID,
      p_payment_method: paymentMethodId,
      p_supplier_id: supplierId,
      p_supplier_name: supplierName,
      p_comment: comment,
      p_items: items.map(item => ({
        product_id: item.product_id,
        quantity: Number(item.quantity),
        cost_price: Number(item.cost_price)
      })),
      p_pay_now: payNow,
      p_payment_amount: paymentAmount
    };

    // Вызываем новую функцию БД
    const { data, error } = await supabase.rpc('create_purchase_with_payment', purchaseData);

    if (error) {
      throw error;
    }

    // Формируем сообщение об успехе
    let message = `✅ Приход оформлен на сумму ${totalAmount.toFixed(2)} ₸`;
    if (payNow) {
      const remainingDebt = totalAmount - paymentAmount;
      if (remainingDebt > 0) {
        message += `\n💰 Оплачено: ${paymentAmount.toFixed(2)} ₸\n📋 Остаток долга: ${remainingDebt.toFixed(2)} ₸`;
      } else {
        message += `\n✅ Полностью оплачено`;
      }
    } else {
      message += `\n📋 Создан долг на всю сумму`;
    }

    window.showToast(message, 'success');

    // Очищаем состояние
    clearCurrentState();
    renderIncomeList();
    
    // Обновляем список товаров
    await loadProducts(window.COMPANY_ID);
    await renderProducts();

  } catch (error) {
    console.error('Ошибка создания прихода:', error);
    window.showToast('Ошибка: ' + error.message, 'error');
  } finally {
    isProcessing = false;
  }
};

// =============================================
// ОБРАБОТЧИК CHECKBOX "ОПЛАТИТЬ СЕЙЧАС"
// =============================================

window.toggleIncomePayment = function() {
  const checkbox = document.getElementById('incomePayNow');
  const paymentBlock = document.getElementById('incomePaymentBlock');
  
  if (checkbox && paymentBlock) {
    if (checkbox.checked) {
      paymentBlock.style.display = 'block';
      
      // Автозаполнение суммы = сумме документа
      const totalAmount = incomeState.items.reduce((sum, item) => {
        return sum + (Number(item.quantity) * Number(item.cost_price));
      }, 0);
      
      const amountInput = document.getElementById('incomePaymentAmount');
      if (amountInput) {
        amountInput.value = totalAmount.toFixed(2);
        amountInput.max = totalAmount.toFixed(2);
      }
    } else {
      paymentBlock.style.display = 'none';
    }
  }
};

// =============================================
// ПЕРЕСЧЁТ СУММЫ ПРИ ИЗМЕНЕНИИ ТОВАРОВ
// =============================================

// Эту функцию нужно вызывать после добавления/удаления товаров в приходе
window.updateIncomePaymentAmount = function() {
  const checkbox = document.getElementById('incomePayNow');
  const amountInput = document.getElementById('incomePaymentAmount');
  
  if (checkbox && checkbox.checked && amountInput) {
    const totalAmount = incomeState.items.reduce((sum, item) => {
      return sum + (Number(item.quantity) * Number(item.cost_price));
    }, 0);
    
    amountInput.max = totalAmount.toFixed(2);
    
    // Если текущая сумма больше новой максимальной - корректируем
    if (Number(amountInput.value) > totalAmount) {
      amountInput.value = totalAmount.toFixed(2);
    }
  }
};
