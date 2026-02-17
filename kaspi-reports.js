// Kaspi Reports Module
// Переписан под реальную структуру HTML (index.html)

let currentChart = null;
let currentCompanyId = null;
let cachedKaspiData = null;


// ─── ИНИЦИАЛИЗАЦИЯ ───────────────────────────────────────────────────────────

function initKaspiReports() {
    console.log('Initializing Kaspi Reports module');
    loadKaspiData();
}

// ─── ЗАГРУЗКА ДАННЫХ ─────────────────────────────────────────────────────────

async function loadKaspiData() {
    showKaspiLoader();
    hideKaspiError();

    try {
        const data = await fetchKaspiData();
        cachedKaspiData = data;
        
        renderKaspiSummary(data);
        renderKaspiOrders(data);
        renderKaspiProducts(data);
        renderKaspiChart(data);
    } catch (error) {
        console.error('Error loading Kaspi data:', error);
        showKaspiError('Ошибка загрузки данных Kaspi: ' + error.message);
    } finally {
        hideKaspiLoader();
    }
}

// ─── ПЕРИОД (берём из глобального состояния отчётов) ─────────────────────────

function getCurrentPeriod() {
    return window.currentPeriod || 'month';
}

function getDateRangeForPeriod(period) {
    // используем глобальную функцию из script.js
    if (window.getPeriodDates) {
        return window.getPeriodDates(period);
    }

    const now = new Date();
    const endDate = now.toISOString();
    let startDate = endDate;

    return { startDate, endDate };
}



// ─── COMPANY ID ───────────────────────────────────────────────────────────────

async function getCurrentCompanyId() {
    if (currentCompanyId) return currentCompanyId;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Пользователь не авторизован');

    const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();

    if (error) throw new Error('Ошибка получения company_id: ' + error.message);
    if (!profile?.company_id) throw new Error('company_id не найден в профиле');

    currentCompanyId = profile.company_id;
    return currentCompanyId;
}

// ─── FETCH ДАННЫХ ─────────────────────────────────────────────────────────────

async function fetchKaspiData() {
    const companyId = await getCurrentCompanyId();
    const period = getCurrentPeriod();
    const { startDate, endDate } = getDateRangeForPeriod(period);

    console.log(`Fetching Kaspi data: ${period} | ${startDate} → ${endDate}`);

    const BATCH_SIZE = 1000;
    let allSales = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
        const { data: sales, error } = await supabase
            .from('sales')
            .select(`
                id,
                external_id,
                external_order_id,
                created_at,
                operation_at,
                total_amount,
                client,
                customer_id,
                kaspi_payment_mode,
                kaspi_commission_percent,
                kaspi_commission_amount,
                kaspi_net_amount,
                kaspi_delivery_cost,
                discount_amount,
                discount_percent,
                source_type,
                status,
                sale_items (
                    product_id,
                    quantity,
                    price,
                    cost_price,
                    products (
                        name,
                        sku
                    )
                )
            `)
            .eq('company_id', companyId)
            .is('deleted_at', null)
            .eq('status', 'completed')
            .not('external_id', 'is', null)
            .not('external_id', 'eq', '')
            .gte('operation_at', startDate)
            .lte('operation_at', endDate)
            .order('operation_at', { ascending: false })
            .range(offset, offset + BATCH_SIZE - 1);

        if (error) throw error;

        if (!sales || sales.length === 0) {
            hasMore = false;
        } else {
            allSales = allSales.concat(sales);
            offset += BATCH_SIZE;
            if (sales.length < BATCH_SIZE) hasMore = false;
        }
    }

    console.log(`Fetched ${allSales.length} Kaspi orders`);
    return allSales;
}

// ─── СВОДКА (Summary) ────────────────────────────────────────────────────────
// Маппинг на реальные ID из HTML:
// kaspiRevenue, kaspiOrdersCount, kaspiCommission, kaspiDelivery, kaspiCost, kaspiProfit

function renderKaspiSummary(sales) {
    const safeSales = sales || [];

    const totalRevenue    = safeSales.reduce((s, o) => s + (parseFloat(o.total_amount)            || 0), 0);
    const totalCommission = safeSales.reduce((s, o) => s + (parseFloat(o.kaspi_commission_amount) || 0), 0);
    const totalDelivery   = safeSales.reduce((s, o) => s + (parseFloat(o.kaspi_delivery_cost)     || 0), 0);
    const totalNet        = safeSales.reduce((s, o) => s + (parseFloat(o.kaspi_net_amount)        || 0), 0);
    const totalOrders     = safeSales.length;

    // Считаем себестоимость через sale_items
    let totalCost = 0;
    safeSales.forEach(sale => {
        (sale.sale_items || []).forEach(item => {
            // purchase_price может быть в products — если нет, пропускаем
            const cost = parseFloat(item.cost_price || 0);
            totalCost += cost * (item.quantity || 0);
        });
    });

    // Чистая прибыль = Net - себестоимость
    const profit = totalNet - totalCost;

    // Обновляем карточки — ID берём из реального HTML
    setEl('kaspiRevenue',     formatCurrency(totalRevenue));
    setEl('kaspiOrdersCount', totalOrders + ' заказов');
    setEl('kaspiCommission',  formatCurrency(totalCommission));
    setEl('kaspiDelivery',    formatCurrency(totalDelivery));
    setEl('kaspiCost',        formatCurrency(totalCost));
    setEl('kaspiProfit',      formatCurrency(profit));

    // Подкрашиваем прибыль
    const profitEl = document.getElementById('kaspiProfit');
    if (profitEl) {
        profitEl.style.color = profit >= 0 ? '#10b981' : '#ef4444';
    }

    console.log(`Kaspi summary: ${totalOrders} orders | revenue ${totalRevenue} | net ${totalNet} | profit ${profit}`);
}

// ─── ЗАКАЗЫ (Orders) ─────────────────────────────────────────────────────────
// HTML контейнер: id="kaspiOrdersTable"

function renderKaspiOrders(sales) {
    const container = document.getElementById('kaspiOrdersTable');
    if (!container) return;

    if (!sales || sales.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">Нет заказов за выбранный период</div>';
        return;
    }
let totalAmountSum = 0;
let totalCommissionSum = 0;
let totalDeliverySum = 0;
let totalCostSum = 0;
let totalProfitSum = 0;

    const rows = sales.map(order => {

    // считаем себестоимость
    let costTotal = 0;
    (order.sale_items || []).forEach(item => {
        const cost = parseFloat(item.cost_price || 0);
        costTotal += cost * (item.quantity || 0);
    });
const orderProfit =
    (parseFloat(order.total_amount || 0)) -
    (parseFloat(order.kaspi_commission_amount || 0)) -
    (parseFloat(order.kaspi_delivery_cost || 0)) -
    costTotal;

totalAmountSum += parseFloat(order.total_amount || 0);
totalCommissionSum += parseFloat(order.kaspi_commission_amount || 0);
totalDeliverySum += parseFloat(order.kaspi_delivery_cost || 0);
totalCostSum += costTotal;
totalProfitSum += orderProfit;

    const products = (order.sale_items || [])
        .map(i => `${escapeHtml(i.products?.name || 'Неизвестно')} (${i.quantity}x)`)
        .join(', ');

    return `
        <tr style="border-bottom:1px solid var(--border-color);">
            <td style="padding:12px 8px;font-size:13px;color:var(--text-primary);">
                ${escapeHtml(order.external_id || order.external_order_id || order.id)}
            </td>
            <td style="padding:12px 8px;font-size:13px;color:var(--text-secondary);">
                ${formatKaspiDate(order.operation_at || order.created_at)}
            </td>
            <td style="padding:12px 8px;font-size:13px;color:var(--text-primary);text-align:right;">
                ${formatCurrency(order.total_amount || 0)}
            </td>
            <td style="padding:12px 8px;font-size:13px;color:#f59e0b;text-align:right;">
                ${formatCurrency(order.kaspi_commission_amount || 0)}
            </td>
            <td style="padding:12px 8px;font-size:13px;color:#8b5cf6;text-align:right;">
                ${formatCurrency(order.kaspi_delivery_cost || 0)}
            </td>
            <td style="padding:12px 8px;font-size:13px;color:#ef4444;text-align:right;">
                ${formatCurrency(costTotal)}
            </td>
            <td style="padding:12px 8px;font-size:13px;color:#10b981;font-weight:600;text-align:right;">
    ${formatCurrency(orderProfit)}

</td>
            <td style="padding:12px 8px;font-size:13px;color:var(--text-secondary);">
                ${order.kaspi_payment_mode || 'Kaspi'}
            </td>
        </tr>
    `;
}).join('');

    container.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
                <tr style="border-bottom:2px solid var(--border-color);background:var(--bg-secondary);">
                    <th style="padding:12px 8px;text-align:left;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;font-size:11px;">ID заказа</th>
                    <th style="padding:12px 8px;text-align:left;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;font-size:11px;">Дата</th>
                    <th style="padding:12px 8px;text-align:right;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;font-size:11px;">Сумма</th>
                    <th style="padding:12px 8px;text-align:right;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;font-size:11px;">Комиссия</th>
                    <th style="padding:12px 8px;text-align:right;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;font-size:11px;">Доставка</th>
                    <th style="padding:12px 8px;text-align:right;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;font-size:11px;">Себестоимость</th>
                    <th style="padding:12px 8px;text-align:right;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;font-size:11px;">Итого</th>
                    <th style="padding:12px 8px;text-align:left;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;font-size:11px;">Тип оплаты</th>
                </tr>
            </thead>
            <tbody>
                ${rows}

                    <tr style="border-top:2px solid var(--border-color);background:var(--bg-secondary);font-weight:700;">
        <td colspan="2" style="padding:14px 8px;">ИТОГО</td>
        <td style="padding:14px 8px;text-align:right;">${formatCurrency(totalAmountSum)}</td>
        <td style="padding:14px 8px;text-align:right;">${formatCurrency(totalCommissionSum)}</td>
        <td style="padding:14px 8px;text-align:right;">${formatCurrency(totalDeliverySum)}</td>
        <td style="padding:14px 8px;text-align:right;">${formatCurrency(totalCostSum)}</td>
        <td style="padding:14px 8px;text-align:right;color:#10b981;">${formatCurrency(totalProfitSum)}</td>
        <td></td>
    </tr>

            </tbody>
        </table>
    `;
}

// ─── ТОВАРЫ (Products) ───────────────────────────────────────────────────────
// HTML контейнер: id="kaspiProductsTable"

function renderKaspiProducts(sales) {
    const container = document.getElementById('kaspiProductsTable');
    if (!container) return;

    if (!sales || sales.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">Нет товаров за выбранный период</div>';
        return;
    }

    // Агрегируем товары
    const productStats = {};

    sales.forEach(sale => {
        (sale.sale_items || []).forEach(item => {
            const productId = item.product_id;
            const productName = item.products?.name || 'Неизвестный товар';
            const sku = item.products?.sku || '';

            if (!productStats[productId]) {
                productStats[productId] = {
                    name: productName,
                    sku: sku,
                    quantity: 0,
                    revenue: 0,
                    cost: 0
                };
            }

            const qty = item.quantity || 0;
            const price = parseFloat(item.price || 0);
            const cost = parseFloat(item.cost_price || 0);

            productStats[productId].quantity += qty;
            productStats[productId].revenue += qty * price;
            productStats[productId].cost += qty * cost;
        });
    });

    // Сортируем по выручке
    const sorted = Object.values(productStats).sort((a, b) => b.revenue - a.revenue);

    const rows = sorted.map(product => {
        const profit = product.revenue - product.cost;
        const profitColor = profit >= 0 ? '#10b981' : '#ef4444';

        return `
            <tr style="border-bottom:1px solid var(--border-color);">
                <td style="padding:12px 8px;font-size:13px;color:var(--text-primary);">
                    ${escapeHtml(product.name)}
                    ${product.sku ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">SKU: ${escapeHtml(product.sku)}</div>` : ''}
                </td>
                <td style="padding:12px 8px;font-size:13px;color:var(--text-primary);text-align:center;">
                    ${product.quantity}
                </td>
                <td style="padding:12px 8px;font-size:13px;color:var(--text-primary);text-align:right;">
                    ${formatCurrency(product.revenue)}
                </td>
                <td style="padding:12px 8px;font-size:13px;color:#ef4444;text-align:right;">
                    ${formatCurrency(product.cost)}
                </td>
                <td style="padding:12px 8px;font-size:13px;font-weight:600;text-align:right;" style="color:${profitColor};">
                    ${formatCurrency(profit)}
                </td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
                <tr style="border-bottom:2px solid var(--border-color);background:var(--bg-secondary);">
                    <th style="padding:12px 8px;text-align:left;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;font-size:11px;">Товар</th>
                    <th style="padding:12px 8px;text-align:center;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;font-size:11px;">Продано</th>
                    <th style="padding:12px 8px;text-align:right;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;font-size:11px;">Выручка</th>
                    <th style="padding:12px 8px;text-align:right;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;font-size:11px;">Себестоимость</th>
                    <th style="padding:12px 8px;text-align:right;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;font-size:11px;">Прибыль</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
    `;
}

// ─── ЧАРТ ─────────────────────────────────────────────────────────────────────

function renderKaspiChart(sales) {
    // Чарт встраивается в summary-таб после карточек
    // Ищем контейнер kaspi-tab-summary
    const summaryTab = document.getElementById('kaspi-tab-summary');
    if (!summaryTab) return;

    // Удаляем старый чарт если есть
    const oldChart = document.getElementById('kaspi-chart-container');
    if (oldChart) oldChart.remove();

    if (!sales || sales.length === 0) return;

    // Агрегируем по дням
    const daily = {};
    sales.forEach(sale => {
        const dateStr = (sale.operation_at || sale.created_at || '').slice(0, 10);
        if (!dateStr) return;
        if (!daily[dateStr]) daily[dateStr] = { revenue: 0, net: 0, orders: 0 };
        daily[dateStr].revenue += parseFloat(sale.total_amount)    || 0;
        daily[dateStr].net     += parseFloat(sale.kaspi_net_amount) || 0;
        daily[dateStr].orders  += 1;
    });

    const dates = Object.keys(daily).sort();
    if (dates.length === 0) return;

    const maxRevenue = Math.max(...dates.map(d => daily[d].revenue), 1);
    const maxOrders  = Math.max(...dates.map(d => daily[d].orders), 1);

    // SVG bar-chart (без зависимостей — Chart.js canvas нет в HTML)
    const BAR_W = Math.max(8, Math.min(40, Math.floor(600 / dates.length) - 4));
    const H = 120;
    const W = dates.length * (BAR_W + 4) + 40;

    const bars = dates.map((date, i) => {
        const x = 20 + i * (BAR_W + 4);
        const revH = Math.round((daily[date].revenue / maxRevenue) * H);
        const netH = Math.round((daily[date].net     / maxRevenue) * H);
        const label = date.slice(5); // MM-DD

        return `
            <g>
                <rect x="${x}" y="${H - revH}" width="${BAR_W}" height="${revH}" fill="rgba(16,185,129,0.35)" rx="2"/>
                <rect x="${x}" y="${H - netH}"  width="${BAR_W}" height="${netH}"  fill="rgba(59,130,246,0.6)"  rx="2"/>
                ${dates.length <= 20 ? `<text x="${x + BAR_W/2}" y="${H + 14}" text-anchor="middle" font-size="9" fill="#64748b">${label}</text>` : ''}
            </g>
        `;
    }).join('');

    const chartDiv = document.createElement('div');
    chartDiv.id = 'kaspi-chart-container';
    chartDiv.style.cssText = 'margin-top:16px;padding:16px;background:var(--bg-secondary);border-radius:12px;';
    chartDiv.innerHTML = `
        <div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:12px;text-transform:uppercase;letter-spacing:.05em;">Динамика по дням</div>
        <div style="display:flex;gap:16px;margin-bottom:10px;font-size:12px;">
            <span><span style="display:inline-block;width:12px;height:12px;background:rgba(16,185,129,0.5);border-radius:2px;margin-right:4px;"></span>Выручка</span>
            <span><span style="display:inline-block;width:12px;height:12px;background:rgba(59,130,246,0.7);border-radius:2px;margin-right:4px;"></span>Нетто</span>
        </div>
        <div style="overflow-x:auto;">
            <svg width="${W}" height="${H + 20}" style="display:block;">
                ${bars}
            </svg>
        </div>
        <div style="text-align:right;font-size:11px;color:var(--text-secondary);margin-top:6px;">${dates.length} дней</div>
    `;

    summaryTab.querySelector('.card')?.appendChild(chartDiv);
}

// ─── ПЕРЕКЛЮЧЕНИЕ ТАБОВ ───────────────────────────────────────────────────────
// Реальные ID в HTML: kaspi-tab-summary, kaspi-tab-orders, kaspi-tab-products
// Реальные классы кнопок: kaspi-tab-btn

function switchKaspiTab(tabName) {
    const tabs = ['summary', 'orders', 'products'];

    tabs.forEach(tab => {
        // ID в HTML: kaspi-tab-{name}
        const content = document.getElementById(`kaspi-tab-${tab}`);
        const btn = document.querySelector(`.kaspi-tab-btn[data-kaspi-tab="${tab}"]`);

        const isActive = tab === tabName;

        if (content) {
            content.style.display = isActive ? 'block' : 'none';
        }
        if (btn) {
            if (isActive) {
                btn.style.background = 'var(--primary-color)';
                btn.style.color = 'white';
                btn.style.border = 'none';
            } else {
                btn.style.background = 'var(--bg-secondary)';
                btn.style.color = 'var(--text-secondary)';
                btn.style.border = '1px solid var(--border-color)';
            }
        }
    });
}

// ─── ХЕЛПЕРЫ ─────────────────────────────────────────────────────────────────

function setEl(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'KZT',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(parseFloat(amount) || 0);
}

function formatKaspiDate(dateString) {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleString('ru-RU', {
        year:   'numeric',
        month:  '2-digit',
        day:    '2-digit',
        hour:   '2-digit',
        minute: '2-digit'
    });
}

function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showKaspiLoader() {
    // loader встраиваем inline, не зависим от внешнего элемента
    const tabEl = document.getElementById('reportTab-kaspi');
    if (!tabEl) return;
    let loader = document.getElementById('kaspi-inline-loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'kaspi-inline-loader';
        loader.style.cssText = 'text-align:center;padding:30px;color:var(--text-secondary);font-size:14px;';
        loader.textContent = '⏳ Загрузка данных Kaspi...';
        tabEl.prepend(loader);
    }
    loader.style.display = 'block';
}

function hideKaspiLoader() {
    const loader = document.getElementById('kaspi-inline-loader');
    if (loader) loader.style.display = 'none';
}

function showKaspiError(message) {
    const tabEl = document.getElementById('reportTab-kaspi');
    if (!tabEl) { console.error(message); return; }
    let err = document.getElementById('kaspi-inline-error');
    if (!err) {
        err = document.createElement('div');
        err.id = 'kaspi-inline-error';
        err.style.cssText = 'padding:12px 16px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;color:#ef4444;font-size:13px;margin-bottom:12px;';
        tabEl.prepend(err);
    }
    err.textContent = '❌ ' + message;
    err.style.display = 'block';
}

function hideKaspiError() {
    const err = document.getElementById('kaspi-inline-error');
    if (err) err.style.display = 'none';
}

// ─── ЭКСПОРТ CSV ──────────────────────────────────────────────────────────────

function exportKaspiData() {
    const data = cachedKaspiData;
    if (!data || data.length === 0) {
        alert('Нет данных для экспорта');
        return;
    }

    const headers = ['ID заказа', 'Дата', 'Сумма', 'Комиссия', 'Доставка', 'Нетто', 'Клиент', 'Тип оплаты', 'Товары'];
    const rows = data.map(o => {
        const products = (o.sale_items || [])
            .map(i => `${i.products?.name || 'Неизвестно'} (${i.quantity}x)`)
            .join('; ');
        return [
            o.external_id || o.id,
            formatKaspiDate(o.operation_at || o.created_at),
            o.total_amount || 0,
            o.kaspi_commission_amount || 0,
            o.kaspi_delivery_cost || 0,
            o.kaspi_net_amount || 0,
            o.client || '',
            o.kaspi_payment_mode || 'Kaspi',
            products
        ].map(v => {
            const s = String(v);
            return (s.includes(',') || s.includes('"') || s.includes('\n'))
                ? `"${s.replace(/"/g, '""')}"` : s;
        });
    });

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kaspi-${getCurrentPeriod()}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ─── ГЛОБАЛЬНЫЙ ЭКСПОРТ ───────────────────────────────────────────────────────
window.initKaspiReports  = initKaspiReports;
window.switchKaspiTab    = switchKaspiTab;
window.exportKaspiData   = exportKaspiData;
window.loadKaspiData     = loadKaspiData;
