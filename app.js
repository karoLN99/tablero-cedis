/* Tablero CEDIS -> tiendas. Lee las vistas de Supabase (solo lectura) y dibuja todo en el navegador. */
(() => {
  const CFG = window.TABLERO_CONFIG || {};
  CFG.SUPABASE_URL = String(CFG.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/(rest|storage)\/v1.*$/, '');
  CFG.SUPABASE_KEY = String(CFG.SUPABASE_KEY || '').trim();
  const ROJO = CFG.META_ROJO ?? 0.95;
  const $ = (s) => document.querySelector(s);
  const estado = { vista: 'ttl', mes: '', tienda: '', tiendas: [], reportes: [], cache: {} };

  // ------------------------------------------------------------------ datos
  const headers = { apikey: CFG.SUPABASE_KEY };
  if (CFG.SUPABASE_KEY && !CFG.SUPABASE_KEY.startsWith('sb_')) headers.Authorization = 'Bearer ' + CFG.SUPABASE_KEY;

  async function api(vista, params = {}, todo = false) {
    const q = new URLSearchParams(params).toString();
    const url = `${CFG.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${vista}${q ? '?' + q : ''}`;
    if (estado.cache[url]) return estado.cache[url];
    const filas = [];
    const paso = 1000;
    for (let i = 0; ; i += paso) {
      const r = await fetch(url, { headers: { ...headers, Range: `${i}-${i + paso - 1}` } });
      if (!r.ok) throw new Error(`${vista}: ${r.status} ${await r.text()}`);
      const lote = await r.json();
      filas.push(...lote);
      if (!todo || lote.length < paso) break;
    }
    estado.cache[url] = filas;
    return filas;
  }
  const filtro = (extra = {}) => {
    const p = { ...extra };
    if (estado.mes) p.mes = 'eq.' + estado.mes;
    if (estado.tienda) p.tienda_id = 'eq.' + estado.tienda;
    return p;
  };

  // ------------------------------------------------------------------ formato
  const nf = new Intl.NumberFormat('es-MX');
  const n = (v) => nf.format(Math.round(v || 0));
  const pct = (v, d = 1) => (v == null || !isFinite(v)) ? '—' : (v * 100).toFixed(d) + '%';
  const div = (a, b) => (b ? a / b : null);
  const clsPct = (v) => (v != null && v < ROJO ? 'rojo' : '');
  const fecha = (s, hora = false) => {
    if (!s) return '—';
    // 'AAAA-MM-DD' sin hora: se lee como fecha local (si no, el navegador la toma en UTC y la corre un día)
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : new Date(s.replace(' ', 'T'));
    const f = d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return hora ? f + ' ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : f;
  };
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const nombreMes = (m) => { const [a, mm] = m.split('-'); return `${MESES[+mm - 1]} ${a}`; };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nombreTienda = (id) => estado.tiendas.find((t) => t.tienda_id === id)?.nombre || `Tienda ${id}`;

  const sumar = (filas, campos) => {
    const t = Object.fromEntries(campos.map((c) => [c, 0]));
    filas.forEach((f) => campos.forEach((c) => (t[c] += +f[c] || 0)));
    return t;
  };
  const agrupar = (filas, llave, campos) => {
    const m = new Map();
    filas.forEach((f) => {
      const k = f[llave];
      if (!m.has(k)) m.set(k, { ...f, ...Object.fromEntries(campos.map((c) => [c, 0])) });
      const o = m.get(k);
      campos.forEach((c) => (o[c] += +f[c] || 0));
    });
    return [...m.values()];
  };

  function kpi(etiqueta, valor, detalle = '', alerta = false) {
    return `<div class="kpi${alerta ? ' alerta' : ''}"><div class="et">${etiqueta}</div><div class="val">${valor}</div><div class="det">${detalle}</div></div>`;
  }
  /** cols: [{t:'Título', k:'campo'|fn, n:true(numérica), cls:fn}] */
  function tabla(sel, cols, filas, total) {
    const el = $(sel);
    if (!filas.length) { el.innerHTML = `<tr><td class="vacio">Sin datos para este filtro.</td></tr>`; return; }
    const celda = (c, f) => {
      const v = typeof c.k === 'function' ? c.k(f) : f[c.k];
      const cl = [c.n ? 'n' : '', c.wrap ? 'wrap' : '', c.cls ? c.cls(f) : '', c.n && (v === 0 || v === '0') ? 'cero' : ''].join(' ').trim();
      return `<td class="${cl}">${c.html ? v : esc(v)}</td>`;
    };
    el.innerHTML = `<thead><tr>${cols.map((c) => `<th class="${c.n ? 'n' : ''}">${c.t}</th>`).join('')}</tr></thead><tbody>` +
      filas.map((f) => `<tr>${cols.map((c) => celda(c, f)).join('')}</tr>`).join('') +
      (total ? `<tr class="total">${cols.map((c) => celda(c, total)).join('')}</tr>` : '') + '</tbody>';
  }

  // tooltip para elementos con data-tip
  const tip = $('#tooltip');
  document.addEventListener('mousemove', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.innerHTML = t.dataset.tip; tip.hidden = false;
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + 'px'; tip.style.top = (e.clientY + 16) + 'px';
  });

  // ------------------------------------------------------------------ TTL
  const TRAMOS = [
    ['alto', 'Alto', '75–100% del TTL restante', '--t-alto'],
    ['medio', 'Medio', '50–75%', '--t-medio'],
    ['bajo', 'Bajo', '25–50%', '--t-bajo'],
    ['critico', 'Crítico', '0–25%', '--t-critico'],
    ['vencidas', 'Vencido', 'entregado tarde o sin entregar', '--t-vencido'],
  ];
  const CAMPOS_TTL = ['lineas', 'dentro', 'entregado_vencido', 'vencido_sin_entregar', 'pendiente_vigente', 'alto', 'medio', 'bajo', 'critico', 'entregadas', 'suma_restante', 'vencidas_con_stock_al_vencer'];

  async function vistaTTL() {
    const [tiendas, reqs, meses, subs, pend] = await Promise.all([
      api('v_ttl_tienda', filtro()),
      api('v_ttl_req', filtro()),
      api('v_ttl_mes', estado.mes ? { mes: 'eq.' + estado.mes } : {}),
      api('v_ttl_subcategoria', estado.mes ? { mes: 'eq.' + estado.mes } : {}, true),
      api('v_ttl_pendientes_stock', filtro({ limit: 300 })),
    ]);
    const T = sumar(tiendas, CAMPOS_TTL);
    const R = sumar(reqs, ['reqs', 'reqs_vencidos', 'reqs_abiertos', 'reqs_cumplidos']);
    const vencidas = T.entregado_vencido + T.vencido_sin_entregar;
    const conRes = T.lineas - T.pendiente_vigente;
    const pLin = div(T.dentro, conRes), pReq = div(R.reqs_cumplidos, R.reqs - R.reqs_abiertos);
    const m = meses[0] || {};
    const ttlDias = m.ttl_dias || 15;

    $('#ttl-kpis').innerHTML =
      kpi('Cumplimiento por línea', pct(pLin), `${n(T.dentro)} de ${n(conRes)} líneas con resultado`, pLin != null && pLin < ROJO) +
      kpi('Cumplimiento por requerimiento', pct(pReq), `${n(R.reqs_cumplidos)} de ${n(R.reqs - R.reqs_abiertos)} requerimientos`, pReq != null && pReq < ROJO) +
      kpi('Líneas vencidas', n(vencidas), vencidas ? `${n(T.vencido_sin_entregar)} siguen sin entregar · ${n(R.reqs_vencidos)} requerimientos` : 'al corte', vencidas > 0) +
      kpi('Pendientes vigentes', n(T.pendiente_vigente), m.primer_vencimiento && !estado.tienda ? `la primera vence el ${fecha(m.primer_vencimiento)}` : `en ${n(R.reqs_abiertos)} requerimientos abiertos`) +
      kpi('Mediana de entrega', estado.mes && m.mediana_horas != null ? (+m.mediana_horas).toFixed(1) + ' h' : '—', estado.mes ? `TTL ${ttlDias} días (${ttlDias * 24} h)` : 'elige un mes') +
      kpi('TTL restante promedio al entregar', pct(div(T.suma_restante, T.entregadas)), `${n(T.critico)} líneas en Crítico`);

    // distribución
    const D = { ...T, vencidas };
    const base = T.alto + T.medio + T.bajo + T.critico + vencidas;
    $('#ttl-dist-nota').textContent = `Sobre ${n(base)} líneas con resultado (sin las ${n(T.pendiente_vigente)} pendientes aún vigentes).`;
    $('#ttl-dist').innerHTML = !base ? '<p class="vacio">Sin líneas con resultado.</p>' :
      `<div class="seg" role="img" aria-label="Distribución por tramo">${TRAMOS.filter(([k]) => D[k] > 0).map(([k, et, , c]) =>
        `<div style="flex:${D[k]};background:var(${c})" data-tip="<b>${et}</b><br>${n(D[k])} líneas · ${pct(D[k] / base)}"></div>`).join('')}</div>
       <div class="leyenda">${TRAMOS.map(([k, et, r, c]) =>
        `<div><span class="c" style="background:var(${c})"></span><span><b>${et} · ${pct(div(D[k], base))}</b><small>${n(D[k])} líneas · ${r}</small></span></div>`).join('')}</div>`;

    // pendientes con stock
    estado.pendientes = pend;
    tabla('#ttl-pend', [
      { t: 'TTL restante', k: (f) => `<span class="mbar"><i style="width:${Math.max(2, f.ttl_restante * 60)}px"></i>${pct(+f.ttl_restante)}</span>`, html: true },
      { t: 'Vence', k: (f) => fecha(f.ttl_vence, true) },
      { t: 'Tienda', k: 'tienda' },
      { t: 'Producto', k: (f) => `${f.producto_id} · ${f.producto_nombre}`, wrap: true },
      { t: 'ABC', k: 'abc' },
      { t: 'Subcategoría', k: (f) => `${f.sub_categoria_id} · ${f.subcategoria}` },
      { t: 'Cant. requerida', k: (f) => n(f.cantidad), n: true },
      { t: 'Existencia CEDIS', k: (f) => n(f.ex_actual), n: true },
      { t: 'Creado', k: (f) => fecha(f.fecha_creacion, true) },
      { t: 'Req.', html: true, k: (f) => `<span title="${esc(f.req_id)}">${esc(String(f.req_id ?? '').slice(0, 8))}…</span>` },
    ], pend.slice(0, 100));

    // por tienda
    const fila = (f) => ({ ...f, con: f.lineas - f.pendiente_vigente, venc: f.entregado_vencido + f.vencido_sin_entregar, p: div(f.dentro, f.lineas - f.pendiente_vigente), r: div(f.suma_restante, f.entregadas) });
    const tf = agrupar(tiendas, 'tienda_id', CAMPOS_TTL).map(fila).sort((a, b) => b.venc - a.venc || b.pendiente_vigente - a.pendiente_vigente);
    tabla('#ttl-tiendas', [
      { t: 'Tienda', k: 'tienda' }, { t: 'Líneas', k: (f) => n(f.lineas), n: true },
      { t: 'Dentro TTL', k: (f) => n(f.dentro), n: true },
      { t: '% cumpl.', k: (f) => pct(f.p), n: true, cls: (f) => clsPct(f.p) },
      { t: 'Vencidas', k: (f) => n(f.venc), n: true }, { t: 'Pend. vigentes', k: (f) => n(f.pendiente_vigente), n: true },
      { t: 'Crítico', k: (f) => n(f.critico), n: true }, { t: 'TTL rest. prom.', k: (f) => pct(f.r), n: true },
    ], tf, tf.length > 1 ? fila({ ...T, tienda: 'Total' }) : null);

    // subcategorías (si hay vencidas, por vencidas; si no, por pendientes)
    const hayVenc = subs.some((s) => +s.vencidas > 0);
    const campo = hayVenc ? 'vencidas' : 'pendientes';
    const sf = agrupar(subs, 'sub_categoria_id', ['lineas', 'dentro', 'vencidas', 'pendientes'])
      .filter((s) => s[campo] > 0).sort((a, b) => b[campo] - a[campo]);
    const max = Math.max(1, ...sf.map((s) => s[campo]));
    $('#ttl-sub-titulo').textContent = hayVenc ? `Subcategorías afectadas (${sf.length} con vencidas)` : `Subcategorías con más pendientes (${sf.length})`;
    tabla('#ttl-sub', [
      { t: 'Subcategoría', k: (f) => `${f.sub_categoria_id} · ${f.subcategoria}` }, { t: 'Categoría', k: 'categoria' },
      { t: hayVenc ? 'Vencidas' : 'Pendientes', html: true,
        k: (f) => `<span class="mbar${hayVenc ? '' : ' verde'}"><i style="width:${Math.max(2, f[campo] / max * 120)}px"></i>${n(f[campo])} de ${n(f.lineas)}</span>` },
      { t: hayVenc ? 'Cumplimiento' : '% entregado', n: true,
        k: (f) => pct(hayVenc ? div(f.dentro, f.lineas - f.pendientes) : div(f.dentro, f.lineas)),
        cls: (f) => (hayVenc ? clsPct(div(f.dentro, f.lineas - f.pendientes)) : '') },
    ], sf.slice(0, 40));
    if (estado.tienda) $('#ttl-sub-titulo').textContent += ' · todas las tiendas';
  }

  // ------------------------------------------------------------------ NS general (picking)
  const META_NSG = CFG.META_NS_GENERAL ?? 1;   // rojo si pickeados < requeridos

  function tablaTresMeses(sel, filas, tres, campos, valor, meta, encabezados) {
    const el = $(sel);
    if (!tres.length) { el.innerHTML = '<tr><td class="vacio">Sin datos.</td></tr>'; return; }
    const delMes = (m) => filas.filter((f) => f.mes === m);
    const orden = new Map();
    filas.forEach((f) => { if (!orden.has(f.tienda)) orden.set(f.tienda, f.tienda_id ? +f.tienda_id : 1e6); });
    const tiendas = [...orden.keys()].filter((t) => tres.some((m) => delMes(m).some((f) => f.tienda === t)))
      .sort((a, b) => orden.get(a) - orden.get(b) || a.localeCompare(b));
    const nc = campos.length + 1;
    const celdas = (f) => {
      if (!f || !+f[campos[0]]) return Array(nc).fill(0).map((_, i) => `<td class="n cero${i ? '' : ' ini'}">—</td>`).join('');
      const v = valor(f);
      return campos.map((c, i) => `<td class="n${i ? '' : ' ini'}">${n(f[c])}</td>`).join('') +
             `<td class="n ns-celda ${v < meta ? 'ns-bajo' : 'ns-ok'}">${pct(v, 0)}</td>`;
    };
    const tot = (m) => sumar(delMes(m), campos);
    el.innerHTML = `<thead><tr><th rowspan="2">Tienda</th>${tres.map((m) => `<th colspan="${nc}" class="mes">${nombreMes(m).toUpperCase()}</th>`).join('')}</tr>
      <tr>${tres.map(() => encabezados.map((e, i) => `<th class="n${i ? '' : ' ini'}">${e}</th>`).join('')).join('')}</tr></thead><tbody>` +
      tiendas.map((t) => `<tr><td>${esc(t)}</td>${tres.map((m) => celdas(delMes(m).find((f) => f.tienda === t))).join('')}</tr>`).join('') +
      (tiendas.length > 1 ? `<tr class="total"><td>Total</td>${tres.map((m) => celdas(tot(m))).join('')}</tr>` : '') + '</tbody>';
  }

  function barrasMes(sel, meses, totalDe, meta, nota) {
    const vals = meses.map((m) => ({ m, ...totalDe(m) }));
    const max = Math.max(1, meta, ...vals.map((x) => x.v || 0));
    $(sel).innerHTML = `<div class="meses">${vals.map((x) => `<div class="mes-fila" data-tip="<b>${nombreMes(x.m)}</b><br>${x.tip}">
        <span>${nombreMes(x.m)}</span><span class="pista"><i style="width:${(x.v || 0) / max * 100}%"></i><span class="meta" style="left:${meta / max * 100}%"></span></span>
        <span class="n ${x.v < meta ? 'rojo' : ''}">${pct(x.v, 0)}</span></div>`).join('')}</div><p class="nota">${nota}</p>`;
  }

  async function vistaNSGeneral() {
    const [todas, dias] = await Promise.all([
      api('v_ns_general_mes', {}, true),
      api('v_ns_general_dia', filtro({ order: 'fecha.desc' }), true),
    ]);
    const filas = todas.filter((f) => !estado.tienda || f.tienda_id === estado.tienda);
    const meses = [...new Set(todas.map((f) => f.mes))].sort();
    const ref = estado.mes && meses.includes(estado.mes) ? estado.mes : meses[meses.length - 1];
    const tres = ref ? meses.filter((m) => m <= ref).slice(-3) : [];
    const C = ['skus_requeridos', 'skus_pickeados', 'skus_enviados'];
    const tot = (m) => sumar(filas.filter((f) => f.mes === m), C);
    const nsv = (f) => div(+f.skus_pickeados, +f.skus_requeridos);
    const T = ref ? tot(ref) : sumar([], C); const ns = nsv(T);
    const iAnt = tres.length > 1 ? tot(tres[tres.length - 2]) : null; const nsAnt = iAnt ? nsv(iAnt) : null;
    const dif = ns != null && nsAnt != null ? (ns - nsAnt) * 100 : null;
    const rango = filas.filter((f) => f.mes === ref);
    const desde = rango.length ? rango.map((f) => f.desde).sort()[0] : null;
    const hasta = rango.length ? rango.map((f) => f.hasta).sort().slice(-1)[0] : null;
    const bajo = ref ? filas.filter((f) => f.mes === ref && nsv(f) != null && nsv(f) < META_NSG).length : 0;

    $('#nsg-kpis').innerHTML =
      kpi('Nivel de servicio' + (ref ? ' · ' + nombreMes(ref) : ''), pct(ns, 0),
        (dif != null ? `${dif >= 0 ? '▲' : '▼'} ${Math.abs(dif).toFixed(1)} pts vs mes anterior` : ''), ns != null && ns < META_NSG) +
      kpi('SKUs requeridos', n(T.skus_requeridos), desde ? `del ${fecha(desde)} al ${fecha(hasta)}` : '') +
      kpi('SKUs entregados (pickeados)', n(T.skus_pickeados), `${n(T.skus_enviados)} enviados`) +
      kpi('Tiendas debajo de 100%', n(bajo), ref ? nombreMes(ref) : '', bajo > 0);

    const previos = ref ? meses.filter((m) => m < ref).slice(-3) : [];
    const encG = ['SKUs requeridos', 'SKUs entregados', 'Nivel de servicio'];
    $('#nsg-tit').textContent = `Nivel de servicio general · ${ref ? nombreMes(ref) : ''}`;
    tablaTresMeses('#nsg-tiendas', filas, ref ? [ref] : [], ['skus_requeridos', 'skus_pickeados'], nsv, META_NSG, encG);
    $('#nsg-tres-tit').textContent = previos.length ? `Últimos 3 meses cerrados · ${nombreMes(previos[0])} a ${nombreMes(previos[previos.length - 1])}` : 'Últimos 3 meses cerrados';
    tablaTresMeses('#nsg-tres', filas, previos, ['skus_requeridos', 'skus_pickeados'], nsv, META_NSG, encG);

    barrasMes('#nsg-meses', meses.slice(-12), (m) => { const f = tot(m); return { v: nsv(f), tip: `${n(f.skus_pickeados)} de ${n(f.skus_requeridos)} SKUs` }; },
      META_NSG, `Últimos 12 meses${estado.tienda ? ' · ' + esc(nombreTienda(estado.tienda)) : ' · todas las tiendas'}. La línea vertical marca 100%.`);

    const porDia = agrupar(dias.filter((f) => !ref || f.mes === ref), 'fecha', C).sort((a, b) => b.fecha.localeCompare(a.fecha));
    $('#nsg-dias-tit').textContent = `Por día · ${ref ? nombreMes(ref) : ''}`;
    tabla('#nsg-dias', [
      { t: 'Fecha', k: (f) => fecha(f.fecha) },
      { t: 'SKUs requeridos', k: (f) => n(f.skus_requeridos), n: true },
      { t: 'Pickeados', k: (f) => n(f.skus_pickeados), n: true },
      { t: 'Enviados', k: (f) => n(f.skus_enviados), n: true },
    ], porDia);
  }

  // ------------------------------------------------------------------ NS subcategorías
  const MOTIVOS = ['Con stock en cedis', 'Sin Stock en Cedis', 'Sin stock suficiente', 'Con stock similar a lo requerido'];
  const ABCS = ['9', 'A', 'B', 'C', 'D'];

  async function vistaNSSub() {
    const [res, noc, mot, mat] = await Promise.all([
      api('v_ns_subcat_resumen', {}, true),
      api('v_ns_subcat_no_cumple', filtro({ limit: 500 })),
      api('v_ns_motivo', estado.mes ? { mes: 'eq.' + estado.mes } : {}, true),
      api('v_ns_subcat_motivo', estado.mes ? { mes: 'eq.' + estado.mes } : {}, true),
    ]);
    const filas = res.filter((f) => !estado.tienda || f.tienda_id === estado.tienda);
    const mesesRes = [...new Set(res.map((f) => f.mes))].sort();
    // mes elegido (o el último con datos) y los dos anteriores
    const ref = estado.mes && mesesRes.includes(estado.mes) ? estado.mes : mesesRes[mesesRes.length - 1];
    const tres = ref ? mesesRes.filter((m) => m <= ref).slice(-3) : [];
    const delMes = (m) => filas.filter((f) => f.mes === m);
    const tot = (m) => sumar(delMes(m), ['total', 'entregadas', 'no_entregadas']);
    const T = ref ? tot(ref) : { total: 0, entregadas: 0, no_entregadas: 0 };
    const nsT = div(T.entregadas, T.total);
    const ant = tres.length > 1 ? tot(tres[tres.length - 2]) : null;
    const nsAnt = ant ? div(ant.entregadas, ant.total) : null;
    const totInc = mot.reduce((s, f) => s + +f.n, 0);
    const dif = nsT != null && nsAnt != null ? (nsT - nsAnt) * 100 : null;
    $('#nss-kpis').innerHTML =
      kpi('NS por subcategoría' + (ref ? ' · ' + nombreMes(ref) : ''), pct(nsT, 0),
        `${n(T.entregadas)} de ${n(T.total)} subcategorías` + (dif != null ? ` · ${dif >= 0 ? '▲' : '▼'} ${Math.abs(dif).toFixed(1)} pts vs mes anterior` : ''), nsT != null && nsT < ROJO) +
      kpi('Subcategorías no entregadas en ≤ 96 h', n(T.no_entregadas), ref ? nombreMes(ref) : '') +
      kpi('Requerimientos que no cumplieron', n(totInc), 'NO CUMPLE + pendientes con más de 96 h · todas las tiendas') +
      MOTIVOS.slice(0, 2).map((m) => { const v = mot.filter((f) => f.motivo === m).reduce((s, f) => s + +f.n, 0); return kpi(m, n(v), pct(div(v, totInc)) + ' del total de requerimientos'); }).join('');

    // ---- pendientes con stock por antigüedad (última carga; respeta tienda, no mes)
    const pend = await api('v_ns_pendientes_stock', estado.tienda ? { tienda_id: 'eq.' + estado.tienda, order: 'horas.desc' } : { order: 'horas.desc' }, true);
    estado.pendNS = pend;
    pintarPendientesNS();

    // ---- mes elegido y, aparte, los 3 meses cerrados anteriores
    const nsSub = (f) => div(+f.entregadas, +f.total);
    const encS = ['Total subcat.', 'Entregado ≤ 96 h', 'No entregado', 'Nivel de servicio'];
    const previos = ref ? mesesRes.filter((m) => m < ref).slice(-3) : [];
    $('#nss-tit').textContent = `Nivel de servicio por subcategoría · ${ref ? nombreMes(ref) : ''}`;
    tablaTresMeses('#nss-tiendas', filas, ref ? [ref] : [], ['total', 'entregadas', 'no_entregadas'], nsSub, ROJO, encS);
    $('#nss-tres-tit').textContent = previos.length ? `Últimos 3 meses cerrados · ${nombreMes(previos[0])} a ${nombreMes(previos[previos.length - 1])}` : 'Últimos 3 meses cerrados';
    tablaTresMeses('#nss-tres', filas, previos, ['total', 'entregadas', 'no_entregadas'], nsSub, ROJO, encS);

    // ---- evolución mensual (todo el histórico)
    const ultimos = mesesRes.slice(-12);
    $('#nss-meses').innerHTML = `<div class="meses">${ultimos.map((m) => {
      const f = tot(m); const v = div(f.entregadas, f.total) || 0;
      return `<div class="mes-fila" data-tip="<b>${nombreMes(m)}</b><br>${n(f.entregadas)} de ${n(f.total)} subcategorías">
        <span>${nombreMes(m)}</span><span class="pista"><i style="width:${v * 100}%"></i><span class="meta" style="left:${ROJO * 100}%"></span></span>
        <span class="n ${clsPct(v)}">${pct(v, 0)}</span></div>`;
    }).join('')}</div><p class="nota">Últimos 12 meses${estado.tienda ? ' · ' + esc(nombreTienda(estado.tienda)) : ' · todas las tiendas'}. La línea vertical marca la meta de ${pct(ROJO, 0)}.</p>`;

    // ---- subcategorías que no cumplieron
    $('#nss-nocumple-tit').textContent = `Subcategorías que no cumplieron (promedio > 96 h) · ${noc.length}`;
    tabla('#nss-nocumple', [
      { t: 'Tienda', k: 'tienda' }, { t: 'Subcategoría', k: (f) => `${f.sub_categoria_id} · ${f.subcategoria ?? ''}` },
      { t: 'Categoría', k: 'categoria' },
      { t: 'Horas prom.', k: (f) => (+f.horas_promedio).toFixed(1), n: true, cls: () => 'rojo' },
      { t: 'Días', k: (f) => (+f.dias).toFixed(1), n: true }, { t: 'Líneas', k: (f) => n(f.lineas_skus), n: true },
    ], noc);

    // motivo x ABC
    const cuenta = (filas, fm, fa) => filas.filter((f) => f.motivo === fm && (fa == null || f.abc === fa)).reduce((s, f) => s + +f.n, 0);
    const filasM = MOTIVOS.map((m) => ({ motivo: m, ...Object.fromEntries(ABCS.map((a) => [a, cuenta(mot, m, a)])), total: cuenta(mot, m) }));
    const totM = { motivo: 'Total general', ...Object.fromEntries(ABCS.map((a) => [a, filasM.reduce((s, f) => s + f[a], 0)])), total: totInc };
    tabla('#nss-motivo', [{ t: 'Motivo', k: 'motivo' }, ...ABCS.map((a) => ({ t: a, k: (f) => n(f[a]), n: true })),
      { t: 'Total', k: (f) => n(f.total), n: true }, { t: '%', k: (f) => pct(div(f.total, totInc)), n: true }], filasM, totM);
    const est = (m, e) => mot.filter((f) => (m == null || f.motivo === m) && f.estatus === e).reduce((s, f) => s + +f.n, 0);
    tabla('#nss-estatus', [{ t: 'Motivo', k: 'motivo' }, { t: 'NO CUMPLE', k: (f) => n(f.nc), n: true }, { t: 'PENDIENTE', k: (f) => n(f.p), n: true }, { t: 'Total', k: (f) => n(f.nc + f.p), n: true }],
      MOTIVOS.map((m) => ({ motivo: m, nc: est(m, 'NO CUMPLE'), p: est(m, 'PENDIENTE') })), { motivo: 'Total general', nc: est(null, 'NO CUMPLE'), p: est(null, 'PENDIENTE') });

    // matriz subcategoría x tienda
    const selM = $('#nss-f-motivo');
    if (!selM.options.length) {
      selM.innerHTML = MOTIVOS.map((m) => `<option>${m}</option>`).join('');
      selM.onchange = () => pintarMatriz(estado.matriz);
    }
    estado.matriz = mat; pintarMatriz(mat);
  }

  const COLS_PEND_NS = (conMotivo) => [
    { t: 'Horas', k: (f) => (+f.horas).toFixed(0) + ' h', n: true, cls: (f) => (+f.horas >= 96 ? 'rojo' : '') },
    { t: 'Tienda', k: 'tienda' },
    { t: 'Producto', k: (f) => `${f.producto_id} · ${f.producto_nombre ?? ''}`, wrap: true },
    { t: 'ABC', k: 'abc' },
    { t: 'Subcategoría', k: (f) => `${f.sub_categoria_id} · ${f.subcategoria}` },
    { t: 'Cant. requerida', k: (f) => n(f.cantidad), n: true },
    { t: 'Existencia CEDIS', k: (f) => n(f.ex_actual), n: true },
    ...(conMotivo ? [{ t: 'Motivo', k: (f) => f.ns_motivo ?? '' }] : []),
    { t: 'Creado', k: (f) => fecha(f.fecha_creacion, true) },
    { t: 'Req.', html: true, k: (f) => `<span title="${esc(f.req_id)}">${esc(String(f.req_id ?? '').slice(0, 8))}…</span>` },
  ];
  const MAX_FILAS = 300;
  function filasPend72() {
    const [a, b] = $('#nss-p72-rango').value.split('-').map(Number);
    return (estado.pendNS || []).filter((f) => +f.horas >= a && +f.horas < b);
  }
  function filasPend96() { return (estado.pendNS || []).filter((f) => +f.horas >= 96); }
  function pintarPendientesNS() {
    const p72 = filasPend72(), p96 = filasPend96();
    const rango = $('#nss-p72-rango').value.replace('-', ' a ');
    $('#nss-p72-tit').textContent = `Pendientes con stock · ${rango} h · ${n(p72.length)} líneas`;
    $('#nss-p96-tit').textContent = `Pendientes con stock y más de 96 h · ${n(p96.length)} líneas`;
    tabla('#nss-p72', COLS_PEND_NS(false), p72.slice(0, MAX_FILAS));
    tabla('#nss-p96', COLS_PEND_NS(true), p96.slice(0, MAX_FILAS));
    if (p72.length > MAX_FILAS) $('#nss-p72').insertAdjacentHTML('beforeend', `<tr><td colspan="9" class="vacio">Se muestran ${MAX_FILAS} de ${n(p72.length)}. Descarga el CSV para ver todas.</td></tr>`);
    if (p96.length > MAX_FILAS) $('#nss-p96').insertAdjacentHTML('beforeend', `<tr><td colspan="10" class="vacio">Se muestran ${MAX_FILAS} de ${n(p96.length)}. Descarga el CSV para ver todas.</td></tr>`);
  }
  function descargarCSV(filas, nombre) {
    const cols = ['tienda_id', 'tienda', 'req_id', 'id_req_d', 'fecha_creacion', 'horas', 'producto_id', 'producto_nombre', 'abc',
                  'sub_categoria_id', 'subcategoria', 'categoria', 'cantidad', 'ex_crea', 'ex_actual', 'ns_motivo', 'gestor'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '\ufeff' + cols.join(',') + '\n' + filas.map((r) => cols.map((c) => q(r[c])).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = nombre + (estado.tienda ? '_t' + estado.tienda : '') + '.csv';
    a.click();
  }

  function pintarMatriz(mat) {
    const m = $('#nss-f-motivo').value;
    const filas = mat.filter((f) => f.motivo === m && (!estado.tienda || f.tienda_id === estado.tienda));
    const tiendas = [...new Set(filas.map((f) => f.tienda_id))].sort((a, b) => +a - +b);
    const subs = new Map();
    filas.forEach((f) => {
      if (!subs.has(f.sub_categoria_id)) subs.set(f.sub_categoria_id, { id: f.sub_categoria_id, sub: f.subcategoria, cat: f.categoria, total: 0 });
      const s = subs.get(f.sub_categoria_id);
      s[f.tienda_id] = (s[f.tienda_id] || 0) + +f.n; s.total += +f.n;
    });
    const lista = [...subs.values()].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
    const tot = { id: 'Total general', sub: '', cat: '', total: lista.reduce((s, f) => s + f.total, 0) };
    tiendas.forEach((t) => (tot[t] = lista.reduce((s, f) => s + (f[t] || 0), 0)));
    tabla('#nss-matriz', [{ t: 'Subcategoría', k: 'id' }, { t: 'Nombre', k: 'sub' }, { t: 'Categoría', k: 'cat' },
      ...tiendas.map((t) => ({ t: esc(nombreTienda(t)), k: (f) => n(f[t] || 0), n: true })),
      { t: 'Total', k: (f) => n(f.total), n: true }], lista, lista.length ? tot : null);
  }

  // ------------------------------------------------------------------ descargas
  function pintarDescargas() {
    const tipos = estado.vista === 'ttl' ? ['ttl', 'ns_subcategoria'] : estado.vista === 'ns-sub' ? ['ns_subcategoria'] : [];
    const nombres = { ttl: 'Análisis TTL (Excel)', ns_subcategoria: 'Reporte NS por subcategoría' };
    const html = tipos.map((t) => {
      const r = estado.reportes.filter((x) => x.tipo === t && (!estado.mes || x.ruta.includes(estado.mes)))[0]
             || estado.reportes.filter((x) => x.tipo === t)[0];
      return r ? `<a class="btn-desc" href="${esc(r.url)}" download>⬇ ${nombres[t]} <small>${esc(r.periodo)}</small></a>` : '';
    }).join('');
    $('#descargas').innerHTML = html;
  }

  function csvPendientes() {
    const f = estado.pendientes || [];
    const cols = ['tienda_id', 'tienda', 'req_id', 'id_req_d', 'fecha_creacion', 'ttl_vence', 'ttl_restante', 'producto_id', 'producto_nombre', 'abc', 'sub_categoria_id', 'subcategoria', 'cantidad', 'ex_actual', 'gestor'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '﻿' + cols.join(',') + '\n' + f.map((r) => cols.map((c) => q(r[c])).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `pendientes_con_stock_${estado.mes || 'todos'}${estado.tienda ? '_t' + estado.tienda : ''}.csv`;
    a.click();
  }

  // ------------------------------------------------------------------ navegación
  const VISTAS = { 'ttl': vistaTTL, 'ns-general': vistaNSGeneral, 'ns-sub': vistaNSSub };
  async function pintar() {
    document.querySelectorAll('.vista').forEach((v) => (v.hidden = v.id !== 'v-' + estado.vista));
    document.querySelectorAll('.menu button').forEach((b) => b.classList.toggle('activo', b.dataset.vista === estado.vista));
    pintarDescargas();
    const params = new URLSearchParams({ v: estado.vista, mes: estado.mes, tienda: estado.tienda });
    history.replaceState(null, '', '#' + params);
    document.querySelectorAll('.aviso-mes').forEach((x) => x.remove());
    if (estado.vista !== 'ns-general' && estado.mes && estado.mesesDetalle && !estado.mesesDetalle.has(estado.mes)) {
      const txt = estado.vista === 'ns-sub'
        ? `${nombreMes(estado.mes)} viene del histórico: se muestra el resumen por tienda; los motivos (Reporte NS) solo existen desde que se cargan los archivos diarios.`
        : `No hay detalle por línea de ${nombreMes(estado.mes)}: este menú se llena con los archivos diarios. El histórico de meses anteriores está en Nivel de servicio → General y → Subcategorías.`;
      $('#v-' + estado.vista).insertAdjacentHTML('afterbegin', `<div class="aviso-mes">${txt}</div>`);
    }
    try { await VISTAS[estado.vista](); }
    catch (e) { console.error(e); $('#v-' + estado.vista).insertAdjacentHTML('afterbegin', `<div class="error">No se pudieron leer los datos: ${esc(e.message)}</div>`); }
  }

  async function iniciar() {
    if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes('TU-PROYECTO')) {
      $('main').innerHTML = '<div class="error">Falta configurar <b>config.js</b> con la URL y la llave publishable de Supabase.</div>';
      $('#corte').textContent = 'Sin configurar';
      return;
    }
    const h = new URLSearchParams(location.hash.slice(1));
    try {
      const [corte, meses, tiendas, reportes, resumenSub, nsGeneral] = await Promise.all([
        api('v_corte'), api('v_meses'), api('tiendas', { order: 'tienda_id' }), api('reportes', { order: 'actualizado.desc' }),
        api('v_ns_subcat_resumen', {}, true).catch(() => []),
        api('v_ns_general_mes', {}, true).catch(() => []),
      ]);
      estado.tiendas = tiendas; estado.reportes = reportes;
      const c = corte[0] || {};
      $('#corte').textContent = c.corte ? `Datos al corte del ${fecha(c.corte, true)} · actualizado ${fecha(c.cargado, true)}` : 'Aún no hay cargas';
      // meses con detalle por línea + meses del histórico de subcategorías
      const det = new Map(meses.map((m) => [m.mes, m]));
      const todos = [...new Set([...det.keys(), ...resumenSub.map((f) => f.mes), ...nsGeneral.map((f) => f.mes)])].sort().reverse();
      estado.mesesDetalle = new Set(det.keys());
      $('#f-mes').innerHTML = todos.map((m) => {
        const d = det.get(m);
        return `<option value="${m}">${nombreMes(m)}${d ? ` (${fecha(d.desde)}–${fecha(d.hasta)})` : ''}</option>`;
      }).join('') + '<option value="">Todos los meses</option>';
      const ids = tiendas.filter((t) => t.incluir !== false).map((t) => t.tienda_id).sort((a, b) => +a - +b);
      $('#f-tienda').innerHTML = '<option value="">Todas</option>' + ids.map((id) => `<option value="${id}">${esc(nombreTienda(id))}</option>`).join('');
      estado.vista = VISTAS[h.get('v')] ? h.get('v') : 'ttl';
      estado.mes = h.has('mes') ? h.get('mes') : (meses[0]?.mes || todos[0] || '');
      estado.tienda = h.get('tienda') || '';
      $('#f-mes').value = estado.mes; $('#f-tienda').value = estado.tienda;
    } catch (e) {
      $('main').innerHTML = `<div class="error">No se pudo conectar con la base de datos: ${esc(e.message)}</div>`;
      return;
    }
    $('#f-mes').onchange = (e) => { estado.mes = e.target.value; pintar(); };
    $('#f-tienda').onchange = (e) => { estado.tienda = e.target.value; pintar(); };
    document.querySelectorAll('.menu button').forEach((b) => (b.onclick = () => { estado.vista = b.dataset.vista; pintar(); }));
    $('#ttl-pend-csv').onclick = csvPendientes;
    $('#nss-p72-rango').onchange = pintarPendientesNS;
    $('#nss-p72-csv').onclick = () => descargarCSV(filasPend72(), 'pendientes_con_stock_' + $('#nss-p72-rango').value + 'h');
    $('#nss-p96-csv').onclick = () => descargarCSV(filasPend96(), 'pendientes_con_stock_mas_96h');
    pintar();
  }
  iniciar();
})();
