let DATA = null;           // last snapshot fetched from the server (source of truth lives in SQLite)
let cart = [];              // in-memory draft of the order being built (not persisted until "Registrar pedido")
let currentTab = 'dashboard';
let historialFilter = 'todos';
let cuentasFilter = 'pendientes';
let deleteTarget = null;
let abonoTarget = null;

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let body = null;
  try { body = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok || (body && body.ok === false)) {
    const msg = (body && body.error) ? body.error : `Error ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

function fmtCOP(n) {
  n = Number(n) || 0;
  return '$' + Math.round(n).toLocaleString('es-CO');
}
function fmtGr(n) {
  n = Number(n) || 0;
  return n.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' g';
}
function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function diasDesde(fechaStr) {
  const then = new Date(fechaStr + 'T00:00:00');
  const now = new Date();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}
const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, ch => ESCAPE_MAP[ch]);
}
function escapeAttr(str) { return escapeHtml(str); }

function debounce(fn, wait) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

function showToast(msg, isError) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.toggle('error', !!isError);
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 2600);
}

// Wraps an async action: runs it, always refreshes data from the server afterwards
// (success or failure), and surfaces any error as a clear toast instead of silently
// leaving the screen out of sync with the database.
async function runAction(fn) {
  try {
    await fn();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Ocurrió un error inesperado.', true);
  } finally {
    await reloadAndRender();
  }
}

async function reloadAndRender() {
  DATA = await api('/api/bootstrap');
  renderAll();
}

// ---------------------------------------------------------------------------
// Recipe / cost helpers (mirrors the server's logic, for on-screen previews only —
// the server is always the one that validates and commits stock changes)
// ---------------------------------------------------------------------------

function recipeFor(sizeMl) {
  const fp = Number(DATA.config.frag_percent) || 50;
  return { fragGr: sizeMl * (fp / 100), alcGr: sizeMl * ((100 - fp) / 100) };
}
function frascoKey(size) { return 'frasco_f' + size; }

function findFragancia(codigo) {
  return DATA.fragancias.find(f => String(f.codigo) === String(codigo));
}

function costoDeVenta(v) {
  const costoFrag = (v.frag_cost_per_gr || 0) * (v.frag_used_gr || 0);
  const costoAlc = (v.alcohol_cost_per_gr || 0) * (v.alcohol_used_gr || 0);
  const costoFrasco = v.es_recarga ? 0 : (v.frasco_cost || 0) * (v.cantidad || 0);
  return costoFrag + costoAlc + costoFrasco;
}
function utilidadDeVenta(v) { return v.total - costoDeVenta(v); }
function margenPct(total, utilidad) { return total ? (utilidad / total) * 100 : 0; }

// ---------------------------------------------------------------------------
// Fragancia search (by name or reference code)
// ---------------------------------------------------------------------------

function fraganciaLabel(f) { return `${f.nombre} (Ref. ${f.codigo})`; }

function populateFraganciaDatalist() {
  const dl = document.getElementById('fraganciaDatalist');
  dl.innerHTML = [...DATA.fragancias].sort((a, b) => a.nombre.localeCompare(b.nombre))
    .map(f => `<option value="${escapeAttr(fraganciaLabel(f))}">`).join('');
}
function resolveFragancia(text) {
  text = (text || '').trim();
  if (!text) return { match: null, reason: 'vacio' };
  const refMatch = text.match(/\(Ref\.\s*(\S+)\)\s*$/i);
  if (refMatch) {
    const f = DATA.fragancias.find(x => String(x.codigo) === String(refMatch[1]));
    if (f) return { match: f };
  }
  const exact = DATA.fragancias.filter(x => x.nombre.toLowerCase() === text.toLowerCase() || String(x.codigo) === text);
  if (exact.length === 1) return { match: exact[0] };
  const partial = DATA.fragancias.filter(x =>
    x.nombre.toLowerCase().includes(text.toLowerCase()) || String(x.codigo).includes(text));
  if (partial.length === 1) return { match: partial[0] };
  if (partial.length > 1) return { match: null, reason: 'ambiguo', count: partial.length };
  return { match: null, reason: 'no_encontrado' };
}

function populateClientesDatalist() {
  const dl = document.getElementById('clientesDatalist');
  dl.innerHTML = DATA.clientes.map(c => `<option value="${escapeAttr(c.nombre)}">`).join('');
}
function populateCuentaSelect(elId) {
  const sel = document.getElementById(elId);
  const cuentas = (DATA.config.cuentas && DATA.config.cuentas.length) ? DATA.config.cuentas
    : ['Efectivo', 'Nequi', 'Bancolombia', 'Nu Bank'];
  sel.innerHTML = cuentas.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.getAttribute('data-tab');
    document.getElementById('tab-' + currentTab).classList.add('active');
    renderTab(currentTab);
  });
});

function renderTab(tab) {
  try {
    if (tab === 'dashboard') renderDashboard();
    if (tab === 'inventario') renderInventoryTab();
    if (tab === 'venta') renderVentaTab();
    if (tab === 'compra') renderCompraTab();
    if (tab === 'gastos') renderGastos();
    if (tab === 'clientes') renderClientes();
    if (tab === 'cuentas') renderCuentas();
    if (tab === 'historial') renderHistorial();
  } catch (err) {
    console.error('Error renderizando ' + tab + ':', err);
  }
}
function renderAll() {
  ['dashboard', 'inventario', 'venta', 'compra', 'gastos', 'clientes', 'cuentas', 'historial'].forEach(renderTab);
  renderLanInfo();
}

function renderLanInfo() {
  const box = document.getElementById('lanInfoBox');
  if (DATA.serverInfo && DATA.serverInfo.lanUrl) {
    box.style.display = '';
    box.innerHTML = `📱 Accede desde tu celular (misma WiFi): <b>${escapeHtml(DATA.serverInfo.lanUrl)}</b>`;
  }
}

// ---------------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------------

function renderDashboard() {
  const ym = new Date().toISOString().slice(0, 7);
  const ventasMes = DATA.ventas.filter(v => v.fecha.slice(0, 7) === ym);
  const unidadesMes = ventasMes.reduce((s, v) => s + v.cantidad, 0);
  const ingresosMes = ventasMes.reduce((s, v) => s + v.total, 0);
  const fragUsadaMes = ventasMes.reduce((s, v) => s + v.frag_used_gr, 0);
  const costoMes = ventasMes.reduce((s, v) => s + costoDeVenta(v), 0);
  const gastosMes = DATA.gastos.filter(g => g.fecha.slice(0, 7) === ym).reduce((s, g) => s + g.monto, 0);
  const utilidadMes = ingresosMes - costoMes;
  const utilidadNetaMes = utilidadMes - gastosMes;
  const margenMes = margenPct(ingresosMes, utilidadMes);

  const utilidadTotal = DATA.ventas.reduce((s, v) => s + utilidadDeVenta(v), 0);
  const gastosTotal = DATA.gastos.reduce((s, g) => s + g.monto, 0);
  const porCobrar = DATA.facturas.reduce((s, f) => s + f.saldo, 0);
  const atrasadas = DATA.facturas.filter(f => f.saldo > 0 && diasDesde(f.fecha) > 15).length;

  const r30 = recipeFor(30);
  const lowStockCount = DATA.fragancias.filter(f => f.stock_gr < r30.fragGr).length;

  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpi"><div class="label">Ventas este mes</div><div class="value">${unidadesMes}</div></div>
    <div class="kpi ok"><div class="label">Ingresos este mes</div><div class="value">${fmtCOP(ingresosMes)}</div></div>
    <div class="kpi ${utilidadNetaMes >= 0 ? 'ok' : 'danger'}"><div class="label">Utilidad neta del mes</div><div class="value">${fmtCOP(utilidadNetaMes)}</div></div>
    <div class="kpi ${margenMes >= 30 ? 'ok' : (margenMes >= 0 ? 'warn' : 'danger')}"><div class="label">Margen este mes</div><div class="value">${margenMes.toFixed(1)}%</div></div>
    <div class="kpi"><div class="label">Gastos este mes</div><div class="value">${fmtCOP(gastosMes)}</div></div>
    <div class="kpi ${lowStockCount > 0 ? 'danger' : 'ok'}"><div class="label">Referencias en alerta</div><div class="value">${lowStockCount}</div></div>
    <div class="kpi ${porCobrar > 0 ? 'warn' : 'ok'}"><div class="label">Por cobrar (facturas)</div><div class="value">${fmtCOP(porCobrar)}</div></div>
    <div class="kpi ${atrasadas > 0 ? 'danger' : 'ok'}"><div class="label">Fiados atrasados (+15 días)</div><div class="value">${atrasadas}</div></div>
    <div class="kpi ok"><div class="label">Utilidad neta histórica</div><div class="value">${fmtCOP(utilidadTotal - gastosTotal)}</div></div>
  `;

  const low = DATA.fragancias.filter(f => f.stock_gr < r30.fragGr).sort((a, b) => a.stock_gr - b.stock_gr);
  const lowWrap = document.getElementById('lowStockList');
  lowWrap.innerHTML = low.length === 0
    ? '<div class="empty-note">Todo en orden. Ninguna referencia está por debajo del mínimo para un frasco de 30ML.</div>'
    : '<table><thead><tr><th>Código</th><th>Nombre</th><th>Stock</th></tr></thead><tbody>' +
      low.slice(0, 15).map(f => `<tr><td>${f.codigo}</td><td>${escapeHtml(f.nombre)}</td><td><span class="tag low">${fmtGr(f.stock_gr)}</span></td></tr>`).join('') +
      '</tbody></table>' + (low.length > 15 ? `<div class="hint">y ${low.length - 15} más...</div>` : '');
  if (DATA.config.alcohol_stock_gr < 30) {
    lowWrap.innerHTML += `<div class="hint" style="color:var(--danger); margin-top:10px;">⚠️ Alcohol también está bajo: ${fmtGr(DATA.config.alcohol_stock_gr)}</div>`;
  }

  const salesByCode = {};
  DATA.ventas.forEach(v => {
    if (!salesByCode[v.codigo]) salesByCode[v.codigo] = { nombre: v.nombre, qty: 0, total: 0 };
    salesByCode[v.codigo].qty += v.cantidad;
    salesByCode[v.codigo].total += v.total;
  });
  const top = Object.values(salesByCode).sort((a, b) => b.qty - a.qty).slice(0, 8);
  document.getElementById('topSellers').innerHTML = top.length === 0
    ? '<div class="empty-note">Aún no has registrado ventas.</div>'
    : '<table><thead><tr><th>Nombre</th><th>Unidades</th><th>Ingresos</th></tr></thead><tbody>' +
      top.map(t => `<tr><td>${escapeHtml(t.nombre)}</td><td>${t.qty}</td><td>${fmtCOP(t.total)}</td></tr>`).join('') +
      '</tbody></table>';

  const recent = [...DATA.ventas].slice(0, 8);
  document.getElementById('recentSales').innerHTML = recent.length === 0
    ? '<div class="empty-note">Aún no has registrado ventas.</div>'
    : '<table><thead><tr><th>Fecha</th><th>Nombre</th><th>Tam.</th><th>Total</th></tr></thead><tbody>' +
      recent.map(v => `<tr><td>${v.fecha}</td><td>${escapeHtml(v.nombre)}</td><td>${v.tamano}ML</td><td>${fmtCOP(v.total)}</td></tr>`).join('') +
      '</tbody></table>';

  renderProyeccion();
  renderChartVentasMes();
  renderChartTopSellers(top);
}

function svgBarChart(items, opts = {}) {
  // items: [{label, value}], draws a simple horizontal/vertical bar chart as inline SVG.
  // No external library needed — works fully offline.
  if (items.length === 0) return '<div class="empty-note">Aún no hay datos suficientes para graficar.</div>';
  const w = 560, barGap = 10, leftPad = 4, barH = 26;
  const maxVal = Math.max(...items.map(i => i.value), 1);
  const h = items.length * (barH + barGap) + barGap;
  const bars = items.map((it, idx) => {
    const y = barGap + idx * (barH + barGap);
    const barW = Math.max(2, (it.value / maxVal) * (w - 150));
    return `
      <text x="0" y="${y + barH / 2 + 4}" fill="var(--muted)" font-size="11" font-family="Inter">${escapeHtml(it.label)}</text>
      <rect x="130" y="${y}" width="${barW}" height="${barH}" rx="5" fill="var(--gold)" opacity="0.85"/>
      <text x="${130 + barW + 8}" y="${y + barH / 2 + 4}" fill="var(--ivory)" font-size="11.5" font-family="Inter" font-weight="600">${escapeHtml(it.valueLabel || it.value)}</text>
    `;
  }).join('');
  return `<svg viewBox="0 ${-barGap} ${w} ${h}" width="100%" height="${h}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

function renderChartVentasMes() {
  const porMes = {};
  DATA.ventas.forEach(v => {
    const ym = v.fecha.slice(0, 7);
    porMes[ym] = (porMes[ym] || 0) + v.total;
  });
  const meses = Object.keys(porMes).sort().slice(-6);
  const items = meses.map(m => ({ label: m, value: porMes[m], valueLabel: fmtCOP(porMes[m]) }));
  document.getElementById('chartVentasMes').innerHTML = svgBarChart(items);
}

function renderChartTopSellers(top) {
  const items = top.slice(0, 6).map(t => ({ label: t.nombre.length > 22 ? t.nombre.slice(0, 22) + '…' : t.nombre, value: t.qty, valueLabel: t.qty + ' und' }));
  document.getElementById('chartTopSellers').innerHTML = svgBarChart(items);
}

function renderProyeccion() {
  const wrap = document.getElementById('proyeccionWrap');
  if (DATA.ventas.length === 0) {
    wrap.innerHTML = '<div class="empty-note">Registra algunas ventas para ver la proyección de ganancias.</div>';
    return;
  }
  const porMes = {};
  DATA.ventas.forEach(v => {
    const ym = v.fecha.slice(0, 7);
    if (!porMes[ym]) porMes[ym] = { unidades: 0, ingresos: 0, utilidad: 0 };
    porMes[ym].unidades += v.cantidad;
    porMes[ym].ingresos += v.total;
    porMes[ym].utilidad += utilidadDeVenta(v);
  });
  const meses = Object.keys(porMes).sort();
  const gastosPorMes = {};
  DATA.gastos.forEach(g => {
    const ym = g.fecha.slice(0, 7);
    gastosPorMes[ym] = (gastosPorMes[ym] || 0) + g.monto;
  });
  const totalUnidades = meses.reduce((s, m) => s + porMes[m].unidades, 0);
  const totalUtilidad = meses.reduce((s, m) => s + porMes[m].utilidad, 0);
  const totalGastos = meses.reduce((s, m) => s + (gastosPorMes[m] || 0), 0);
  const totalIngresos = meses.reduce((s, m) => s + porMes[m].ingresos, 0);
  const promUtilidadUnidad = totalUnidades > 0 ? totalUtilidad / totalUnidades : 0;
  const promUnidadesMes = totalUnidades / meses.length;
  const promUtilidadNetaMes = (totalUtilidad - totalGastos) / meses.length;
  const margenProm = margenPct(totalIngresos, totalUtilidad);

  wrap.innerHTML = `
    <table><thead><tr><th>Mes</th><th>Unidades</th><th>Ingresos</th><th>Utilidad bruta</th><th>Gastos</th><th>Utilidad neta</th></tr></thead><tbody>
    ${meses.map(m => `<tr><td>${m}</td><td>${porMes[m].unidades}</td><td>${fmtCOP(porMes[m].ingresos)}</td><td>${fmtCOP(porMes[m].utilidad)}</td><td>${fmtCOP(gastosPorMes[m] || 0)}</td><td>${fmtCOP(porMes[m].utilidad - (gastosPorMes[m] || 0))}</td></tr>`).join('')}
    </tbody></table>
    <div class="hint" style="margin-top:12px; line-height:1.7;">
      Promedio histórico: <b>${fmtCOP(promUtilidadUnidad)}</b> de utilidad bruta por unidad vendida &nbsp;·&nbsp; margen promedio <b>${margenProm.toFixed(1)}%</b><br>
      Si mantienes el ritmo de <b>${promUnidadesMes.toFixed(1)} unidades/mes</b> y tus gastos generales se mantienen similares, tu utilidad neta proyectada sería de aprox. <b>${fmtCOP(promUtilidadNetaMes)}/mes</b> y <b>${fmtCOP(promUtilidadNetaMes * 12)}/año</b>.
    </div>`;
}

// ---------------------------------------------------------------------------
// INVENTARIO TAB
// ---------------------------------------------------------------------------

function renderInventoryTab() {
  const c = DATA.config;
  document.getElementById('businessNameInput').value = c.business_name;
  document.getElementById('businessWhatsappInput').value = c.business_whatsapp;
  document.getElementById('fragPercentInput').value = c.frag_percent;
  document.getElementById('alcoholStockInput').value = c.alcohol_stock_gr;
  document.getElementById('alcoholCostInput').value = c.alcohol_cost_per_gr;
  document.getElementById('frasco10Input').value = c.frasco_f10_stock;
  document.getElementById('frasco30Input').value = c.frasco_f30_stock;
  document.getElementById('frasco50Input').value = c.frasco_f50_stock;
  document.getElementById('frascoCost10Input').value = c.frasco_f10_cost;
  document.getElementById('frascoCost30Input').value = c.frasco_f30_cost;
  document.getElementById('frascoCost50Input').value = c.frasco_f50_cost;
  document.getElementById('recargaP10Input').value = c.recharge_p10;
  document.getElementById('recargaP30Input').value = c.recharge_p30;
  document.getElementById('recargaP50Input').value = c.recharge_p50;
  updateRecipePreview();
  renderInventoryTable();
  renderOtrosProductos();
}

function updateRecipePreview() {
  const fp = Number(document.getElementById('fragPercentInput').value) || 50;
  document.getElementById('recipePreview').innerHTML =
    `Con ${fp}%: 10ML → ${10 * fp / 100}g fragancia + ${10 * (100 - fp) / 100}g alcohol &nbsp;|&nbsp; ` +
    `30ML → ${30 * fp / 100}g fragancia + ${30 * (100 - fp) / 100}g alcohol &nbsp;|&nbsp; ` +
    `50ML → ${50 * fp / 100}g fragancia + ${50 * (100 - fp) / 100}g alcohol`;
}
document.getElementById('fragPercentInput').addEventListener('input', updateRecipePreview);
document.getElementById('fragPercentInput').addEventListener('change', () => runAction(async () => {
  const val = Number(document.getElementById('fragPercentInput').value);
  if (val > 0 && val < 100) {
    await api('/api/config', { method: 'POST', body: JSON.stringify({ fragPercent: val }) });
    showToast('Receta actualizada');
  }
}));

document.getElementById('saveBusinessBtn').addEventListener('click', () => runAction(async () => {
  await api('/api/config', {
    method: 'POST',
    body: JSON.stringify({
      businessName: document.getElementById('businessNameInput').value.trim() || 'Essence Collection',
      businessWhatsapp: document.getElementById('businessWhatsappInput').value.replace(/\D/g, ''),
    }),
  });
  showToast('Datos del negocio guardados');
}));

document.getElementById('saveAlcoholBtn').addEventListener('click', () => runAction(async () => {
  await api('/api/config', {
    method: 'POST',
    body: JSON.stringify({
      alcoholStockGr: Number(document.getElementById('alcoholStockInput').value) || 0,
      alcoholCostPerGr: Number(document.getElementById('alcoholCostInput').value) || 0,
    }),
  });
  showToast('Alcohol actualizado');
}));

document.getElementById('saveFrascosBtn').addEventListener('click', () => runAction(async () => {
  await api('/api/config', {
    method: 'POST',
    body: JSON.stringify({
      frasco10Stock: Number(document.getElementById('frasco10Input').value) || 0,
      frasco30Stock: Number(document.getElementById('frasco30Input').value) || 0,
      frasco50Stock: Number(document.getElementById('frasco50Input').value) || 0,
      frasco10Cost: Number(document.getElementById('frascoCost10Input').value) || 0,
      frasco30Cost: Number(document.getElementById('frascoCost30Input').value) || 0,
      frasco50Cost: Number(document.getElementById('frascoCost50Input').value) || 0,
    }),
  });
  showToast('Frascos actualizados');
}));

document.getElementById('saveRecargaBtn').addEventListener('click', () => runAction(async () => {
  await api('/api/config', {
    method: 'POST',
    body: JSON.stringify({
      rechargeP10: Number(document.getElementById('recargaP10Input').value) || 0,
      rechargeP30: Number(document.getElementById('recargaP30Input').value) || 0,
      rechargeP50: Number(document.getElementById('recargaP50Input').value) || 0,
    }),
  });
  showToast('Precios de recarga actualizados');
}));

function estadoTag(f) {
  const r30 = recipeFor(30);
  const units = f.stock_gr / r30.fragGr;
  if (units < 1) return '<span class="tag low">Bajo</span>';
  if (units < 3) return '<span class="tag mid">Medio</span>';
  return '<span class="tag ok">Bien</span>';
}
function alcanzaPara(f) {
  const r30 = recipeFor(30);
  return `~${Math.floor(f.stock_gr / r30.fragGr)} x 30ML`;
}

function renderInventoryTable() {
  const q = (document.getElementById('inventorySearch').value || '').trim().toLowerCase();
  document.getElementById('fragCount').textContent = DATA.fragancias.length;
  const rows = DATA.fragancias.filter(f => !q || f.nombre.toLowerCase().includes(q) || String(f.codigo).includes(q));
  document.getElementById('inventoryTbody').innerHTML = rows.map(f => `
    <tr data-codigo="${f.codigo}">
      <td>${f.codigo}</td>
      <td>${escapeHtml(f.nombre)}</td>
      <td>${f.genero}</td>
      <td><input type="text" class="cell-input ubicacion-input" value="${escapeAttr(f.ubicacion || '')}" data-codigo="${f.codigo}" placeholder="Ej: 4" style="width:60px;"></td>
      <td><input type="number" class="cell-input stock-input" value="${f.stock_gr}" data-codigo="${f.codigo}"></td>
      <td>${alcanzaPara(f)}</td>
      <td><input type="number" class="cell-input cost-input" value="${f.cost_per_gr}" data-codigo="${f.codigo}" style="width:70px;"></td>
      <td>${estadoTag(f)}</td>
    </tr>`).join('');
}
document.getElementById('inventorySearch').addEventListener('input', debounce(renderInventoryTable, 150));

document.getElementById('inventoryTbody').addEventListener('change', (e) => runAction(async () => {
  const inp = e.target;
  const codigo = inp.getAttribute('data-codigo');
  if (!codigo) return;
  if (inp.classList.contains('stock-input')) {
    await api(`/api/fragancia/${encodeURIComponent(codigo)}`, { method: 'POST', body: JSON.stringify({ stockGr: Number(inp.value) || 0 }) });
    showToast('Stock actualizado');
  } else if (inp.classList.contains('cost-input')) {
    await api(`/api/fragancia/${encodeURIComponent(codigo)}`, { method: 'POST', body: JSON.stringify({ costPerGr: Number(inp.value) || 0 }) });
    showToast('Costo actualizado');
  } else if (inp.classList.contains('ubicacion-input')) {
    await api(`/api/fragancia/${encodeURIComponent(codigo)}`, { method: 'POST', body: JSON.stringify({ ubicacion: inp.value.trim() }) });
    showToast('Ubicación guardada');
  }
}));

// ---------------------------------------------------------------------------
// LOCALIZADOR RÁPIDO
// ---------------------------------------------------------------------------

function renderLocalizador() {
  const raw = document.getElementById('locBuscarInput').value;
  const wrap = document.getElementById('locResultados');
  const terms = raw.split(',').map(t => t.trim()).filter(Boolean);
  if (terms.length === 0) { wrap.innerHTML = ''; return; }
  const filas = terms.map(term => {
    const res = resolveFragancia(term);
    if (res.match) {
      const f = res.match;
      return `<tr><td style="font-weight:700;">${escapeHtml(f.nombre)} <span class="hint" style="margin:0;">Ref. ${f.codigo}</span></td>
        <td><span class="tag ok" style="font-size:15px; padding:5px 14px;">📍 ${escapeHtml(f.ubicacion) || 'Sin ubicación asignada'}</span></td>
        <td>${fmtGr(f.stock_gr)}</td></tr>`;
    } else if (res.reason === 'ambiguo') {
      return `<tr><td colspan="3" style="color:var(--warn);">"${escapeHtml(term)}": ${res.count} coincidencias, sé más específico.</td></tr>`;
    }
    return `<tr><td colspan="3" style="color:var(--danger);">"${escapeHtml(term)}": no se encontró ninguna fragancia.</td></tr>`;
  }).join('');
  wrap.innerHTML = `<table><thead><tr><th>Fragancia</th><th>Ubicación</th><th>Stock</th></tr></thead><tbody>${filas}</tbody></table>`;
}
document.getElementById('locBuscarInput').addEventListener('input', debounce(renderLocalizador, 150));

// ---------------------------------------------------------------------------
// OTROS PRODUCTOS
// ---------------------------------------------------------------------------

function renderOtrosProductos() {
  const tbody = document.getElementById('otrosTbody');
  if (DATA.otrosProductos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-note">Aún no has agregado otros productos (bolsas, etiquetas, empaques, etc.)</div></td></tr>';
    return;
  }
  tbody.innerHTML = DATA.otrosProductos.map(item => `
    <tr data-id="${item.id}">
      <td>${escapeHtml(item.nombre)}</td>
      <td>${escapeHtml(item.unidad)}</td>
      <td><input type="number" class="cell-input otro-stock-input" value="${item.stock}" data-id="${item.id}" style="width:70px;"></td>
      <td><input type="number" class="cell-input otro-costo-input" value="${item.costo_unit}" data-id="${item.id}" style="width:80px;"></td>
      <td>${fmtCOP(item.stock * item.costo_unit)}</td>
      <td><button class="btn small danger" data-del-id="${item.id}">Eliminar</button></td>
    </tr>`).join('');
}

document.getElementById('addOtroBtn').addEventListener('click', () => runAction(async () => {
  const nombre = document.getElementById('otroNombreInput').value.trim();
  const unidad = document.getElementById('otroUnidadInput').value.trim() || 'unidad';
  const stock = Number(document.getElementById('otroStockInput').value) || 0;
  const costoUnit = Number(document.getElementById('otroCostoInput').value) || 0;
  if (!nombre) { showToast('Ingresa el nombre del producto', true); return; }
  await api('/api/otros', { method: 'POST', body: JSON.stringify({ nombre, unidad, stock, costoUnit }) });
  document.getElementById('otroNombreInput').value = '';
  document.getElementById('otroStockInput').value = '';
  document.getElementById('otroCostoInput').value = '';
  showToast('Producto agregado al inventario');
}));

document.getElementById('otrosTbody').addEventListener('change', (e) => runAction(async () => {
  const inp = e.target;
  const id = inp.getAttribute('data-id');
  if (!id) return;
  if (inp.classList.contains('otro-stock-input')) {
    await api(`/api/otros/${id}`, { method: 'POST', body: JSON.stringify({ stock: Number(inp.value) || 0 }) });
  } else if (inp.classList.contains('otro-costo-input')) {
    await api(`/api/otros/${id}`, { method: 'POST', body: JSON.stringify({ costoUnit: Number(inp.value) || 0 }) });
  }
  showToast('Actualizado');
}));

document.getElementById('otrosTbody').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-del-id]');
  if (!btn) return;
  if (!confirm('¿Eliminar este producto del inventario?')) return;
  runAction(async () => {
    await api(`/api/otros/${btn.getAttribute('data-del-id')}`, { method: 'DELETE' });
    showToast('Producto eliminado');
  });
});

// ---------------------------------------------------------------------------
// VENTA TAB
// ---------------------------------------------------------------------------

function renderVentaTab() {
  populateFraganciaDatalist();
  populateClientesDatalist();
  populateCuentaSelect('ventaCuenta');
  if (!document.getElementById('ventaFecha').value) document.getElementById('ventaFecha').value = todayStr();
  renderVentaCart();
}

function currentVentaMatch() {
  const text = document.getElementById('ventaFraganciaSearch').value;
  const res = resolveFragancia(text);
  const hintEl = document.getElementById('ventaFraganciaMatch');
  if (!text.trim()) {
    hintEl.textContent = '';
  } else if (res.match) {
    hintEl.innerHTML = `✅ ${escapeHtml(res.match.nombre)} (Ref. ${res.match.codigo}) &nbsp;·&nbsp; 📍 Ubicación: <b>${escapeHtml(res.match.ubicacion) || 'no asignada'}</b>`;
    hintEl.style.color = 'var(--ok)';
    autoFillVentaPrecio(res.match);
  } else if (res.reason === 'ambiguo') {
    hintEl.textContent = `Hay ${res.count} coincidencias, sé más específico (usa el nombre completo o la referencia).`;
    hintEl.style.color = 'var(--warn)';
  } else if (res.reason === 'no_encontrado') {
    hintEl.textContent = 'No se encontró ninguna fragancia con ese nombre o referencia.';
    hintEl.style.color = 'var(--danger)';
  }
  return res.match;
}
function autoFillVentaPrecio(fragancia) {
  const size = document.getElementById('ventaTamano').value;
  const esRecarga = document.getElementById('ventaRecargaCheckbox').checked;
  if (esRecarga) {
    document.getElementById('ventaPrecio').value = DATA.config['recharge_p' + size] || 0;
  } else if (fragancia) {
    document.getElementById('ventaPrecio').value = fragancia['p' + size] || 0;
  }
  updateVentaDescuentoPreview();
}
function precioConDescuento(precio, descuentoPct) {
  const d = Math.min(100, Math.max(0, Number(descuentoPct) || 0));
  return Math.round(precio * (1 - d / 100));
}
function updateVentaDescuentoPreview() {
  const precio = Number(document.getElementById('ventaPrecio').value) || 0;
  const descuento = Number(document.getElementById('ventaDescuento').value) || 0;
  const previewEl = document.getElementById('ventaPrecioConDescuento');
  if (descuento > 0 && precio > 0) {
    const finalPrecio = precioConDescuento(precio, descuento);
    previewEl.innerHTML = `Precio con descuento especial (${descuento}%): <b style="color:var(--gold-soft);">${fmtCOP(finalPrecio)}</b> por unidad.`;
  } else {
    previewEl.textContent = '';
  }
}
document.getElementById('ventaFraganciaSearch').addEventListener('input', currentVentaMatch);
document.getElementById('ventaTamano').addEventListener('change', currentVentaMatch);
document.getElementById('ventaRecargaCheckbox').addEventListener('change', currentVentaMatch);
document.getElementById('ventaPrecio').addEventListener('input', updateVentaDescuentoPreview);
document.getElementById('ventaDescuento').addEventListener('input', updateVentaDescuentoPreview);

document.getElementById('addItemToCartBtn').addEventListener('click', () => {
  const errEl = document.getElementById('addItemError');
  errEl.textContent = '';
  try {
    const f = currentVentaMatch();
    const size = Number(document.getElementById('ventaTamano').value);
    const qty = Number(document.getElementById('ventaCantidad').value) || 0;
    const precioOriginal = Number(document.getElementById('ventaPrecio').value) || 0;
    const descuentoPct = Math.min(100, Math.max(0, Number(document.getElementById('ventaDescuento').value) || 0));
    const precio = precioConDescuento(precioOriginal, descuentoPct);
    const esRecarga = document.getElementById('ventaRecargaCheckbox').checked;

    if (!f) { errEl.textContent = 'Busca y selecciona una fragancia válida (por nombre o referencia).'; return; }
    if (qty <= 0) { errEl.textContent = 'La cantidad debe ser mayor a 0.'; return; }

    cart.push({
      codigo: f.codigo, nombre: f.nombre, tamano: size, cantidad: qty,
      precioUnit: precio, precioOriginal, descuentoPct, subtotal: precio * qty, esRecarga,
    });

    document.getElementById('ventaFraganciaSearch').value = '';
    document.getElementById('ventaFraganciaMatch').textContent = '';
    document.getElementById('ventaCantidad').value = 1;
    document.getElementById('ventaPrecio').value = '';
    document.getElementById('ventaDescuento').value = 0;
    document.getElementById('ventaPrecioConDescuento').textContent = '';
    document.getElementById('ventaRecargaCheckbox').checked = false;
  } finally {
    renderVentaCart();
  }
});

function renderVentaCart() {
  document.getElementById('cartItemCount').textContent = cart.length;
  const tbody = document.getElementById('ventaCartTbody');
  tbody.innerHTML = cart.length === 0
    ? '<tr><td colspan="6"><div class="empty-note">Aún no has agregado productos a este pedido.</div></td></tr>'
    : cart.map((item, idx) => `
      <tr>
        <td>${escapeHtml(item.nombre)} <span class="hint" style="margin:0;">Ref. ${item.codigo}</span>${item.esRecarga ? ' <span class="tag" style="background:rgba(79,123,127,0.2); color:var(--teal); border:1px solid rgba(79,123,127,0.4);">🔄 Recarga</span>' : ''}${item.descuentoPct ? ` <span class="tag" style="background:rgba(201,162,39,0.2); color:var(--gold-soft); border:1px solid rgba(201,162,39,0.4);">-${item.descuentoPct}%</span>` : ''}</td>
        <td>${item.tamano}ML</td><td>${item.cantidad}</td>
        <td>${item.descuentoPct ? `<span style="text-decoration:line-through; color:var(--muted); font-size:11px; display:block;">${fmtCOP(item.precioOriginal)}</span>${fmtCOP(item.precioUnit)}` : fmtCOP(item.precioUnit)}</td>
        <td>${fmtCOP(item.subtotal)}</td>
        <td><button class="btn small danger" data-idx="${idx}">Quitar</button></td>
      </tr>`).join('');

  const grandTotal = cart.reduce((s, i) => s + i.subtotal, 0);
  document.getElementById('cartGrandTotal').textContent = fmtCOP(grandTotal);
  updateVentaPreview();
}
document.getElementById('ventaCartTbody').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-idx]');
  if (!btn) return;
  cart.splice(Number(btn.getAttribute('data-idx')), 1);
  renderVentaCart();
});

function updateVentaPreview() {
  const previewEl = document.getElementById('ventaPreview');
  if (cart.length === 0) { previewEl.innerHTML = 'Agrega productos al pedido para ver el resumen de consumo de inventario.'; return; }
  const fragNeeded = {}; let alcNeeded = 0;
  const frascoNeeded = { frasco_f10: 0, frasco_f30: 0, frasco_f50: 0 };
  cart.forEach(item => {
    const r = recipeFor(item.tamano);
    fragNeeded[item.codigo] = (fragNeeded[item.codigo] || 0) + r.fragGr * item.cantidad;
    alcNeeded += r.alcGr * item.cantidad;
    if (!item.esRecarga) frascoNeeded[frascoKey(item.tamano)] += item.cantidad;
  });
  let warnings = [];
  Object.keys(fragNeeded).forEach(codigo => {
    const f = findFragancia(codigo);
    if (f && f.stock_gr < fragNeeded[codigo]) warnings.push(`⚠️ ${f.nombre}: necesitas ${fmtGr(fragNeeded[codigo])}, disponible ${fmtGr(f.stock_gr)}.`);
  });
  if (DATA.config.alcohol_stock_gr < alcNeeded) warnings.push(`⚠️ Alcohol: necesitas ${fmtGr(alcNeeded)}, disponible ${fmtGr(DATA.config.alcohol_stock_gr)}.`);
  Object.keys(frascoNeeded).forEach(fk => {
    if (frascoNeeded[fk] > 0 && DATA.config[fk + '_stock'] < frascoNeeded[fk]) {
      warnings.push(`⚠️ Frascos ${fk.replace('frasco_f', '')}ML: necesitas ${frascoNeeded[fk]}, disponibles ${DATA.config[fk + '_stock']}.`);
    }
  });
  let msg = `Este pedido consumirá <b>${fmtGr(alcNeeded)}</b> de alcohol en total y frascos según tamaño.`;
  msg += warnings.length
    ? '<br>' + warnings.map(w => `<span style="color:var(--danger)">${w}</span>`).join('<br>')
    : '<br><span style="color:var(--ok)">✅ Hay suficiente stock para todo el pedido.</span>';
  previewEl.innerHTML = msg;
}

function buildTicketMessage(folio, items, fecha, cliente, clienteTel) {
  const lines = [];
  lines.push(`🧾 *${DATA.config.business_name}*`);
  lines.push(`Ticket #${String(folio).padStart(4, '0')}`);
  lines.push(`Fecha: ${fecha}`);
  lines.push('');
  items.forEach(it => {
    lines.push(`${it.nombre} (Ref. ${it.codigo})`);
    lines.push(`${it.tamano} ML  x${it.cantidad}  —  ${fmtCOP(it.total)}${it.esRecarga ? '  (🔄 Recarga)' : ''}${it.descuentoPct ? `  (Descuento especial ${it.descuentoPct}%)` : ''}`);
    lines.push('');
  });
  const grandTotal = items.reduce((s, it) => s + it.total, 0);
  lines.push(`*Total: ${fmtCOP(grandTotal)}*`);
  if (cliente) { lines.push(''); lines.push(`Cliente: ${cliente}`); }
  lines.push('');
  lines.push('¡Gracias por tu compra! 🌸');
  if (DATA.config.business_whatsapp) lines.push(`Cualquier duda, escríbenos: +${DATA.config.business_whatsapp}`);
  return lines.join('\n');
}
function sendTicketWhatsApp(msg, clienteTel) {
  const number = (clienteTel || '').replace(/\D/g, '');
  const url = number ? `https://wa.me/${number}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

// Rebuilds and reopens the WhatsApp ticket for a past sale — used both from
// Historial and from a client's purchase history, so it can be resent
// anytime a client asks for it again.
function resendTicketForVenta(ventaId) {
  const venta = DATA.ventas.find(v => v.id === ventaId);
  if (!venta) { showToast('No se encontró esa venta.', true); return; }
  const mismoFolio = DATA.ventas.filter(v => v.folio === venta.folio);
  const ticketItems = mismoFolio.map(v => ({
    codigo: v.codigo, nombre: v.nombre, tamano: v.tamano, cantidad: v.cantidad,
    total: v.total, esRecarga: !!v.es_recarga, descuentoPct: v.descuento_pct || 0,
  }));
  const msg = buildTicketMessage(venta.folio, ticketItems, venta.fecha, venta.cliente, venta.cliente_tel);
  sendTicketWhatsApp(msg, venta.cliente_tel);
}

document.getElementById('registrarVentaBtn').addEventListener('click', () => runAction(async () => {
  const errEl = document.getElementById('ventaError');
  errEl.textContent = '';
  if (cart.length === 0) { errEl.textContent = 'Agrega al menos un producto al pedido.'; throw new Error('__silent__no_items'); }

  const fecha = document.getElementById('ventaFecha').value || todayStr();
  const cliente = document.getElementById('ventaCliente').value.trim();
  const clienteTel = document.getElementById('ventaClienteTel').value.trim();
  const cuenta = document.getElementById('ventaCuenta').value;
  const fiado = document.getElementById('ventaFiadoCheckbox').checked;

  const payload = {
    fecha, cliente, clienteTel, cuenta, fiado,
    items: cart.map(i => ({
      codigo: i.codigo, tamano: i.tamano, cantidad: i.cantidad, precioUnit: i.precioUnit,
      esRecarga: i.esRecarga, precioOriginal: i.precioOriginal, descuentoPct: i.descuentoPct,
    })),
  };
  const result = await api('/api/venta', { method: 'POST', body: JSON.stringify(payload) });

  const ticketItems = cart.map(i => ({ ...i, total: i.subtotal }));
  const msg = buildTicketMessage(result.folio, ticketItems, fecha, cliente, clienteTel);
  document.getElementById('ticketFolio').textContent = String(result.folio).padStart(4, '0');
  document.getElementById('ticketPreviewText').textContent = msg;
  document.getElementById('ticketPanel').style.display = 'block';
  document.getElementById('sendTicketBtn').onclick = () => sendTicketWhatsApp(msg, clienteTel);
  document.getElementById('copyTicketBtn').onclick = () => navigator.clipboard.writeText(msg).then(() => showToast('Ticket copiado'));
  try { document.getElementById('ticketPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* cosmetic only */ }

  cart = [];
  document.getElementById('ventaCliente').value = '';
  document.getElementById('ventaClienteTel').value = '';
  document.getElementById('ventaFiadoCheckbox').checked = false;
  showToast(fiado ? 'Pedido registrado como fiado (pendiente de pago)' : 'Pedido registrado y stock actualizado');
}).catch(() => {}));

// ---------------------------------------------------------------------------
// COMPRA TAB
// ---------------------------------------------------------------------------

function renderCompraTab() {
  populateFraganciaDatalist();
  populateOtroSelect();
  document.getElementById('compraFecha').value = todayStr();
  toggleCompraFields();
}
function populateOtroSelect() {
  const sel = document.getElementById('compraOtroSelect');
  sel.innerHTML = DATA.otrosProductos.length === 0
    ? '<option value="">No hay otros productos. Agrégalos primero en Inventario.</option>'
    : DATA.otrosProductos.map(o => `<option value="${o.id}">${escapeAttr(o.nombre)} (${escapeAttr(o.unidad)})</option>`).join('');
}
function toggleCompraFields() {
  const tipo = document.getElementById('compraTipo').value;
  document.getElementById('compraFraganciaWrap').style.display = tipo === 'fragancia' ? '' : 'none';
  document.getElementById('compraFraganciaMatch').style.display = tipo === 'fragancia' ? '' : 'none';
  document.getElementById('compraOtroWrap').style.display = tipo === 'otro' ? '' : 'none';
  document.getElementById('compraCantidadLabel').textContent = (tipo.startsWith('frasco') || tipo === 'otro') ? 'Cantidad (unidades)' : 'Cantidad (gramos)';
}
document.getElementById('compraTipo').addEventListener('change', toggleCompraFields);
document.getElementById('compraFraganciaSearch').addEventListener('input', () => {
  const text = document.getElementById('compraFraganciaSearch').value;
  const res = resolveFragancia(text);
  const hintEl = document.getElementById('compraFraganciaMatch');
  if (!text.trim()) hintEl.textContent = '';
  else if (res.match) {
    hintEl.innerHTML = `✅ ${escapeHtml(res.match.nombre)} (Ref. ${res.match.codigo}) &nbsp;·&nbsp; 📍 Ubicación: <b>${escapeHtml(res.match.ubicacion) || 'no asignada'}</b>`;
    hintEl.style.color = 'var(--ok)';
  } else if (res.reason === 'ambiguo') { hintEl.textContent = `Hay ${res.count} coincidencias, sé más específico.`; hintEl.style.color = 'var(--warn)'; }
  else { hintEl.textContent = 'No se encontró ninguna fragancia con ese nombre o referencia.'; hintEl.style.color = 'var(--danger)'; }
});

document.getElementById('registrarCompraBtn').addEventListener('click', () => runAction(async () => {
  const errEl = document.getElementById('compraError');
  errEl.textContent = '';
  const tipo = document.getElementById('compraTipo').value;
  const cantidad = Number(document.getElementById('compraCantidad').value) || 0;
  const costoTotal = Number(document.getElementById('compraCosto').value) || 0;
  const fecha = document.getElementById('compraFecha').value || todayStr();
  const nota = document.getElementById('compraNota').value.trim();

  if (cantidad <= 0) { errEl.textContent = 'Ingresa una cantidad válida.'; throw new Error('__silent__cantidad'); }

  const payload = { tipo, cantidad, costoTotal, fecha, nota };
  if (tipo === 'fragancia') {
    const res = resolveFragancia(document.getElementById('compraFraganciaSearch').value);
    if (!res.match) { errEl.textContent = 'Busca y selecciona una fragancia válida (por nombre o referencia).'; throw new Error('__silent__frag'); }
    payload.codigo = res.match.codigo;
  } else if (tipo === 'otro') {
    payload.otroId = document.getElementById('compraOtroSelect').value;
  }

  await api('/api/compra', { method: 'POST', body: JSON.stringify(payload) });
  document.getElementById('compraCantidad').value = '';
  document.getElementById('compraCosto').value = '';
  document.getElementById('compraNota').value = '';
  document.getElementById('compraFraganciaSearch').value = '';
  showToast('Compra registrada e inventario actualizado');
}).catch(() => {}));

// ---------------------------------------------------------------------------
// GASTOS GENERALES DEL NEGOCIO
// ---------------------------------------------------------------------------

function renderGastos() {
  if (!document.getElementById('gastoFecha').value) document.getElementById('gastoFecha').value = todayStr();

  const ym = new Date().toISOString().slice(0, 7);
  const gastosMes = DATA.gastos.filter(g => g.fecha.slice(0, 7) === ym).reduce((s, g) => s + g.monto, 0);
  const gastosTotal = DATA.gastos.reduce((s, g) => s + g.monto, 0);
  const porCategoria = {};
  DATA.gastos.forEach(g => { porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + g.monto; });
  const categoriaTop = Object.entries(porCategoria).sort((a, b) => b[1] - a[1])[0];

  document.getElementById('gastosKpiGrid').innerHTML = `
    <div class="kpi warn"><div class="label">Gastos este mes</div><div class="value">${fmtCOP(gastosMes)}</div></div>
    <div class="kpi"><div class="label">Gastos histórico total</div><div class="value">${fmtCOP(gastosTotal)}</div></div>
    <div class="kpi"><div class="label">Categoría con más gasto</div><div class="value" style="font-size:18px;">${categoriaTop ? escapeHtml(categoriaTop[0]) : '—'}</div></div>
  `;

  const tbody = document.getElementById('gastosTbody');
  const gastos = [...DATA.gastos].sort((a, b) => b.fecha.localeCompare(a.fecha));
  tbody.innerHTML = gastos.length === 0
    ? '<tr><td colspan="5"><div class="empty-note">Aún no has registrado gastos.</div></td></tr>'
    : gastos.map(g => `
      <tr>
        <td>${g.fecha}</td>
        <td><span class="tag mid">${escapeHtml(g.categoria)}</span></td>
        <td>${escapeHtml(g.descripcion)}</td>
        <td>${fmtCOP(g.monto)}</td>
        <td><button class="btn small danger" data-id="${g.id}">Eliminar</button></td>
      </tr>`).join('');
}

document.getElementById('addGastoBtn').addEventListener('click', () => runAction(async () => {
  const errEl = document.getElementById('gastoError');
  errEl.textContent = '';
  const fecha = document.getElementById('gastoFecha').value || todayStr();
  const categoria = document.getElementById('gastoCategoria').value;
  const descripcion = document.getElementById('gastoDescripcion').value.trim();
  const monto = Number(document.getElementById('gastoMonto').value) || 0;
  if (monto <= 0) { errEl.textContent = 'Ingresa un monto válido.'; throw new Error('__silent__monto'); }

  await api('/api/gasto', { method: 'POST', body: JSON.stringify({ fecha, categoria, descripcion, monto }) });
  document.getElementById('gastoMonto').value = '';
  document.getElementById('gastoDescripcion').value = '';
  showToast('Gasto registrado');
}).catch(() => {}));

document.getElementById('gastosTbody').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-id]');
  if (!btn) return;
  if (!confirm('¿Eliminar este gasto?')) return;
  runAction(async () => {
    await api(`/api/gasto/${btn.getAttribute('data-id')}`, { method: 'DELETE' });
    showToast('Gasto eliminado');
  });
});

// ---------------------------------------------------------------------------
// CLIENTES
// ---------------------------------------------------------------------------

function clienteStats(nombre) {
  const ventasCliente = DATA.ventas.filter(v => v.cliente === nombre);
  const totalComprado = ventasCliente.reduce((s, v) => s + v.total, 0);
  const numCompras = new Set(ventasCliente.map(v => v.folio)).size;
  const saldoPendiente = DATA.facturas.filter(f => f.cliente === nombre).reduce((s, f) => s + f.saldo, 0);
  const porFragancia = {};
  ventasCliente.forEach(v => { porFragancia[v.nombre] = (porFragancia[v.nombre] || 0) + v.cantidad; });
  const favorita = Object.entries(porFragancia).sort((a, b) => b[1] - a[1])[0];
  return { ventasCliente, totalComprado, numCompras, saldoPendiente, favorita: favorita ? favorita[0] : '—' };
}

function renderClientes() {
  const q = (document.getElementById('clientesSearch').value || '').trim().toLowerCase();
  const clientes = DATA.clientes.filter(c => !q || c.nombre.toLowerCase().includes(q));
  const tbody = document.getElementById('clientesTbody');
  if (clientes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-note">Aún no tienes clientes guardados. Se guardan solos cuando registras una venta con nombre de cliente.</div></td></tr>';
    return;
  }
  tbody.innerHTML = clientes.map(c => {
    const s = clienteStats(c.nombre);
    return `<tr data-cliente="${escapeAttr(c.nombre)}" style="cursor:pointer;">
      <td>${escapeHtml(c.nombre)}</td>
      <td>${escapeHtml(c.telefono || '—')}</td>
      <td>${s.numCompras}</td>
      <td>${fmtCOP(s.totalComprado)}</td>
      <td>${s.saldoPendiente > 0 ? `<span class="tag low">${fmtCOP(s.saldoPendiente)}</span>` : '—'}</td>
      <td>${escapeHtml(s.favorita)}</td>
      <td><button class="btn small" data-ver="${escapeAttr(c.nombre)}">Ver historial</button></td>
    </tr>`;
  }).join('');
}
document.getElementById('clientesSearch').addEventListener('input', debounce(renderClientes, 150));
document.getElementById('clientesTbody').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-ver]');
  if (!btn) return;
  const nombre = btn.getAttribute('data-ver');
  const s = clienteStats(nombre);
  document.getElementById('clienteDetalleNombre').textContent = 'Historial de ' + nombre;
  document.getElementById('clienteDetalleTbody').innerHTML = [...s.ventasCliente].sort((a, b) => b.fecha.localeCompare(a.fecha))
    .map(v => `<tr><td>${v.fecha}</td><td>${escapeHtml(v.nombre)}</td><td>${v.tamano}ML</td><td>${v.cantidad}</td><td>${fmtCOP(v.total)}</td>
      <td><button class="btn small" data-resend-id="${v.id}" title="Reenviar ticket por WhatsApp">📤</button></td></tr>`).join('')
    || '<tr><td colspan="6"><div class="empty-note">Sin compras registradas.</div></td></tr>';
  document.getElementById('clienteDetalleCard').style.display = 'block';
  try { document.getElementById('clienteDetalleCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* cosmetic only */ }
});
document.getElementById('clienteDetalleTbody').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-resend-id]');
  if (btn) resendTicketForVenta(btn.getAttribute('data-resend-id'));
});

// ---------------------------------------------------------------------------
// CUENTAS POR COBRAR
// ---------------------------------------------------------------------------

document.querySelectorAll('.pill-btn[data-cfilter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill-btn[data-cfilter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    cuentasFilter = btn.getAttribute('data-cfilter');
    renderCuentas();
  });
});
document.getElementById('cuentasSearch').addEventListener('input', debounce(renderCuentas, 150));

function renderCuentas() {
  const porCobrar = DATA.facturas.reduce((s, f) => s + f.saldo, 0);
  const totalFacturado = DATA.facturas.reduce((s, f) => s + f.total, 0);
  const nPendientes = DATA.facturas.filter(f => f.saldo > 0).length;
  const nAtrasadas = DATA.facturas.filter(f => f.saldo > 0 && diasDesde(f.fecha) > 15).length;
  document.getElementById('cuentasKpiGrid').innerHTML = `
    <div class="kpi ${porCobrar > 0 ? 'warn' : 'ok'}"><div class="label">Total por cobrar</div><div class="value">${fmtCOP(porCobrar)}</div></div>
    <div class="kpi"><div class="label">Facturas pendientes</div><div class="value">${nPendientes}</div></div>
    <div class="kpi ${nAtrasadas > 0 ? 'danger' : 'ok'}"><div class="label">Atrasadas (+15 días)</div><div class="value">${nAtrasadas}</div></div>
    <div class="kpi ok"><div class="label">Total facturado histórico</div><div class="value">${fmtCOP(totalFacturado)}</div></div>`;

  const q = (document.getElementById('cuentasSearch').value || '').trim().toLowerCase();
  let facturas = DATA.facturas.filter(f => {
    if (cuentasFilter === 'pendientes' && f.saldo <= 0) return false;
    if (q && !String(f.cliente || '').toLowerCase().includes(q)) return false;
    return true;
  });
  const tbody = document.getElementById('facturasTbody');
  tbody.innerHTML = facturas.length === 0
    ? '<tr><td colspan="8"><div class="empty-note">No hay facturas que coincidan.</div></td></tr>'
    : facturas.map(f => {
      const abonado = f.abonos.reduce((s, a) => s + a.monto, 0);
      const atrasada = f.saldo > 0 && diasDesde(f.fecha) > 15;
      const tagClass = f.estado === 'Pagada' ? 'ok' : (atrasada ? 'low' : (f.estado === 'Abono parcial' ? 'mid' : 'low'));
      const estadoLabel = atrasada ? `⏰ Atrasada (${diasDesde(f.fecha)}d)` : f.estado;
      return `<tr>
        <td>${f.fecha}</td><td>#${String(f.folio).padStart(4, '0')}</td><td>${escapeHtml(f.cliente || '—')}</td>
        <td>${fmtCOP(f.total)}</td><td>${fmtCOP(abonado)}</td><td>${fmtCOP(f.saldo)}</td>
        <td><span class="tag ${tagClass}">${estadoLabel}</span></td>
        <td style="display:flex; gap:6px; flex-wrap:wrap;">
          ${f.saldo > 0 ? `<button class="btn small primary" data-abonar="${f.id}">+ Abonar</button>` : ''}
          <button class="btn small" data-editcliente="${f.id}">✏️ Cliente</button>
        </td>
      </tr>`;
    }).join('');

  const abonos = [];
  DATA.facturas.forEach(f => f.abonos.forEach(a => abonos.push({ ...a, folio: f.folio, cliente: f.cliente })));
  abonos.sort((a, b) => b.fecha.localeCompare(a.fecha));
  document.getElementById('abonosTbody').innerHTML = abonos.length === 0
    ? '<tr><td colspan="7"><div class="empty-note">Aún no hay abonos registrados.</div></td></tr>'
    : abonos.map(a => `<tr>
        <td>${a.fecha}</td><td>#${String(a.folio).padStart(4, '0')}</td><td>${escapeHtml(a.cliente || '—')}</td>
        <td>${fmtCOP(a.monto)}</td><td>${escapeHtml(a.cuenta || '—')}</td><td>${escapeHtml(a.nota || '')}</td>
        <td style="display:flex; gap:6px;">
          <button class="btn small" data-editabono="${a.id}">✏️</button>
          <button class="btn small danger" data-id="${a.id}" data-tipo="abono">🗑️</button>
        </td>
      </tr>`).join('');
}
document.getElementById('facturasTbody').addEventListener('click', (e) => {
  const abonarBtn = e.target.closest('button[data-abonar]');
  if (abonarBtn) { openAbonoModal(abonarBtn.getAttribute('data-abonar')); return; }
  const editBtn = e.target.closest('button[data-editcliente]');
  if (editBtn) openEditClienteModal(editBtn.getAttribute('data-editcliente'));
});
document.getElementById('abonosTbody').addEventListener('click', (e) => {
  const editBtn = e.target.closest('button[data-editabono]');
  if (editBtn) { openEditAbonoModal(editBtn.getAttribute('data-editabono')); return; }
  const delBtn = e.target.closest('button[data-id][data-tipo="abono"]');
  if (delBtn) {
    deleteTarget = { id: delBtn.getAttribute('data-id'), tipo: 'abono' };
    document.getElementById('deleteMsg').textContent = 'La factura volverá a quedar con este monto como saldo pendiente.';
    document.getElementById('deleteOverlay').classList.add('open');
  }
});

function openAbonoModal(facturaId) {
  const fac = DATA.facturas.find(f => f.id === facturaId);
  if (!fac) return;
  abonoTarget = facturaId;
  document.getElementById('abonoFacturaInfo').innerHTML = `Factura #${String(fac.folio).padStart(4, '0')} — ${escapeHtml(fac.cliente || 'Cliente sin nombre')}<br>Total: <b>${fmtCOP(fac.total)}</b> &nbsp;·&nbsp; Saldo pendiente: <b style="color:var(--warn);">${fmtCOP(fac.saldo)}</b>`;
  document.getElementById('abonoMontoInput').value = fac.saldo;
  populateCuentaSelect('abonoCuentaInput');
  document.getElementById('abonoFechaInput').value = todayStr();
  document.getElementById('abonoNotaInput').value = '';
  document.getElementById('abonoOverlay').classList.add('open');
}
document.getElementById('cancelAbonoBtn').addEventListener('click', () => {
  abonoTarget = null;
  document.getElementById('abonoOverlay').classList.remove('open');
});
document.getElementById('confirmAbonoBtn').addEventListener('click', () => runAction(async () => {
  const monto = Number(document.getElementById('abonoMontoInput').value) || 0;
  const cuenta = document.getElementById('abonoCuentaInput').value;
  const fecha = document.getElementById('abonoFechaInput').value || todayStr();
  const nota = document.getElementById('abonoNotaInput').value.trim();
  await api('/api/abono', { method: 'POST', body: JSON.stringify({ facturaId: abonoTarget, monto, cuenta, fecha, nota }) });
  abonoTarget = null;
  document.getElementById('abonoOverlay').classList.remove('open');
  showToast('Abono registrado');
}));

let editClienteTarget = null;
function openEditClienteModal(facturaId) {
  const fac = DATA.facturas.find(f => f.id === facturaId);
  if (!fac) return;
  editClienteTarget = facturaId;
  document.getElementById('editClienteFacturaInfo').innerHTML =
    `Factura #${String(fac.folio).padStart(4, '0')} — ${fmtCOP(fac.total)}`;
  document.getElementById('editClienteNombreInput').value = fac.cliente || '';
  document.getElementById('editClienteTelInput').value = fac.cliente_tel || '';
  document.getElementById('editClienteOverlay').classList.add('open');
}
document.getElementById('cancelEditClienteBtn').addEventListener('click', () => {
  editClienteTarget = null;
  document.getElementById('editClienteOverlay').classList.remove('open');
});
document.getElementById('confirmEditClienteBtn').addEventListener('click', () => runAction(async () => {
  const cliente = document.getElementById('editClienteNombreInput').value.trim();
  const clienteTel = document.getElementById('editClienteTelInput').value.trim();
  await api(`/api/factura/${editClienteTarget}`, { method: 'PATCH', body: JSON.stringify({ cliente, clienteTel }) });
  editClienteTarget = null;
  document.getElementById('editClienteOverlay').classList.remove('open');
  showToast('Cliente actualizado');
}));

let editAbonoTarget = null;
function openEditAbonoModal(abonoId) {
  let abono = null, factura = null;
  for (const f of DATA.facturas) {
    const a = f.abonos.find(x => x.id === abonoId);
    if (a) { abono = a; factura = f; break; }
  }
  if (!abono) return;
  editAbonoTarget = abonoId;
  document.getElementById('editAbonoFacturaInfo').innerHTML =
    `Factura #${String(factura.folio).padStart(4, '0')} — ${escapeHtml(factura.cliente || 'Cliente sin nombre')}`;
  document.getElementById('editAbonoMontoInput').value = abono.monto;
  populateCuentaSelect('editAbonoCuentaInput');
  document.getElementById('editAbonoCuentaInput').value = abono.cuenta || '';
  document.getElementById('editAbonoFechaInput').value = abono.fecha;
  document.getElementById('editAbonoNotaInput').value = abono.nota || '';
  document.getElementById('editAbonoOverlay').classList.add('open');
}
document.getElementById('cancelEditAbonoBtn').addEventListener('click', () => {
  editAbonoTarget = null;
  document.getElementById('editAbonoOverlay').classList.remove('open');
});
document.getElementById('confirmEditAbonoBtn').addEventListener('click', () => runAction(async () => {
  const monto = Number(document.getElementById('editAbonoMontoInput').value) || 0;
  const cuenta = document.getElementById('editAbonoCuentaInput').value;
  const fecha = document.getElementById('editAbonoFechaInput').value || todayStr();
  const nota = document.getElementById('editAbonoNotaInput').value.trim();
  await api(`/api/abono/${editAbonoTarget}`, { method: 'PATCH', body: JSON.stringify({ monto, cuenta, fecha, nota }) });
  editAbonoTarget = null;
  document.getElementById('editAbonoOverlay').classList.remove('open');
  showToast('Pago actualizado');
}));

// ---------------------------------------------------------------------------
// HISTORIAL
// ---------------------------------------------------------------------------

document.querySelectorAll('.pill-btn[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill-btn[data-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    historialFilter = btn.getAttribute('data-filter');
    renderHistorial();
  });
});
document.getElementById('historialSearch').addEventListener('input', debounce(renderHistorial, 150));

function renderHistorial() {
  const q = (document.getElementById('historialSearch').value || '').trim().toLowerCase();
  let items = [];
  DATA.ventas.forEach(v => items.push({ ...v, _tipo: 'venta' }));
  DATA.compras.forEach(c => items.push({ ...c, _tipo: 'compra' }));
  items = items.filter(it => {
    if (historialFilter !== 'todos' && it._tipo !== historialFilter) return false;
    if (q && !String(it.nombre || '').toLowerCase().includes(q)) return false;
    return true;
  });
  items.sort((a, b) => b.fecha.localeCompare(a.fecha));

  const tbody = document.getElementById('historialTbody');
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-note">No hay movimientos que coincidan.</div></td></tr>';
    return;
  }
  tbody.innerHTML = items.map(it => {
    if (it._tipo === 'venta') {
      return `<tr>
        <td>${it.fecha}</td><td><span class="tag ok">Venta</span></td><td>Ref. ${it.codigo}</td>
        <td>${escapeHtml(it.nombre)} — ${it.tamano}ML x${it.cantidad}${it.es_recarga ? ' 🔄' : ''}${it.cliente ? ' · ' + escapeHtml(it.cliente) : ''}</td>
        <td>${fmtCOP(it.total)}</td>
        <td style="display:flex; gap:6px;">
          <button class="btn small" data-resend-id="${it.id}" title="Reenviar ticket por WhatsApp">📤</button>
          <button class="btn small danger" data-id="${it.id}" data-tipo="venta">Eliminar</button>
        </td>
      </tr>`;
    }
    return `<tr>
      <td>${it.fecha}</td><td><span class="tag mid">Compra</span></td><td>${it.codigo ? 'Ref. ' + it.codigo : '—'}</td>
      <td>${escapeHtml(it.nombre)} — ${it.detalle}${it.nota ? ' · ' + escapeHtml(it.nota) : ''}</td>
      <td>${it.costo_total ? fmtCOP(it.costo_total) : '—'}</td>
      <td><button class="btn small danger" data-id="${it.id}" data-tipo="compra">Eliminar</button></td>
    </tr>`;
  }).join('');
}
document.getElementById('historialTbody').addEventListener('click', (e) => {
  const resendBtn = e.target.closest('button[data-resend-id]');
  if (resendBtn) { resendTicketForVenta(resendBtn.getAttribute('data-resend-id')); return; }
  const btn = e.target.closest('button[data-id]');
  if (!btn) return;
  deleteTarget = { id: btn.getAttribute('data-id'), tipo: btn.getAttribute('data-tipo') };
  document.getElementById('deleteMsg').textContent = deleteTarget.tipo === 'venta'
    ? 'Esto devolverá la fragancia, el alcohol y el frasco al inventario.'
    : 'Esto restará la cantidad que se había sumado al inventario.';
  document.getElementById('deleteOverlay').classList.add('open');
});
document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
  deleteTarget = null;
  document.getElementById('deleteOverlay').classList.remove('open');
});
document.getElementById('confirmDeleteBtn').addEventListener('click', () => runAction(async () => {
  if (!deleteTarget) return;
  const tipo = deleteTarget.tipo;
  const path = tipo === 'venta' ? `/api/venta/${deleteTarget.id}`
    : tipo === 'abono' ? `/api/abono/${deleteTarget.id}`
    : `/api/compra/${deleteTarget.id}`;
  await api(path, { method: 'DELETE' });
  deleteTarget = null;
  document.getElementById('deleteOverlay').classList.remove('open');
  showToast(tipo === 'abono' ? 'Pago eliminado, la factura quedó pendiente' : 'Movimiento eliminado e inventario revertido');
}));

// ---------------------------------------------------------------------------
// BACKUP / EXPORT / IMPORT FRAGANCIAS
// ---------------------------------------------------------------------------

document.getElementById('exportExcelBtn').addEventListener('click', () => { window.location.href = '/api/export/excel'; });
document.getElementById('exportBackupBtn').addEventListener('click', () => { window.location.href = '/api/backup/export'; });

document.getElementById('importBackupBtn').addEventListener('click', () => document.getElementById('importFileInput').click());
document.getElementById('importFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => runAction(async () => {
    const payload = JSON.parse(evt.target.result);
    await api('/api/backup/import', { method: 'POST', body: JSON.stringify(payload) });
    showToast('Respaldo importado correctamente');
  });
  reader.readAsText(file);
  e.target.value = '';
});

document.getElementById('importFraganciasBtn').addEventListener('click', () => document.getElementById('importFraganciasFileInput').click());
document.getElementById('importFraganciasFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => runAction(async () => {
    const items = JSON.parse(evt.target.result);
    const result = await api('/api/fragancia', { method: 'PUT', body: JSON.stringify({ items }) });
    document.getElementById('importFraganciasStatus').textContent =
      `✅ Listo: ${result.nuevas} fragancia(s) nueva(s), ${result.actualizadas} actualizada(s). El stock existente no se tocó.`;
    showToast('Fragancias importadas');
  });
  reader.readAsText(file);
  e.target.value = '';
});

document.getElementById('importExcelStockBtn').addEventListener('click', () => document.getElementById('importExcelStockFileInput').click());
document.getElementById('importExcelStockFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('importExcelStockStatus');
  statusEl.textContent = 'Importando...';
  statusEl.style.color = 'var(--muted)';
  runAction(async () => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/fragancia/import-excel', { method: 'POST', body: formData });
      let body = null;
      try { body = await res.json(); } catch (err) { /* no body */ }
      if (!res.ok || (body && body.ok === false)) {
        throw new Error((body && body.error) ? body.error : `Error ${res.status}`);
      }
      let msg = `✅ Listo: ${body.actualizadas} referencia(s) actualizada(s) desde el Excel.`;
      if (body.noEncontradas && body.noEncontradas.length) {
        msg += ` ⚠️ ${body.noEncontradas.length} código(s) del Excel no existen en tu inventario (ej: ${body.noEncontradas.slice(0, 5).join(', ')}${body.noEncontradas.length > 5 ? '...' : ''}). Impórtalos primero desde el catálogo.`;
        statusEl.style.color = 'var(--warn)';
      } else {
        statusEl.style.color = 'var(--ok)';
      }
      statusEl.innerHTML = msg;
      showToast('Datos importados desde Excel');
    } catch (err) {
      statusEl.textContent = '⚠️ ' + (err.message || 'No se pudo importar el archivo.');
      statusEl.style.color = 'var(--danger)';
      throw err;
    }
  });
  e.target.value = '';
});

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------

(async function init() {
  try {
    DATA = await api('/api/bootstrap');
    renderAll();
  } catch (err) {
    console.error(err);
    document.body.innerHTML = '<div style="padding:40px; text-align:center; color:#efe7da; font-family:sans-serif;">' +
      '<h2>No se pudo conectar con el servidor local</h2><p>Asegúrate de haber iniciado el programa (start.bat / start.command) y de no haber cerrado esa ventana.</p></div>';
  }
})();
