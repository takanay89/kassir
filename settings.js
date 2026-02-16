// =============================================
// SETTINGS.JS — логика вкладки "Настройки"
// =============================================

import { supabase } from './supabaseClient.js';

// ---------- ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК ----------
window.switchSettingsTab = function(tab) {
  document.querySelectorAll('#section-settings .trading-tab-content').forEach(el => {
    el.classList.remove('active');
  });
  document.querySelectorAll('#section-settings .tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.getElementById(`tab-set-${tab.replace('set-', '')}`).classList.add('active');
  document.querySelector(`[data-tab="set-${tab.replace('set-', '')}"]`)?.classList.add('active');

  // Загружаем данные при переходе
  if (tab === 'set-company')   loadSettingsCompany();
  if (tab === 'set-staff')     loadSettingsStaff();
  if (tab === 'set-payments')  loadSettingsPayments();
  if (tab === 'set-promos')    loadSettingsPromos();
  if (tab === 'set-expenses')  loadSettingsExpenseCats();
  if (tab === 'set-system')    loadSettingsSystem();
};

// Загружаем при открытии раздела
window.onShowSettings = function() {
  loadSettingsCompany();
};

// ---------- КОМПАНИЯ ----------
async function loadSettingsCompany() {
  const companyId = window.COMPANY_ID;
  if (!companyId) return;

  // Название
  const { data: company } = await supabase
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .single();
  if (company) {
    document.getElementById('settingCompanyName').value = company.name || '';
  }

  // Торговые точки
  const { data: stores } = await supabase
    .from('store_locations')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at');

  const storesList = document.getElementById('storeLocationsList');
  const selectedStoreId = localStorage.getItem('selected_store_id');
  
  if (!stores || stores.length === 0) {
    storesList.innerHTML = '<div class="settings-empty">Нет торговых точек</div>';
  } else {
    storesList.innerHTML = stores.map(s => {
      const isSelected = s.id === selectedStoreId;
      const safeName = (s.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
      const safeAddress = (s.address || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
      return `
      <div class="settings-list-item store-location-item ${isSelected ? 'selected-store' : ''}" 
           data-store-id="${s.id}"
           onclick="selectStoreLocation('${s.id}', '${safeName}')"
           style="cursor: pointer; transition: all 0.2s;">
        <div class="settings-item-info">
          <div class="settings-item-name">${s.name} ${isSelected ? '<span style="color:#10b981;margin-left:8px;">✓ Выбрано</span>' : ''}</div>
          ${s.address ? `<div class="settings-item-meta">${s.address}</div>` : ''}
        </div>
        <div class="settings-item-actions">
          <button class="btn-edit-sm" onclick="event.stopPropagation(); openEditStoreModal('${s.id}','${safeName}','${safeAddress}')">✏️</button>
        </div>
      </div>
    `;
    }).join('');
  }


  // Склады
  const { data: warehouses } = await supabase
    .from('warehouses')
    .select('*')
    .eq('company_id', companyId)
    .order('name');

  const warehousesList = document.getElementById('warehousesList');
  if (!warehouses || warehouses.length === 0) {
    warehousesList.innerHTML = '<div class="settings-empty">Нет складов</div>';
  } else {
    warehousesList.innerHTML = warehouses.map(w => `
      <div class="settings-list-item">
        <div class="settings-item-info">
          <div class="settings-item-name">📦 ${w.name}</div>
        </div>
      </div>
    `).join('');
  }

  // Загрузка Kaspi API токена
  const { data: kaspiIntegration } = await supabase
    .from('company_integrations')
    .select('api_token')
    .eq('company_id', companyId)
    .eq('provider', 'kaspi')
    .single();
  
  const kaspiTokenInput = document.getElementById('kaspiApiToken');
  if (kaspiTokenInput && kaspiIntegration?.api_token) {
    kaspiTokenInput.value = kaspiIntegration.api_token;
  }
}

window.saveCompanyName = async function() {
  const name = document.getElementById('settingCompanyName').value.trim();
  if (!name) return showToast('Введите название', 'error');
  const { error } = await supabase
    .from('companies')
    .update({ name })
    .eq('id', window.COMPANY_ID);
  if (error) return showToast('Ошибка: ' + error.message, 'error');
  document.getElementById('companyName').textContent = name;
  showToast('Название сохранено ✅');
};

// Сохранение Kaspi API токена
window.saveKaspiToken = async function() {
  const token = document.getElementById('kaspiApiToken').value.trim();
  if (!token) return showToast('Введите токен', 'error');

  try {
    // Получаем текущего пользователя
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return showToast('Ошибка получения пользователя', 'error');
    }

    // Находим компанию пользователя
    const { data: link, error: linkError } = await supabase
      .from('company_users')
      .select('company_id')
      .eq('user_id', user.id)
      .single();

    if (linkError || !link) {
      return showToast('Компания не найдена', 'error');
    }

    // Сохраняем токен (UPSERT)
    const { error: upsertError } = await supabase
      .from('company_integrations')
      .upsert({
        company_id: link.company_id,
        provider: 'kaspi',
        api_token: token,
        active: true
      }, {
        onConflict: 'company_id,provider'
      });

    if (upsertError) {
      return showToast('Ошибка сохранения: ' + upsertError.message, 'error');
    }

    showToast('Kaspi токен сохранён ✅');
  } catch (err) {
    showToast('Произошла ошибка: ' + err.message, 'error');
  }
};

// Торговая точка
window.openNewStoreModal = function() {
  document.getElementById('editStoreId').value = '';
  document.getElementById('storeName').value = '';
  document.getElementById('storeAddress').value = '';
  document.getElementById('storeModal').classList.add('active');
};
window.openEditStoreModal = function(id, name, address) {
  document.getElementById('editStoreId').value = id;
  document.getElementById('storeName').value = name;
  document.getElementById('storeAddress').value = address;
  document.getElementById('storeModal').classList.add('active');
};
window.saveStoreLocation = async function() {
  const id = document.getElementById('editStoreId').value;
  const name = document.getElementById('storeName').value.trim();
  const address = document.getElementById('storeAddress').value.trim();
  if (!name) return showToast('Введите название', 'error');

  let error;
  if (id) {
    ({ error } = await supabase.from('store_locations').update({ name, address }).eq('id', id));
  } else {
    ({ error } = await supabase.from('store_locations').insert({ company_id: window.COMPANY_ID, name, address }));
  }
  if (error) return showToast('Ошибка: ' + error.message, 'error');
  closeModal('storeModal');
  showToast(id ? 'Точка обновлена ✅' : 'Точка добавлена ✅');
  loadSettingsCompany();
};

// Склад
window.openNewWarehouseModal = async function() {
  const name = prompt('Название склада:');
  if (!name || !name.trim()) return;
  const { error } = await supabase
    .from('warehouses')
    .insert({ company_id: window.COMPANY_ID, name: name.trim() });
  if (error) return showToast('Ошибка: ' + error.message, 'error');
  showToast('Склад добавлен ✅');
  loadSettingsCompany();
};

// ---------- СОТРУДНИКИ ----------
async function loadSettingsStaff() {
  const companyId = window.COMPANY_ID;
  const { data } = await supabase
    .from('company_users')
    .select(`
      id, role, active,
      user_profiles ( full_name, email )
    `)
    .eq('company_id', companyId)
    .order('created_at');

  const list = document.getElementById('staffList');
  if (!data || data.length === 0) {
    list.innerHTML = '<div class="settings-empty">Нет сотрудников</div>';
    return;
  }

  const roleLabels = {
    owner: 'Владелец', admin: 'Администратор', manager: 'Менеджер',
    cashier: 'Кассир', warehouse: 'Кладовщик', accountant: 'Бухгалтер', seller: 'Продавец'
  };

  list.innerHTML = data.map(u => {
    const profile = u.user_profiles || {};
    const name = profile.full_name || profile.email || 'Пользователь';
    const email = profile.email || '';
    const roleClass = `role-${u.role}`;
    const roleLabel = roleLabels[u.role] || u.role;
    return `
      <div class="settings-list-item">
        <div class="settings-item-info">
          <div class="settings-item-name">${name}</div>
          <div class="settings-item-meta">${email}</div>
        </div>
        <span class="role-badge ${roleClass}">${roleLabel}</span>
        ${u.role !== 'owner' ? `<span style="font-size:12px;color:${u.active ? '#10b981' : '#ef4444'};">${u.active ? '● Активен' : '○ Неактивен'}</span>` : ''}
      </div>
    `;
  }).join('');
}

window.openInviteModal = function() {
  document.getElementById('inviteEmail').value = '';
  document.getElementById('inviteRole').value = 'cashier';
  document.getElementById('inviteModal').classList.add('active');
};

window.sendInvite = async function() {
  const email = document.getElementById('inviteEmail').value.trim();
  const role = document.getElementById('inviteRole').value;
  if (!email) return showToast('Введите email', 'error');

  const { data: { user } } = await supabase.auth.getUser();
  
  // Вызываем функцию invite_user
  const { data, error } = await supabase.rpc('invite_user', {
    p_company_id: window.COMPANY_ID,
    p_email: email,
    p_role: role,
    p_invited_by: user.id
  });
  
  if (error) return showToast('Ошибка: ' + error.message, 'error');

  // Показываем ссылку приглашения
  try {
    const inviteUrl = `${window.location.origin}/accept-invite.html?token=${data.token}`;
    
    // Показываем модальное окно со ссылкой для копирования
    showInvitationLink(inviteUrl, email);
    
  } catch (emailError) {
    console.error('Email sending error:', emailError);
    showToast('Приглашение создано, но email не отправлен', 'warning');
  }

  closeModal('inviteModal');
  showToast('Приглашение создано ✅');
};

// ---------- МЕТОДЫ ОПЛАТЫ ----------
async function loadSettingsPayments() {
  const { data } = await supabase
    .from('payment_methods')
    .select('*')
    .eq('company_id', window.COMPANY_ID)
    .order('name');

  const list = document.getElementById('paymentMethodsList');
  if (!data || data.length === 0) {
    list.innerHTML = '<div class="settings-empty">Нет методов оплаты</div>';
    return;
  }
  list.innerHTML = data.map(pm => `
    <div class="settings-list-item">
      <div class="settings-item-info">
        <div class="settings-item-name">💳 ${pm.name}</div>
        <div class="settings-item-meta">${pm.is_system ? 'Системный' : 'Пользовательский'}</div>
      </div>
      ${!pm.is_system ? `
        <button class="btn-danger-sm" onclick="deletePaymentMethod('${pm.id}')">Удалить</button>
      ` : ''}
    </div>
  `).join('');
}

window.openNewPaymentMethodModal = function() {
  document.getElementById('newPaymentMethodName').value = '';
  document.getElementById('paymentMethodModal').classList.add('active');
};

window.savePaymentMethod = async function() {
  const name = document.getElementById('newPaymentMethodName').value.trim();
  if (!name) return showToast('Введите название', 'error');
  const { error } = await supabase
    .from('payment_methods')
    .insert({ name, company_id: window.COMPANY_ID, is_system: false });
  if (error) return showToast('Ошибка: ' + error.message, 'error');
  closeModal('paymentMethodModal');
  showToast('Метод оплаты добавлен ✅');
  loadSettingsPayments();
};

window.deletePaymentMethod = async function(id) {
  if (!confirm('Удалить метод оплаты?')) return;
  const { error } = await supabase.from('payment_methods').delete().eq('id', id);
  if (error) return showToast('Ошибка: ' + error.message, 'error');
  showToast('Удалено ✅');
  loadSettingsPayments();
};

// ---------- ПРОМОКОДЫ ----------
async function loadSettingsPromos() {
  const { data } = await supabase
    .from('promo_codes')
    .select('*')
    .eq('company_id', window.COMPANY_ID)
    .order('created_at', { ascending: false });

  const list = document.getElementById('promoCodesList');
  if (!data || data.length === 0) {
    list.innerHTML = '<div class="settings-empty">Нет промокодов. Создайте первый!</div>';
    return;
  }

  list.innerHTML = data.map(p => {
    const from = new Date(p.valid_from).toLocaleDateString('ru-RU');
    const until = new Date(p.valid_until).toLocaleDateString('ru-RU');
    const discountStr = p.discount_type === 'percent'
      ? `${p.discount_value}%`
      : `${p.discount_value.toLocaleString()} ₸`;
    const usageStr = p.usage_limit ? `${p.usage_count}/${p.usage_limit} исп.` : `${p.usage_count} исп.`;
    return `
      <div class="promo-item">
        <div>
          <span class="promo-code-badge">${p.code}</span>
          ${p.description ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">${p.description}</div>` : ''}
          <div class="promo-dates">${from} — ${until} · ${usageStr}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="promo-discount">−${discountStr}</span>
          <button class="promo-toggle ${p.is_active ? 'active' : 'inactive'}"
            onclick="togglePromo('${p.id}', ${p.is_active})"
            title="${p.is_active ? 'Отключить' : 'Включить'}">
            ${p.is_active ? '✓' : '○'}
          </button>
          <button class="btn-edit-sm" onclick="openEditPromoModal(${JSON.stringify(p).replace(/"/g, '&quot;')})">✏️</button>
          <button class="btn-danger-sm" onclick="deletePromo('${p.id}')">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

window.openNewPromoModal = function() {
  document.getElementById('editPromoId').value = '';
  document.getElementById('promoModalTitle').textContent = 'Создать промокод';
  document.getElementById('promoCode').value = '';
  document.getElementById('promoDescription').value = '';
  document.getElementById('promoDiscountType').value = 'percent';
  document.getElementById('promoDiscountValue').value = '';
  document.getElementById('promoValidFrom').value = new Date().toISOString().split('T')[0];
  document.getElementById('promoValidUntil').value = '';
  document.getElementById('promoMinAmount').value = '';
  document.getElementById('promoUsageLimit').value = '';
  document.getElementById('promoModal').classList.add('active');
};

window.openEditPromoModal = function(p) {
  document.getElementById('editPromoId').value = p.id;
  document.getElementById('promoModalTitle').textContent = 'Редактировать промокод';
  document.getElementById('promoCode').value = p.code;
  document.getElementById('promoDescription').value = p.description || '';
  document.getElementById('promoDiscountType').value = p.discount_type;
  document.getElementById('promoDiscountValue').value = p.discount_value;
  document.getElementById('promoValidFrom').value = p.valid_from?.split('T')[0] || '';
  document.getElementById('promoValidUntil').value = p.valid_until?.split('T')[0] || '';
  document.getElementById('promoMinAmount').value = p.min_purchase_amount || '';
  document.getElementById('promoUsageLimit').value = p.usage_limit || '';
  document.getElementById('promoModal').classList.add('active');
};

window.savePromoCode = async function() {
  const id = document.getElementById('editPromoId').value;
  const code = document.getElementById('promoCode').value.trim().toUpperCase();
  const description = document.getElementById('promoDescription').value.trim();
  const discount_type = document.getElementById('promoDiscountType').value;
  const discount_value = parseFloat(document.getElementById('promoDiscountValue').value);
  const valid_from = document.getElementById('promoValidFrom').value;
  const valid_until = document.getElementById('promoValidUntil').value;
  const min_purchase_amount = parseFloat(document.getElementById('promoMinAmount').value) || 0;
  const usage_limit = parseInt(document.getElementById('promoUsageLimit').value) || null;

  if (!code) return showToast('Введите код', 'error');
  if (!discount_value || discount_value <= 0) return showToast('Укажите размер скидки', 'error');
  if (!valid_from || !valid_until) return showToast('Укажите даты действия', 'error');

  const payload = {
    company_id: window.COMPANY_ID,
    code,
    description,
    discount_type,
    discount_value,
    valid_from: new Date(valid_from).toISOString(),
    valid_until: new Date(valid_until + 'T23:59:59').toISOString(),
    min_purchase_amount,
    usage_limit,
    is_active: true
  };

  let error;
  if (id) {
    ({ error } = await supabase.from('promo_codes').update(payload).eq('id', id));
  } else {
    ({ error } = await supabase.from('promo_codes').insert(payload));
  }

  if (error) return showToast('Ошибка: ' + error.message, 'error');
  closeModal('promoModal');
  showToast(id ? 'Промокод обновлён ✅' : 'Промокод создан ✅');
  loadSettingsPromos();
};

window.togglePromo = async function(id, currentActive) {
  const { error } = await supabase
    .from('promo_codes')
    .update({ is_active: !currentActive })
    .eq('id', id);
  if (error) return showToast('Ошибка: ' + error.message, 'error');
  showToast(currentActive ? 'Промокод отключён' : 'Промокод включён ✅');
  loadSettingsPromos();
};

window.deletePromo = async function(id) {
  if (!confirm('Удалить промокод?')) return;
  const { error } = await supabase.from('promo_codes').delete().eq('id', id);
  if (error) return showToast('Ошибка: ' + error.message, 'error');
  showToast('Промокод удалён ✅');
  loadSettingsPromos();
};

// ---------- КАТЕГОРИИ РАСХОДОВ ----------
async function loadSettingsExpenseCats() {
  const { data } = await supabase
    .from('expense_categories')
    .select('*')
    .eq('company_id', window.COMPANY_ID)
    .order('name');

  const list = document.getElementById('expenseCategoriesList');
  if (!data || data.length === 0) {
    list.innerHTML = '<div class="settings-empty">Нет категорий. Добавьте первую!</div>';
    return;
  }
  list.innerHTML = data.map(c => `
    <div class="settings-list-item">
      <div class="settings-item-info">
        <div class="settings-item-name">🏷️ ${c.name}</div>
      </div>
      <div class="settings-item-actions">
        <button class="btn-edit-sm" onclick="openEditExpenseCatModal('${c.id}','${c.name}')">✏️</button>
        <button class="btn-danger-sm" onclick="deleteExpenseCat('${c.id}')">✕</button>
      </div>
    </div>
  `).join('');
}

window.openNewExpenseCategoryModal = function() {
  document.getElementById('editExpenseCatId').value = '';
  document.getElementById('expenseCatName').value = '';
  document.getElementById('expenseCategoryModal').classList.add('active');
};
window.openEditExpenseCatModal = function(id, name) {
  document.getElementById('editExpenseCatId').value = id;
  document.getElementById('expenseCatName').value = name;
  document.getElementById('expenseCategoryModal').classList.add('active');
};
window.saveExpenseCategory = async function() {
  const id = document.getElementById('editExpenseCatId').value;
  const name = document.getElementById('expenseCatName').value.trim();
  if (!name) return showToast('Введите название', 'error');
  let error;
  if (id) {
    ({ error } = await supabase.from('expense_categories').update({ name }).eq('id', id));
  } else {
    ({ error } = await supabase.from('expense_categories').insert({ company_id: window.COMPANY_ID, name }));
  }
  if (error) return showToast('Ошибка: ' + error.message, 'error');
  closeModal('expenseCategoryModal');
  showToast(id ? 'Обновлено ✅' : 'Категория добавлена ✅');
  loadSettingsExpenseCats();
};
window.deleteExpenseCat = async function(id) {
  if (!confirm('Удалить категорию?')) return;
  const { error } = await supabase.from('expense_categories').delete().eq('id', id);
  if (error) return showToast('Нельзя удалить — есть связанные расходы', 'error');
  showToast('Удалено ✅');
  loadSettingsExpenseCats();
};

// ---------- СИСТЕМНЫЕ НАСТРОЙКИ ----------
async function loadSettingsSystem() {
  const { data } = await supabase
    .from('company_settings')
    .select('tax_rate, low_stock_threshold, default_currency')
    .eq('company_id', window.COMPANY_ID)
    .single();
  if (!data) return;
  document.getElementById('settingTaxRate').value = data.tax_rate ?? 0;
  document.getElementById('settingLowStock').value = data.low_stock_threshold ?? 5;
  document.getElementById('settingCurrency').value = data.default_currency ?? 'KZT';
}

window.saveSystemSettings = async function() {
  const tax_rate = parseFloat(document.getElementById('settingTaxRate').value) || 0;
  const low_stock_threshold = parseInt(document.getElementById('settingLowStock').value) || 5;
  const default_currency = document.getElementById('settingCurrency').value;

  const { error } = await supabase
    .from('company_settings')
    .update({ tax_rate, low_stock_threshold, default_currency })
    .eq('company_id', window.COMPANY_ID);

  if (error) return showToast('Ошибка: ' + error.message, 'error');
  showToast('Настройки сохранены ✅');
};

// ---------- ПРОМОКОД В КАССЕ ----------
window.onPromoInput = function() {
  // Если кассир начал вводить промокод — очищаем ручную скидку
  const val = document.getElementById('promoCodeInput').value.trim();
  if (val) {
    document.getElementById('discountPercent').value = '';
    document.getElementById('discountAmount').value = '';
    document.getElementById('discountResultText').textContent = '0 ₸';
    document.getElementById('promoResult').style.display = 'none';
  }
};

window.applyPromoCode = async function() {
  const code = document.getElementById('promoCodeInput').value.trim().toUpperCase();
  if (!code) return showToast('Введите промокод', 'error');

  // Получаем текущую сумму из корзины
  const totalText = document.getElementById('totalAmount').textContent;
  const saleAmount = parseFloat(totalText.replace(/[^0-9.]/g, '')) || 0;

  const { data, error } = await supabase.rpc('apply_promo_code', {
    p_company_id: window.COMPANY_ID,
    p_code: code,
    p_sale_amount: saleAmount
  });

  const resultEl = document.getElementById('promoResult');
  resultEl.style.display = 'block';

  if (error || !data || !data[0]?.success) {
    const msg = data?.[0]?.message || error?.message || 'Промокод не найден';
    resultEl.className = 'promo-error';
    resultEl.textContent = '✕ ' + msg;
    // Сбрасываем скидку если была
    window._promoDiscount = 0;
    if (typeof recalcTotal === 'function') recalcTotal();
    return;
  }

  const discount = data[0].discount_amount;
  window._promoDiscount = discount;
  resultEl.className = 'promo-success';
  resultEl.textContent = `✓ Скидка применена: −${discount.toLocaleString()} ₸`;

  // Блокируем ручную скидку
  document.getElementById('manualDiscountBlock').style.opacity = '0.4';
  document.getElementById('manualDiscountBlock').style.pointerEvents = 'none';

  // Пересчитываем итог
  if (typeof recalcTotal === 'function') recalcTotal();
};

// Сброс промокода (вызвать при очистке корзины)
window.resetPromoCode = function() {
  document.getElementById('promoCodeInput').value = '';
  const resultEl = document.getElementById('promoResult');
  resultEl.style.display = 'none';
  resultEl.textContent = '';
  document.getElementById('manualDiscountBlock').style.opacity = '1';
  document.getElementById('manualDiscountBlock').style.pointerEvents = 'auto';
  window._promoDiscount = 0;
};

// Функция для показа ссылки приглашения
function showInvitationLink(url, email) {
  const modal = document.createElement('div');
  modal.className = 'modal active';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 500px;">
      <h3>Приглашение создано</h3>
      <p>Отправьте эту ссылку на email: <strong>${email}</strong></p>
      <div style="background:#f3f4f6;padding:12px;border-radius:6px;margin:16px 0;word-break:break-all;">
        ${url}
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button onclick="navigator.clipboard.writeText('${url}').then(() => showToast('Ссылка скопирована'))" class="btn btn-primary">
          Копировать ссылку
        </button>
        <button onclick="this.closest('.modal').remove()" class="btn">
          Закрыть
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}
