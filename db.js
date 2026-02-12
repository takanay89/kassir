// =============================================
// IndexedDB - ЛОКАЛЬНОЕ ХРАНИЛИЩЕ
// =============================================

const DB_NAME = 'kassir_pos_db';
const DB_VERSION = 2;

let db = null;

// =============================================
// ИНИЦИАЛИЗАЦИЯ БД
// =============================================
export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      console.log('✅ IndexedDB инициализирована');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Товары (кеш)
      if (!db.objectStoreNames.contains('products')) {
        const productsStore = db.createObjectStore('products', { keyPath: 'id' });
        productsStore.createIndex('company_id', 'company_id', { unique: false });
        productsStore.createIndex('name', 'name', { unique: false });
      }

      // OFFLINE INTENT LOG (намерения, НЕ факты)
      if (db.objectStoreNames.contains('pending_sales')) {
        db.deleteObjectStore('pending_sales');
      }
      const salesStore = db.createObjectStore('pending_sales', { keyPath: 'local_sale_id' });
      salesStore.createIndex('timestamp', 'timestamp', { unique: false });
      salesStore.createIndex('status', 'status', { unique: false });

      // Методы оплаты (кеш)
      if (!db.objectStoreNames.contains('payment_methods')) {
        db.createObjectStore('payment_methods', { keyPath: 'id' });
      }

      // Настройки
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      console.log('✅ IndexedDB структура создана');
    };
  });
}

// =============================================
// РАБОТА С ТОВАРАМИ
// =============================================
export async function saveProductsToLocal(products) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['products'], 'readwrite');
    const store = transaction.objectStore('products');

    store.clear();
    
    // Сохраняем товары с минимальным набором полей + stock_quantity
    products.forEach(product => {
      const productToSave = {
        id: product.id,
        company_id: product.company_id,
        name: product.name,
        sale_price: product.sale_price,
        purchase_price: product.purchase_price,
        sku: product.sku,
        barcode: product.barcode,
        stock_quantity: product.stock_quantity !== undefined ? product.stock_quantity : 0,
        // Сохраняем product_balances для пересчета при загрузке
        product_balances: product.product_balances || []
      };
      
      store.add(productToSave);
    });

    transaction.oncomplete = () => {
      console.log(`✅ ${products.length} товаров сохранено в IndexedDB (с остатками)`);
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getProductsFromLocal(companyId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['products'], 'readonly');
    const store = transaction.objectStore('products');
    const index = store.index('company_id');
    const request = index.getAll(companyId);

    request.onsuccess = () => {
      const products = request.result || [];
      
      // Пересчитываем stock_quantity для каждого товара
      const productsWithStock = products.map(product => {
        // Если product_balances есть, пересчитываем
        if (product.product_balances && product.product_balances.length > 0) {
          const totalQuantity = product.product_balances.reduce((sum, balance) => {
            return sum + Number(balance.quantity || 0);
          }, 0);
          
          return {
            ...product,
            stock_quantity: totalQuantity
          };
        }
        
        // Если нет product_balances, но есть stock_quantity - используем его
        if (product.stock_quantity !== undefined) {
          return product;
        }
        
        // Иначе stock_quantity = 0
        return {
          ...product,
          stock_quantity: 0
        };
      });
      
      resolve(productsWithStock);
    };
    request.onerror = () => reject(request.error);
  });
}

// =============================================
// РАБОТА С МЕТОДАМИ ОПЛАТЫ
// =============================================
export async function savePaymentMethodsToLocal(methods) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['payment_methods'], 'readwrite');
    const store = transaction.objectStore('payment_methods');

    store.clear();
    methods.forEach(method => {
      store.add(method);
    });

    transaction.oncomplete = () => {
      console.log(`✅ ${methods.length} методов оплаты сохранено`);
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getPaymentMethodsFromLocal() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['payment_methods'], 'readonly');
    const store = transaction.objectStore('payment_methods');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// =============================================
// OFFLINE INTENT LOG (НАМЕРЕНИЯ)
// =============================================
export async function savePendingSale(saleData) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['pending_sales'], 'readwrite');
    const store = transaction.objectStore('pending_sales');

    const localSaleId = crypto.randomUUID();

    const pendingSale = {
      local_sale_id: localSaleId,
      company_id: saleData.company_id,
      total_amount: saleData.total_amount,
      payment_method: saleData.payment_method,
      comment: saleData.comment,
      customer_id: saleData.customer_id,
      store_location_id: saleData.store_location_id,
      items: saleData.items,
      timestamp: Date.now(),
      status: 'pending_sync'
    };

    const request = store.add(pendingSale);

    request.onsuccess = () => {
      console.log('✅ OFFLINE INTENT: продажа сохранена локально', localSaleId);
      resolve(localSaleId);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getPendingSales() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['pending_sales'], 'readonly');
    const store = transaction.objectStore('pending_sales');
    // Возвращаем и pending_sync, и synced — sync.js сам разбирается
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function deletePendingSale(localSaleId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['pending_sales'], 'readwrite');
    const store = transaction.objectStore('pending_sales');
    const request = store.delete(localSaleId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Помечаем продажу как синхронизированную ДО удаления из очереди.
// Если процесс прервётся между RPC-успехом и deletePendingSale,
// при следующей попытке синхронизации запись будет иметь status='synced'
// и synced_sale_id — это сигнал пропустить RPC и просто удалить.
export async function markSaleAsSynced(localSaleId, syncedSaleId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['pending_sales'], 'readwrite');
    const store = transaction.objectStore('pending_sales');

    // Читаем текущую запись
    const getRequest = store.get(localSaleId);

    getRequest.onsuccess = () => {
      const record = getRequest.result;
      if (!record) {
        // Запись уже удалена — всё в порядке
        resolve();
        return;
      }
      // Обновляем статус и сохраняем sale_id из БД
      record.status = 'synced';
      record.synced_sale_id = syncedSaleId;
      const putRequest = store.put(record);
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

// =============================================
// НАСТРОЙКИ
// =============================================
export async function saveSetting(key, value) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['settings'], 'readwrite');
    const store = transaction.objectStore('settings');
    const request = store.put({ key, value });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getSetting(key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['settings'], 'readonly');
    const store = transaction.objectStore('settings');
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(request.error);
  });
}