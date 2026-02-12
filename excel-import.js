// =============================================
// EXCEL IMPORT — массовая загрузка товаров
// =============================================
// Логика:
//  • Штрихкод обязателен
//  • Дубликат по штрихкоду:
//      - цены совпадают → прибавить количество
//      - цены разные    → оприходовать по новым ценам (обновить товар)
//  • Количество 0 → только прайс (product_balances не трогаем)
//  • Количество > 0 → создаём/обновляем product_balances

import { supabase } from './supabaseClient.js';

// Данные текущего импорта (заполняются при парсинге, используются при подтверждении)
let _importRows   = [];   // { barcode, name, sku, type, sale_price, purchase_price, quantity, unit, comment }
let _importErrors = [];   // строки с ошибками валидации

// ─── СКАЧАТЬ ШАБЛОН ────────────────────────────────────────────────────────
window.downloadExcelTemplate = function() {
  // Генерируем CSV как запасной вариант (не требует библиотек)
  // Шаблон Excel лежит в публичной папке проекта
  const link = document.createElement('a');
  link.href = '/products_template.xlsx';
  link.download = 'шаблон_товары.xlsx';
  link.click();
};

// ─── ОБРАБОТКА ЗАГРУЖЕННОГО ФАЙЛА ──────────────────────────────────────────
window.handleExcelUpload = async function(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Сбрасываем input чтобы можно было загрузить тот же файл повторно
  event.target.value = '';

  window.showToast('📊 Читаем файл...');

  try {
    const rows = await parseExcelFile(file);
    showImportPreview(rows);
  } catch (err) {
    window.showToast('❌ Ошибка чтения файла: ' + err.message, 'error');
  }
};

// ─── ПАРСИНГ XLSX ЧЕРЕЗ SheetJS (CDN) ──────────────────────────────────────
async function parseExcelFile(file) {
  // Загружаем SheetJS если ещё не загружен
  if (!window.XLSX) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  }

  const buffer = await file.arrayBuffer();
  const wb     = window.XLSX.read(buffer, { type: 'array' });
  const ws     = wb.Sheets[wb.SheetNames[0]];
  const raw    = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Ищем строку заголовков (содержит "Штрихкод" или "barcode")
  let headerRow = -1;
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    const row = raw[i].map(c => String(c).toLowerCase().trim());
    if (row.some(c => c.includes('штрих') || c.includes('barcode'))) {
      headerRow = i;
      break;
    }
  }

  if (headerRow === -1) {
    throw new Error('Не найдена строка заголовков. Убедитесь что используете наш шаблон.');
  }

  // ИСПРАВЛЕНИЕ: нормализуем заголовки - убираем пробелы, приводим к нижнему регистру, убираем звёздочки
  const headers = raw[headerRow].map(c => 
    String(c)
      .toLowerCase()
      .trim()
      .replace(/\*/g, '')  // убираем звёздочки
      .replace(/\s+/g, ' ') // множественные пробелы в один
  );

  // Маппинг заголовков → индексы колонок
  const col = {
    barcode:        findCol(headers, ['штрихкод', 'barcode', 'штрих']),
    name:           findCol(headers, ['название', 'name', 'наименование']),
    sku:            findCol(headers, ['артикул', 'sku', 'арт']),
    type:           findCol(headers, ['тип', 'type']),
    sale_price:     findCol(headers, ['цена продажи', 'цена', 'sale_price', 'price', 'sale price']),
    purchase_price: findCol(headers, ['себест', 'purchase_price', 'закуп', 'cost', 'себестоимость', 'purchase price']),
    quantity:       findCol(headers, ['количество', 'quantity', 'кол-во', 'кол', 'остаток']),
    unit:           findCol(headers, ['единица', 'unit', 'ед']),
    comment:        findCol(headers, ['комментарий', 'comment', 'примечание']),
  };

  // Диагностика — выводим что нашли в консоль
  console.log('📊 Excel columns found:', col);
  console.log('📊 Headers:', headers);
  console.log('📊 Raw headers:', raw[headerRow]);

  const rows = [];
  const errors = [];

  for (let i = headerRow + 1; i < raw.length; i++) {
    const r = raw[i];

    // Пропускаем пустые строки (нет штрихкода И названия)
    const rawBarcode = String(r[col.barcode] ?? '').trim();
    const rawName    = String(r[col.name]    ?? '').trim();
    if (!rawBarcode && !rawName) continue;

    // Пропускаем строки-описания (4-я строка шаблона)
    if (rawName.includes('Название товара') || rawBarcode.includes('Штрихкод')) continue;

    const rowNum = i + 1;
    const rowErrors = [];

    if (!rawBarcode) rowErrors.push('нет штрихкода');
    if (!rawName)    rowErrors.push('нет названия');

    const rawType  = String(r[col.type] ?? 'product').trim().toLowerCase();
    const typeVal  = rawType === 'service' || rawType === 'услуга' ? 'service' : 'product';

    const salePrice     = parseFloat(String(r[col.sale_price]     ?? '0').replace(',', '.')) || 0;
    const purchasePrice = parseFloat(String(r[col.purchase_price] ?? '0').replace(',', '.')) || 0;
    
    // ИСПРАВЛЕНИЕ: более надёжное извлечение количества
    let quantity = 0;
    if (col.quantity >= 0) {
      const rawQty = r[col.quantity];
      if (rawQty !== undefined && rawQty !== null && rawQty !== '') {
        const qtyStr = String(rawQty).replace(',', '.').replace(/\s/g, '');
        quantity = parseInt(qtyStr) || parseFloat(qtyStr) || 0;
      }
    }
    
    // Логируем для отладки
    console.log(`Row ${rowNum}: barcode=${rawBarcode}, quantity_raw=${r[col.quantity]}, quantity_parsed=${quantity}`);

    if (salePrice < 0)     rowErrors.push('цена не может быть отрицательной');
    if (purchasePrice < 0) rowErrors.push('себестоимость не может быть отрицательной');
    if (quantity < 0)      rowErrors.push('количество не может быть отрицательным');

    if (rowErrors.length > 0) {
      errors.push({ row: rowNum, barcode: rawBarcode || '—', name: rawName || '—', errors: rowErrors });
      continue;
    }

    rows.push({
      _row:           rowNum,
      barcode:        rawBarcode,
      name:           rawName,
      sku:            String(r[col.sku]     ?? '').trim(),
      type:           typeVal,
      sale_price:     salePrice,
      purchase_price: purchasePrice,
      quantity:       quantity,
      unit:           String(r[col.unit]    ?? 'шт').trim() || 'шт',
      comment:        String(r[col.comment] ?? '').trim(),
    });
  }

  _importErrors = errors;
  return rows;
}

function findCol(headers, variants) {
  // Сначала ищем точное совпадение
  for (const v of variants) {
    const idx = headers.findIndex(h => h === v);
    if (idx !== -1) return idx;
  }
  // Потом includes
  for (const v of variants) {
    const idx = headers.findIndex(h => h.includes(v));
    if (idx !== -1) return idx;
  }
  return -1;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload  = resolve;
    s.onerror = () => reject(new Error('Не удалось загрузить ' + src));
    document.head.appendChild(s);
  });
}

// ─── ПОКАЗАТЬ ПРЕВЬЮ ───────────────────────────────────────────────────────
async function showImportPreview(rows) {
  _importRows = rows;

  // Сравниваем с существующими товарами по штрихкоду
  const existingMap = {};
  (window.PRODUCTS_CACHE || []).forEach(p => {
    if (p.barcode) existingMap[String(p.barcode).trim()] = p;
  });

  // Размечаем статус каждой строки
  const annotated = rows.map(row => {
    const existing = existingMap[row.barcode];
    if (!existing) {
      return { ...row, status: 'new', existing: null };
    }
    const pricesMatch =
      Math.abs(Number(existing.base_price || existing.sale_price || 0) - row.sale_price) < 0.01 &&
      Math.abs(Number(existing.cost_price || existing.purchase_price || 0) - row.purchase_price) < 0.01;

    return {
      ...row,
      status:   pricesMatch ? 'add_qty' : 'update_price',
      existing,
    };
  });

  const newCount      = annotated.filter(r => r.status === 'new').length;
  const addQtyCount   = annotated.filter(r => r.status === 'add_qty').length;
  const updateCount   = annotated.filter(r => r.status === 'update_price').length;
  const errorCount    = _importErrors.length;

  // Статистика
  const statsEl = document.getElementById('excelImportStats');
  statsEl.innerHTML = `
    <div style="padding:8px 14px;background:#dcfce7;border-radius:8px;font-size:13px;font-weight:600;color:#166534;">
      ✅ Новых: ${newCount}
    </div>
    <div style="padding:8px 14px;background:#dbeafe;border-radius:8px;font-size:13px;font-weight:600;color:#1e40af;">
      ➕ Пополнение остатка: ${addQtyCount}
    </div>
    <div style="padding:8px 14px;background:#fef9c3;border-radius:8px;font-size:13px;font-weight:600;color:#854d0e;">
      🔄 Новый завоз (новые цены): ${updateCount}
    </div>
    ${errorCount > 0 ? `<div style="padding:8px 14px;background:#fee2e2;border-radius:8px;font-size:13px;font-weight:600;color:#991b1b;">⚠️ Ошибок: ${errorCount}</div>` : ''}
  `;

  // Таблица превью
  const previewEl = document.getElementById('excelImportPreview');

  const statusLabel = {
    new:          '<span style="color:#166534;font-weight:600;font-size:12px;">✅ Новый</span>',
    add_qty:      '<span style="color:#1e40af;font-weight:600;font-size:12px;">➕ +Кол-во</span>',
    update_price: '<span style="color:#854d0e;font-weight:600;font-size:12px;">🔄 Новые цены</span>',
  };

  const rowsHtml = annotated.map((row, i) => `
    <tr style="border-bottom:1px solid var(--border);">
      <td style="padding:8px 6px;color:var(--text-secondary);">${i + 1}</td>
      <td style="padding:8px 6px;font-family:monospace;font-size:12px;">${row.barcode}</td>
      <td style="padding:8px 6px;">${row.name}</td>
      <td style="padding:8px 6px;color:var(--text-secondary);font-size:12px;">${row.sku || '—'}</td>
      <td style="padding:8px 6px;text-align:center;font-size:11px;">${row.type === 'service' ? '🛠️' : '📦'}</td>
      <td style="padding:8px 6px;text-align:right;font-weight:600;">${row.sale_price.toLocaleString('ru-RU')} ₸</td>
      <td style="padding:8px 6px;text-align:right;color:var(--text-secondary);">${row.purchase_price.toLocaleString('ru-RU')} ₸</td>
      <td style="padding:8px 6px;text-align:center;font-weight:600;color:${row.quantity > 0 ? '#059669' : '#6b7280'};">${row.quantity}</td>
      <td style="padding:8px 6px;text-align:center;">${statusLabel[row.status] || '—'}</td>
    </tr>
  `).join('');

  const errorsHtml = _importErrors.length > 0 ? `
    <div style="margin-top:16px;padding:12px;background:#fef2f2;border-radius:8px;border-left:4px solid #dc2626;">
      <div style="font-weight:600;color:#991b1b;margin-bottom:8px;">⚠️ Ошибки валидации:</div>
      <table style="width:100%;font-size:12px;">
        ${_importErrors.map(e => `
          <tr>
            <td style="padding:4px;color:#7f1d1d;">Строка ${e.row}</td>
            <td style="padding:4px;">${e.barcode}</td>
            <td style="padding:4px;">${e.name}</td>
            <td style="padding:4px;color:#dc2626;">${e.errors.join(', ')}</td>
          </tr>
        `).join('')}
      </table>
    </div>
  ` : '';

  previewEl.innerHTML = annotated.length === 0
    ? '<div style="text-align:center;padding:30px;color:var(--text-secondary);">Нет данных для загрузки</div>'
    : `
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:var(--bg-secondary);font-size:11px;color:var(--text-secondary);font-weight:600;text-transform:uppercase;letter-spacing:.04em;">
            <th style="padding:8px 6px;text-align:left;">#</th>
            <th style="padding:8px 6px;text-align:left;">Штрихкод</th>
            <th style="padding:8px 6px;text-align:left;">Название</th>
            <th style="padding:8px 6px;text-align:left;">Артикул</th>
            <th style="padding:8px 6px;text-align:center;">Тип</th>
            <th style="padding:8px 6px;text-align:right;">Цена</th>
            <th style="padding:8px 6px;text-align:right;">Себест.</th>
            <th style="padding:8px 6px;text-align:center;">Кол-во</th>
            <th style="padding:8px 6px;text-align:center;">Статус</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ${errorsHtml}
    `;

  // Обновляем заголовок и кнопку
  document.getElementById('excelImportTitle').textContent =
    `📥 Загрузка товаров из Excel — ${annotated.length} строк`;

  const btn = document.getElementById('excelImportBtn');
  if (annotated.length === 0) {
    btn.disabled = true;
    btn.style.opacity = '0.5';
  } else {
    btn.disabled = false;
    btn.style.opacity = '1';
  }

  // Сохраняем аннотированные данные для confirmExcelImport
  _importRows = annotated;

  openModal('excelImportModal');
}

// ─── ПОДТВЕРЖДЕНИЕ И ЗАГРУЗКА В SUPABASE ───────────────────────────────────
window.confirmExcelImport = async function() {
  if (!_importRows.length) return;

  const btn = document.getElementById('excelImportBtn');
  btn.disabled    = true;
  btn.textContent = 'Загружаем...';

  let successCount = 0;
  let errorCount   = 0;
  const errors     = [];

  try {
    for (const row of _importRows) {
      try {
        await processImportRow(row);
        successCount++;
      } catch (err) {
        errorCount++;
        errors.push(`${row.name} (${row.barcode}): ${err.message}`);
        console.error('Import row error:', row, err);
      }
    }

    closeModal('excelImportModal');

    // Сначала обновляем кеш и таблицу, потом показываем уведомление
    // (иначе loadInitialData удаляет модалку до того как она успевает показаться)
    if (window.loadInitialData)   await window.loadInitialData();
    if (window.loadProductsTable) await window.loadProductsTable();
    if (window.renderIncomeProductsList) window.renderIncomeProductsList();

    if (errorCount === 0) {
      window.showToast(`✅ Загружено ${successCount} товаров`);
      if (window.showQuickStockSuccess) {
        window.showQuickStockSuccess(`Загружено ${successCount} товаров`, successCount, '#3b82f6', '📦');
      }
    } else {
      window.showToast(`⚠️ Загружено ${successCount}, ошибок ${errorCount}`, 'error');
      console.warn('Import errors:', errors);
    }

  } finally {
    btn.disabled    = false;
    btn.textContent = 'Загрузить товары';
  }
};

// ─── ОБРАБОТКА ОДНОЙ СТРОКИ ─────────────────────────────────────────────────
// Используем тот же RPC что и обычный приход — create_purchase_document
// Прямой insert в product_balances не работает из-за RLS политик Supabase
async function processImportRow(row) {
  const companyId = window.COMPANY_ID;

  // Получаем склад через тот же механизм что и trading-operations.js
  const warehouseId = await getWarehouseIdForImport();

  if (row.status === 'new') {
    // ── ШАГ 1: Создаём товар ────────────────────────────────────────────────
    const sku = row.sku || await generateSku(row.name);

    const { data: product, error: pErr } = await supabase
      .from('products')
      .insert({
        company_id:     companyId,
        name:           row.name,
        sku,
        barcode:        row.barcode,
        type:           row.type,
        sale_price:     row.sale_price,
        purchase_price: row.purchase_price,
        unit:           row.unit || 'шт',
        comment:        row.comment || null,
        active:         true,
      })
      .select('id')
      .single();

    if (pErr) throw pErr;

    // ── ШАГ 2: Если есть количество — оприходуем через RPC ──────────────────
    if (row.quantity > 0 && row.type !== 'service') {
      await purchaseViaRpc(warehouseId, [{
        product_id: product.id,
        quantity:   row.quantity,
        cost_price: row.purchase_price || 0,
      }], 'Начальный остаток (импорт Excel)');
    }

  } else if (row.status === 'add_qty') {
    // ── ЦЕНЫ СОВПАДАЮТ — пополняем через RPC ────────────────────────────────
    if (row.quantity <= 0 || row.type === 'service') return;

    await purchaseViaRpc(warehouseId, [{
      product_id: row.existing.id,
      quantity:   row.quantity,
      cost_price: row.purchase_price || 0,
    }], 'Пополнение (импорт Excel)');

  } else if (row.status === 'update_price') {
    // ── ЦЕНЫ РАЗНЫЕ — обновляем цены товара, потом оприходуем ───────────────
    const { error: upErr } = await supabase
      .from('products')
      .update({
        sale_price:     row.sale_price,
        purchase_price: row.purchase_price,
        name:           row.name,
      })
      .eq('id', row.existing.id);

    if (upErr) throw upErr;

    if (row.quantity > 0 && row.type !== 'service') {
      await purchaseViaRpc(warehouseId, [{
        product_id: row.existing.id,
        quantity:   row.quantity,
        cost_price: row.purchase_price || 0,
      }], 'Новый завоз по новым ценам (импорт Excel)');
    }
  }
}

// ─── RPC ПРИХОД — тот же путь что и обычный приход товаров ──────────────────
async function purchaseViaRpc(warehouseId, items, comment) {
  // ✅ НОРМАЛИЗАЦИЯ: явное приведение к типу purchase_item_input[]
  const normalizedItems = items.map(item => ({
    product_id: String(item.product_id),           // UUID как строка
    quantity:   Number(item.quantity) || 0,        // число
    cost_price: Number(item.cost_price) || 0       // число
  }));

  const { data, error } = await supabase.rpc('create_purchase_document', {
    p_company_id:     window.COMPANY_ID,
    p_warehouse_id:   warehouseId,
    p_payment_method: null,
    p_supplier_id:    null,
    p_items:          normalizedItems,  // ← передаём нормализованные данные
    p_comment:        comment,
  });

  if (error) throw error;

  // После прихода на склад — перемещаем в торговую точку (как делает autoTransferToStore)
  if (window.STORE_LOCATION_ID && warehouseId) {
    for (const item of items) {
      try {
        await supabase.rpc('transfer_stock', {
          p_company_id:          window.COMPANY_ID,
          p_product_id:          item.product_id,
          p_quantity:            item.quantity,
          p_from_warehouse_id:   warehouseId,
          p_to_store_location_id: window.STORE_LOCATION_ID,
        });
      } catch (transferError) {
        // Тихо игнорируем ошибки переноса — у некоторых компаний нет этой RPC
        console.warn('Transfer stock failed (ignored):', transferError);
      }
    }
  }

  return data;
}

// ─── ВСПОМОГАТЕЛЬНЫЕ ─────────────────────────────────────────────────────────
async function getWarehouseIdForImport() {
  // Используем тот же кеш что и trading-operations.js
  if (window.WAREHOUSE_CACHE) return window.WAREHOUSE_CACHE;
  if (window.WAREHOUSE_ID)    return window.WAREHOUSE_ID;

  const { data, error } = await supabase
    .from('warehouses')
    .select('id')
    .eq('company_id', window.COMPANY_ID)
    .limit(1);

  if (error || !data || data.length === 0) {
    throw new Error('Склад не найден. Создайте склад в настройках.');
  }

  window.WAREHOUSE_CACHE = data[0].id;
  return data[0].id;
}

async function generateSku(name) {
  // Простой артикул из первых букв + случайные цифры
  const prefix = (name || 'SKU')
    .replace(/[^a-zA-ZА-ЯёЁа-я0-9]/g, '')
    .substring(0, 4)
    .toUpperCase();
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${suffix}`;
}