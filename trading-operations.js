// =============================================
// EXCEL IMPORT — массовая загрузка товаров
// =============================================

import { supabase } from './supabaseClient.js';

let _importRows   = [];
let _importErrors = [];
let _existingProductsMap = new Map();

// ─── СКАЧАТЬ ШАБЛОН ────────────────────────────────────────────────────────
window.downloadExcelTemplate = function() {
  const link = document.createElement('a');
  link.href = '/products_template.xlsx';
  link.download = 'шаблон_товары.xlsx';
  link.click();
};

// ─── ОБРАБОТКА ЗАГРУЖЕННОГО ФАЙЛА ──────────────────────────────────────────
window.handleExcelUpload = async function(event) {
  const file = event.target.files[0];
  if (!file) return;

  event.target.value = '';
  window.showToast('📊 Читаем файл...');

  try {
    const rows = await parseExcelFile(file);
    await showImportPreview(rows);
  } catch (err) {
    window.showToast('❌ Ошибка чтения файла: ' + err.message, 'error');
  }
};

// ─── ПАРСИНГ XLSX ЧЕРЕЗ SheetJS (CDN) ──────────────────────────────────────
async function parseExcelFile(file) {
  if (!window.XLSX) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  }

  const buffer = await file.arrayBuffer();
  const wb     = window.XLSX.read(buffer, { type: 'array' });
  const ws     = wb.Sheets[wb.SheetNames[0]];
  const raw    = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

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

  const headers = raw[headerRow].map(c => 
    String(c)
      .toLowerCase()
      .trim()
      .replace(/\*/g, '')
      .replace(/\s+/g, ' ')
  );

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

  const rows = [];
  const errors = [];

  for (let i = headerRow + 1; i < raw.length; i++) {
    const r = raw[i];

    const rawBarcode = String(r[col.barcode] ?? '').trim();
    const rawName    = String(r[col.name]    ?? '').trim();
    if (!rawBarcode && !rawName) continue;

    if (rawName.includes('Название товара') || rawBarcode.includes('Штрихкод')) continue;

    const rowNum = i + 1;
    const rowErrors = [];

    if (!rawBarcode) {
      rowErrors.push('нет штрихкода');
    }
    if (!rawName) rowErrors.push('нет названия');

    const rawType  = String(r[col.type] ?? 'product').trim().toLowerCase();
    const typeVal  = rawType === 'service' || rawType === 'услуга' ? 'service' : 'product';

    const salePrice     = parseFloat(String(r[col.sale_price]     ?? '0').replace(',', '.')) || 0;
    const purchasePrice = parseFloat(String(r[col.purchase_price] ?? '0').replace(',', '.')) || 0;
    
    let quantity = 0;
    if (col.quantity >= 0) {
      const rawQty = r[col.quantity];
      if (rawQty !== undefined && rawQty !== null && rawQty !== '') {
        const qtyStr = String(rawQty).replace(',', '.').replace(/\s/g, '');
        quantity = parseInt(qtyStr) || parseFloat(qtyStr) || 0;
      }
    }

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
  for (const v of variants) {
    const idx = headers.findIndex(h => h === v);
    if (idx !== -1) return idx;
  }
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

  const barcodes = rows
    .map(r => String(r.barcode).trim())
    .filter(Boolean);

  _existingProductsMap = new Map();

  if (barcodes.length > 0) {
    const { data: existingProducts, error } = await supabase
      .from('products')
      .select('id, barcode, sale_price, purchase_price, name, type, sku, unit')
      .eq('company_id', window.COMPANY_ID)
      .in('barcode', barcodes);

    if (!error && existingProducts) {
      existingProducts.forEach(p => {
        _existingProductsMap.set(String(p.barcode).trim(), p);
      });
    }
  }

  const annotated = rows.map(row => {
    const normalizedBarcode = String(row.barcode).trim();
    const existing = _existingProductsMap.get(normalizedBarcode);
    
    if (!existing) {
      return { ...row, status: 'new', existing: null };
    }

    const pricesMatch =
      Math.abs(Number(existing.sale_price || 0) - row.sale_price) < 0.01 &&
      Math.abs(Number(existing.purchase_price || 0) - row.purchase_price) < 0.01;

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

  const statsEl = document.getElementById('excelImportStats');
  statsEl.innerHTML = `
    <div style="padding:8px 14px;background:#dcfce7;border-radius:8px;font-size:13px;font-weight:600;color:#166534;">
      ✅ Новых: ${newCount}
    </div>
    <div style="padding:8px 14px;background:#dbeafe;border-radius:8px;font-size:13px;font-weight:600;color:#1e40af;">
      ➕ Добавить кол-во: ${addQtyCount}
    </div>
    <div style="padding:8px 14px;background:#fef3c7;border-radius:8px;font-size:13px;font-weight:600;color:#92400e;">
      🔄 Обновить: ${updateCount}
    </div>
    ${errorCount > 0 ? `<div style="padding:8px 14px;background:#fee2e2;border-radius:8px;font-size:13px;font-weight:600;color:#991b1b;">❌ Ошибок: ${errorCount}</div>` : ''}
  `;

  const statusLabels = {
    new:          { text: '🆕 Новый',     color: '#10b981' },
    add_qty:      { text: '➕ Добавить',  color: '#3b82f6' },
    update_price: { text: '🔄 Обновить',  color: '#f59e0b' },
  };

  const rowsHtml = annotated.map(row => {
    const badge = statusLabels[row.status];
    return `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:8px 6px;font-size:11px;color:#6b7280;">${row._row}</td>
        <td style="padding:8px 6px;font-size:12px;font-family:monospace;">${row.barcode}</td>
        <td style="padding:8px 6px;font-size:12px;font-weight:500;">${row.name}</td>
        <td style="padding:8px 6px;text-align:center;font-size:11px;">${row.type === 'service' ? '🔧 Услуга' : '📦 Товар'}</td>
        <td style="padding:8px 6px;text-align:right;font-size:12px;font-weight:600;">${row.sale_price.toLocaleString()} ₸</td>
        <td style="padding:8px 6px;text-align:right;font-size:12px;">${row.purchase_price.toLocaleString()} ₸</td>
        <td style="padding:8px 6px;text-align:center;font-size:12px;">${row.quantity}</td>
        <td style="padding:8px 6px;text-align:center;">
          <span style="display:inline-block;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:600;background:${badge.color}22;color:${badge.color};">
            ${badge.text}
          </span>
        </td>
      </tr>
    `;
  }).join('');

  let errorsHtml = '';
  if (_importErrors.length > 0) {
    errorsHtml = `
      <div style="margin-top:16px;padding:12px;background:#fee2e2;border-radius:8px;border:1px solid #fecaca;">
        <div style="font-weight:600;color:#991b1b;margin-bottom:8px;">❌ Строки с ошибками:</div>
        ${_importErrors.map(e => `
          <div style="font-size:12px;color:#7f1d1d;margin-bottom:4px;">
            Строка ${e.row}: <strong>${e.name}</strong> (${e.barcode}) — ${e.errors.join(', ')}
          </div>
        `).join('')}
      </div>
    `;
  }

  document.getElementById('excelImportPreview').innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
            <th style="padding:8px 6px;text-align:left;font-size:11px;color:#6b7280;">#</th>
            <th style="padding:8px 6px;text-align:left;">Штрихкод</th>
            <th style="padding:8px 6px;text-align:left;">Название</th>
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

  for (const row of _importRows) {
    try {
      await processImportRow(row);
      successCount++;
    } catch (err) {
      errorCount++;
      errors.push(`${row.name} (${row.barcode}): ${err.message}`);
    }
  }

  closeModal('excelImportModal');

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
  }

  btn.disabled    = false;
  btn.textContent = 'Загрузить товары';
};

// ─── ОБРАБОТКА ОДНОЙ СТРОКИ ─────────────────────────────────────────────────
async function processImportRow(row) {
  const companyId = window.COMPANY_ID;
  const warehouseId = await getWarehouseIdForImport();
  const normalizedBarcode = String(row.barcode).trim();

  const existing = _existingProductsMap.get(normalizedBarcode);

  if (!existing) {
    const sku = row.sku || await generateSku(row.name);

    const { data: product, error: pErr } = await supabase
      .from('products')
      .insert({
        company_id:     companyId,
        name:           row.name,
        sku,
        barcode:        normalizedBarcode,
        type:           row.type,
        sale_price:     row.sale_price,
        purchase_price: row.purchase_price,
        unit:           row.unit || 'шт',
        comment:        row.comment || null,
        active:         true,
        updated_at:     new Date().toISOString(),
      })
      .select('id')
      .single();

    if (pErr) throw pErr;

    _existingProductsMap.set(normalizedBarcode, {
      id: product.id,
      barcode: normalizedBarcode,
      sale_price: row.sale_price,
      purchase_price: row.purchase_price,
      name: row.name,
      type: row.type,
      sku,
      unit: row.unit || 'шт',
    });

    if (row.quantity > 0 && row.type !== 'service') {
      await purchaseViaRpc(warehouseId, [{
        product_id: product.id,
        quantity:   row.quantity,
        cost_price: row.purchase_price || 0,
      }], 'Начальный остаток (импорт Excel)');
    } else if (row.type !== 'service') {
      const { error: balanceErr } = await supabase
        .from('product_balances')
        .upsert({
          product_id: product.id,
          warehouse_id: warehouseId,
          store_location_id: null,
          quantity: 0
        }, {
          onConflict: 'product_id,warehouse_id,store_location_id'
        });
      
      if (balanceErr) {
        console.warn('Failed to create zero balance for new product:', balanceErr);
      }
    }

  } else {
    const { error: upErr } = await supabase
      .from('products')
      .update({
        sale_price:     row.sale_price,
        purchase_price: row.purchase_price,
        name:           row.name,
      })
      .eq('id', existing.id);

    if (upErr) throw upErr;

    _existingProductsMap.set(normalizedBarcode, {
      ...existing,
      sale_price: row.sale_price,
      purchase_price: row.purchase_price,
      name: row.name,
    });

    if (row.quantity > 0 && row.type !== 'service') {
      await purchaseViaRpc(warehouseId, [{
        product_id: existing.id,
        quantity:   row.quantity,
        cost_price: row.purchase_price || 0,
      }], row.status === 'add_qty' ? 'Пополнение (импорт Excel)' : 'Новый завоз по новым ценам (импорт Excel)');
    } else if (row.type !== 'service') {
      const { error: balanceErr } = await supabase
        .from('product_balances')
        .upsert({
          product_id: existing.id,
          warehouse_id: warehouseId,
          store_location_id: null,
          quantity: 0
        }, {
          onConflict: 'product_id,warehouse_id,store_location_id'
        });
      
      if (balanceErr) {
        console.warn('Failed to create zero balance for existing product:', balanceErr);
      }
    }
  }
}

// ─── RPC ПРИХОД — тот же путь что и обычный приход товаров ──────────────────
async function purchaseViaRpc(warehouseId, items, comment) {
  const normalizedItems = items.map(item => ({
    product_id: String(item.product_id),
    quantity:   Number(item.quantity) || 0,
    cost_price: Number(item.cost_price) || 0
  }));

  const { data, error } = await supabase.rpc('create_purchase_document', {
    p_company_id:     window.COMPANY_ID,
    p_warehouse_id:   warehouseId,
    p_payment_method: null,
    p_supplier_id:    null,
    p_items:          normalizedItems,
    p_comment:        comment,
  });

  if (error) throw error;

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
      }
    }
  }

  return data;
}

// ─── ВСПОМОГАТЕЛЬНЫЕ ─────────────────────────────────────────────────────────
async function getWarehouseIdForImport() {
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
  const prefix = (name || 'SKU')
    .replace(/[^a-zA-ZА-ЯёЁа-я0-9]/g, '')
    .substring(0, 4)
    .toUpperCase();
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${suffix}`;
}
