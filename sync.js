// =============================================
// СИНХРОНИЗАЦИЯ С SUPABASE
// =============================================

import { getPendingSales, deletePendingSale, markSaleAsSynced } from './db.js';

let supabase = null;
let isOnline = navigator.onLine;
let companyId = null;
let storeLocationId = null;
let isSyncing = false; // 🔒 MUTEX для защиты от параллельных вызовов

// =============================================
// ИНИЦИАЛИЗАЦИЯ
// =============================================
export function initSync(supabaseClient, company_id, store_location_id) {
  supabase = supabaseClient;
  companyId = company_id;
  storeLocationId = store_location_id;
  
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  
  updateNetworkStatus();
}

// =============================================
// ОБРАБОТКА СЕТИ
// =============================================
function handleOnline() {
  console.log('🟢 Интернет появился');
  isOnline = true;
  updateNetworkStatus();
}

function handleOffline() {
  console.log('🔴 Интернет пропал');
  isOnline = false;
  updateNetworkStatus();
}

function updateNetworkStatus() {
  const statusBar = document.getElementById('statusBar');
  const statusText = statusBar?.querySelector('.status-text');
  const statusDot = statusBar?.querySelector('.status-dot');
  
  if (isOnline) {
    if (statusText) statusText.textContent = 'Online';
    if (statusDot) statusDot.style.background = '#10b981';
  } else {
    if (statusText) statusText.textContent = 'Offline';
    if (statusDot) statusDot.style.background = '#ef4444';
  }
}

export function getNetworkStatus() {
  return isOnline;
}

// =============================================
// СИНХРОНИЗАЦИЯ ПРОДАЖ (СТРОГИЙ 3-ШАГОВЫЙ ПРОЦЕСС)
// =============================================
export async function syncPendingSales() {
  // 🔒 ЗАЩИТА от параллельного вызова
  if (isSyncing) {
    console.log('⏳ Синхронизация уже выполняется, пропуск...');
    return { success: 0, errors: 0 };
  }
  
  if (!isOnline) {
    console.log('⏸️ Оффлайн — синхронизация невозможна');
    return { success: 0, errors: 0 };
  }
  
  try {
    isSyncing = true; // 🔒 БЛОКИРОВКА
    
    const pendingSales = await getPendingSales();
    
    if (!pendingSales.length) {
      console.log('✅ Нет несинхронизированных продаж');
      return { success: 0, errors: 0 };
    }
    
    console.log(`🔄 Синхронизация ${pendingSales.length} продаж...`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const sale of pendingSales) {
      try {
        // Идемпотентность: если запись уже помечена как synced —
        // RPC уже вызывался успешно, просто удаляем из очереди
        if (sale.status === 'synced' && sale.synced_sale_id) {
          await deletePendingSale(sale.local_sale_id);
          successCount++;
          console.log(`⏭️ Продажа ${sale.local_sale_id} уже синхронизирована (${sale.synced_sale_id}), удаляем из очереди`);
          continue;
        }

        const syncedSaleId = await syncSingleSale(sale);

        // Сначала помечаем как synced — защита от прерывания между RPC и удалением
        await markSaleAsSynced(sale.local_sale_id, syncedSaleId);
        await deletePendingSale(sale.local_sale_id);

        successCount++;
        console.log(`✅ Продажа ${sale.local_sale_id} синхронизирована → ${syncedSaleId}`);
      } catch (err) {
        errorCount++;
        console.error(`❌ Ошибка синхронизации продажи ${sale.local_sale_id}:`, err);
      }
    }
    
    if (successCount > 0) {
      showSyncToast(`✅ Синхронизировано: ${successCount} продаж`);
    }
    
    if (errorCount > 0) {
      showSyncToast(`⚠️ Не удалось синхронизировать: ${errorCount} продаж`);
    }
    
    return { success: successCount, errors: errorCount };
    
  } catch (err) {
    console.error('Ошибка синхронизации:', err);
    return { success: 0, errors: 1 };
  } finally {
    isSyncing = false; // 🔓 РАЗБЛОКИРОВКА
  }
}

async function syncSingleSale(pendingSale) {
  const items = pendingSale.items.map(item => ({
    product_id: item.product_id,
    quantity:   item.quantity,
    price:      item.price,
    cost_price: item.cost_price || 0
  }));

  const { data, error } = await supabase.rpc('process_sale', {
    p_company_id:        pendingSale.company_id,
    p_store_location_id: pendingSale.store_location_id || null,
    p_payment_method:    pendingSale.payment_method,
    p_total_amount:      pendingSale.total_amount,
    p_customer_id:       pendingSale.customer_id || null,
    p_comment:           pendingSale.comment || null,
    p_items:             items,
    p_warehouse_id:      null,
    p_operation_at:      pendingSale.operation_at || null
  });

  if (error) throw new Error(error.message);

  if (!data || data.length === 0 || !data[0].success) {
    throw new Error(data?.[0]?.message || 'process_sale вернул неуспех');
  }

  return data[0].sale_id;
}

function showSyncToast(message) {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }
}

// =============================================
// ПРИНУДИТЕЛЬНАЯ СИНХРОНИЗАЦИЯ
// =============================================
export async function forceSyncNow() {
  if (!isOnline) {
    showSyncToast('❌ Нет подключения к интернету');
    return;
  }
  
  showSyncToast('🔄 Синхронизация...');
  const result = await syncPendingSales();
  
  if (result.success === 0 && result.errors === 0) {
    showSyncToast('✅ Нет продаж для синхронизации');
  }
}
