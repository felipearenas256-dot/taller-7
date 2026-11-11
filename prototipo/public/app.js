// Centro de control: consulta al API Gateway cada segundo y dibuja el estado de la ciudad.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d }));
const NOMBRES = { broker: 'Bus', energia: 'Energía', movilidad: 'Movilidad', residuos: 'Residuos', 'edge-norte': 'Edge Norte', 'edge-sur': 'Edge Sur', gateway: 'Gateway' };
const ZONAS = [
  { id: 'z1', nombre: 'Centro', x: 0, y: 0 }, { id: 'z2', nombre: 'Norte', x: 1, y: 0 },
  { id: 'z3', nombre: 'Sur', x: 0, y: 1 }, { id: 'z4', nombre: 'Industrial', x: 1, y: 1 },
];
const colorLlenado = (v) => (v >= 75 ? 'var(--lleno)' : v >= 50 ? 'var(--medio)' : 'var(--ok)');
const colorCongestion = { baja: 'var(--ok)', media: 'var(--medio)', alta: 'var(--lleno)' };

async function actualizar() {
  try {
    const r = await fetch('/api/estado', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    pintar(await r.json());
  } catch {
    $('sistema').textContent = 'Sin conexión';
    $('sistema').className = 'estado mal';
  }
}

function pintar(e) {
  $('reloj').textContent = e.reloj.hora;
  $('icono-dia').textContent = e.reloj.noche ? '☾' : '☀';
  const caidos = e.salud.filter((s) => !s.ok);
  $('sistema').textContent = caidos.length ? `${caidos.length} servicio${caidos.length > 1 ? 's' : ''} caído${caidos.length > 1 ? 's' : ''}` : 'Todo funcionando';
  $('sistema').className = caidos.length ? 'estado mal' : 'estado';

  pintarKpis(e);
  pintarMapa(e);
  pintarGrafica(e.energia);
  pintarZonas(e);
  pintarRecoleccion(e.residuos);
  pintarAlertas(e);
  pintarFlujo(e);
}

function kpi(etq, val, unidad, det) {
  return `<div class="kpi"><div class="etq">${etq}</div><div class="val">${val}<small>${unidad}</small></div><div class="det">${det}</div></div>`;
}

function pintarKpis(e) {
  const en = e.energia, mo = e.movilidad, re = e.residuos;
  const llenos = re ? re.contenedores.filter((c) => c.llenado >= re.umbral).length : null;
  const co2 = (en?.co2EvitadoKg || 0) + (re?.co2EvitadoKg || 0);
  const lento = mo?.zonas.filter((z) => z.congestion === 'alta').map((z) => z.nombre) || [];
  $('kpis').innerHTML = [
    kpi('Consumo ahora', en ? num(en.totalKw) : '—', 'kW', en ? `${num(en.kwhAhorrados, 1)} kWh ahorrados en alumbrado` : 'servicio reiniciando…'),
    kpi('CO₂ evitado', num(co2, 1), 'kg', `<b>${num(re?.kmAhorrados ?? 0, 1)} km</b> menos de camión`),
    kpi('Tráfico', mo ? num(mo.vehiculosMinCiudad) : '—', 'veh/min', mo ? (lento.length ? `Congestión en ${esc(lento.join(', '))}` : 'Sin congestión') : 'servicio reiniciando…'),
    kpi('Contenedores llenos', llenos ?? '—', `de ${re?.contenedores.length ?? 24}`, re?.camionEnRuta ? 'Camión en ruta' : 'Se envía camión con 5 llenos'),
  ].join('');
}

function pintarMapa(e) {
  const mo = e.movilidad?.zonas || [];
  const luz = Object.fromEntries(e.edges.flatMap((x) => x.zonas.map((z) => [z.id, { nivel: z.nivelLuz, enLinea: x.enLinea }])));
  const fondoZona = e.reloj.noche ? 'var(--zona-noche)' : 'var(--zona)';
  let s = '';
  for (const z of ZONAS) {
    const m = mo.find((v) => v.zona === z.id);
    const l = luz[z.id];
    const x0 = z.x * 5 + 0.06, y0 = z.y * 5 + 0.06;
    s += `<rect x="${x0}" y="${y0}" width="4.88" height="4.88" rx="0.22" fill="${fondoZona}" ${l && !l.enLinea ? 'stroke="var(--medio)" stroke-width="0.06" stroke-dasharray="0.18 0.1"' : ''}/>`;
    // Franja de color = nivel de tráfico
    s += `<rect x="${x0}" y="${y0}" width="0.1" height="4.88" fill="${colorCongestion[m?.congestion] || 'var(--borde)'}"/>`;
    s += `<text x="${x0 + 0.3}" y="${y0 + 0.5}" font-size="0.32" font-weight="650" fill="var(--texto)">${z.nombre}</text>`;
    const det = m?.velocidadKmh !== undefined ? `${num(m.velocidadKmh)} km/h` : '';
    const luzTxt = e.reloj.noche && l ? ` · luces ${Math.round(l.nivel * 100)} %` : '';
    s += `<text x="${x0 + 0.3}" y="${y0 + 0.88}" font-size="0.23" fill="var(--suave)">${esc(det + luzTxt)}${l && !l.enLinea ? ' · sin Internet' : ''}</text>`;
  }
  const re = e.residuos;
  if (re) {
    const pos = Object.fromEntries(re.contenedores.map((c) => [c.id, c]));
    if (re.ultimaRuta && re.camionEnRuta) {
      const pts = [re.deposito, ...re.ultimaRuta.contenedores.map((id) => pos[id]), re.deposito].map((p) => `${p.x},${p.y}`).join(' ');
      s += `<polyline points="${pts}" fill="none" stroke="var(--ruta)" stroke-width="0.06" stroke-dasharray="0.16 0.1" stroke-linejoin="round"/>`;
    }
    for (const c of re.contenedores) {
      const v = c.llenado ?? 0;
      const lleno = v >= re.umbral;
      s += `<g><title>Contenedor ${esc(c.id)}: ${num(v)} %</title><circle cx="${c.x}" cy="${c.y}" r="${lleno ? 0.22 : 0.15}" fill="${colorLlenado(v)}" stroke="var(--tarjeta)" stroke-width="0.04"/>`;
      if (lleno) s += `<text x="${c.x}" y="${c.y + 0.07}" font-size="0.18" text-anchor="middle" fill="#fff" font-weight="700">${Math.round(v)}</text>`;
      s += '</g>';
    }
    s += `<g><title>Depósito de camiones</title><rect x="${re.deposito.x - 0.2}" y="${re.deposito.y - 0.2}" width="0.4" height="0.4" rx="0.08" fill="var(--texto)"/></g>`;
  }
  $('mapa').innerHTML = s;
}

function pintarGrafica(en) {
  const svg = $('grafica');
  if (!en) { svg.innerHTML = ''; $('prediccion').textContent = 'Servicio de energía reiniciando…'; return; }
  const p1h = en.prediccion.find((p) => p.enMin === 60)?.kw;
  $('prediccion').innerHTML = `Ahora <b>${num(en.totalKw)} kW</b> · en 1 h (IA) <b>${num(p1h)} kW</b>`;
  const d = en.serie;
  if (d.length < 2) { svg.innerHTML = ''; return; }
  const W = 400, H = 150, max = Math.max(...d.map((p) => Math.max(p.kw, p.sinOptimizarKw))) * 1.15;
  const X = (i) => (i / 119) * W;
  const Y = (v) => H - (v / max) * (H - 6);
  const pts = (campo) => d.map((p, i) => `${X(i).toFixed(1)},${Y(p[campo]).toFixed(1)}`).join(' ');
  let s = '';
  for (let k = 1; k <= 3; k++) s += `<line x1="0" x2="${W}" y1="${(H / 4) * k}" y2="${(H / 4) * k}" stroke="var(--tenue)" vector-effect="non-scaling-stroke"/>`;
  s += `<polygon points="0,${H} ${pts('kw')} ${X(d.length - 1)},${H}" fill="var(--acento)" fill-opacity="0.12"/>`;
  s += `<polyline points="${pts('sinOptimizarKw')}" fill="none" stroke="var(--suave)" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>`;
  s += `<polyline points="${pts('kw')}" fill="none" stroke="var(--acento)" stroke-width="2.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  svg.innerHTML = s;
}

function pintarZonas(e) {
  const mo = e.movilidad;
  if (!mo) { $('zonas').innerHTML = '<p class="vacio">Servicio de movilidad reiniciando… (los demás siguen funcionando)</p>'; return; }
  $('zonas').innerHTML = mo.zonas.map((z) => {
    const ancho = Math.min(100, ((z.vehiculosMin ?? 0) / 60) * 100);
    return `<div class="zona"><span class="nom">${esc(z.nombre)}</span>
      <div class="barra-vel" title="${num(z.vehiculosMin, 1)} vehículos/min"><i style="width:${ancho}%;background:${colorCongestion[z.congestion] || 'var(--borde)'}"></i></div>
      <span class="vel">${num(z.velocidadKmh)} km/h</span><span class="verde" title="Tiempo de verde">${z.verdeSeg ? z.verdeSeg + ' s' : '—'}</span></div>`;
  }).join('');
}

function pintarRecoleccion(re) {
  const btn = $('btn-despachar');
  if (!re) { $('ruta').innerHTML = '<p class="vacio">Servicio de residuos reiniciando…</p>'; btn.disabled = true; return; }
  const enRuta = re.camionEnRuta;
  btn.disabled = enRuta;
  btn.textContent = enRuta ? 'Camión en ruta…' : 'Enviar camión';
  $('camion').textContent = enRuta ? 'En ruta' : 'En el depósito';
  $('camion').className = enRuta ? 'etiqueta activa' : 'etiqueta';
  const r = re.ultimaRuta;
  $('ruta').innerHTML = r
    ? `<div class="cifras"><div><b>${num(r.km, 1)} km</b><span>ruta inteligente</span></div><div><b>${num(r.kmRutaFija, 1)} km</b><span>ruta fija de siempre</span></div></div>
       <p class="texto-suave">Última salida ${esc(r.hora)}: ${r.contenedores.length} contenedores, ${Math.round((1 - r.km / r.kmRutaFija) * 100)} % menos recorrido.</p>`
    : `<p class="texto-suave">Aún no ha salido. El camión sale solo cuando 5 contenedores pasan del ${re.umbral} %, y solo visita esos.</p>`;
}

function pintarAlertas(e) {
  const todas = [...(e.energia?.alertas || []), ...(e.movilidad?.alertas || []), ...(e.residuos?.alertas || [])]
    .sort((a, b) => (a.hora < b.hora ? 1 : -1)).slice(0, 4);
  $('alertas').innerHTML = todas.length
    ? todas.map((a) => `<li class="${a.nivel}"><span class="h">${esc(a.hora)}</span><span>${esc(a.texto)}</span></li>`).join('')
    : '<li class="vacio">Sin alertas</li>';
}

function pintarFlujo(e) {
  const salud = Object.fromEntries(e.salud.map((s) => [s.nodo, s.ok]));
  const nodo = (n, clase = '') => `<span class="nodo ${salud[n] ? clase : 'caido'}">${NOMBRES[n]}</span>`;
  const edge = (n) => {
    const x = e.edges.find((y) => y.nodo === n);
    return nodo(n, x && !x.enLinea ? 'local' : '');
  };
  const lecturas = e.edges.reduce((s, x) => s + x.stats.lecturasRecibidas, 0);
  const filtrado = e.edges.length ? e.edges.reduce((s, x) => s + x.reduccionDatos, 0) / e.edges.length : 0;
  const offline = e.edges.filter((x) => !x.enLinea);
  const pasos = [
    ['1 · Sensores', 'Miden la ciudad', `${num(lecturas)} lecturas enviadas`, '<span class="nodo">56 sensores</span>'],
    ['2 · Edge', 'Filtran cerca de la fuente', offline.length ? `${offline.map((x) => NOMBRES[x.nodo]).join(', ')} sin Internet: guarda ${offline.reduce((s, x) => s + x.enBuffer, 0)} datos` : `${num(filtrado * 100)} % menos datos a la nube`, edge('edge-norte') + edge('edge-sur')],
    ['3 · Bus de eventos', 'Reparte los mensajes', e.broker ? `${num(e.broker.conteo.publicados)} mensajes` : 'reiniciando…', nodo('broker')],
    ['4 · Microservicios', 'Analizan y deciden (IA)', 'uno por tema', nodo('energia') + nodo('movilidad') + nodo('residuos')],
    ['5 · Este tablero', 'Muestra los resultados', 'se actualiza cada segundo', nodo('gateway')],
  ];
  $('flujo').innerHTML = pasos.map(([n, t, d, nodos]) => `<li class="paso"><span class="n">${n}</span><b>${t}</b><span class="dato">${esc(d)}</span><div class="nodos">${nodos}</div></li>`).join('');
  $('bus').textContent = 'Cada recuadro corre como un programa independiente';
}

// ---- Acciones ----
function aviso(t) {
  const a = $('aviso');
  a.textContent = t;
  a.classList.add('ver');
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => a.classList.remove('ver'), 3500);
}
async function post(ruta, cuerpo) {
  const r = await fetch(ruta, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo || {}) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
function bloquear(btn, ms) {
  btn.disabled = true;
  setTimeout(() => (btn.disabled = false), ms);
}
$('btn-despachar').onclick = async () => {
  try {
    const r = await post('/api/residuos/despachar');
    aviso(r.ok ? `Camión enviado: ${r.ruta.contenedores.length} contenedores, ${r.ruta.km} km` : 'No hay contenedores llenos todavía');
  } catch { aviso('No se pudo contactar al servicio de residuos'); }
  actualizar();
};
$('btn-desconectar').onclick = async (ev) => {
  const btn = ev.currentTarget;
  try {
    await post('/api/simular/desconexion-edge', { nodo: 'edge-norte', segundos: 20 });
    aviso('Edge Norte sin Internet por 20 s. Mira el paso 2 abajo.');
    bloquear(btn, 20000);
  } catch { aviso('No se pudo contactar al Edge Norte'); }
  actualizar();
};
$('btn-caida').onclick = async (ev) => {
  const btn = ev.currentTarget;
  try {
    await post('/api/simular/caida-servicio', { nodo: 'movilidad' });
    aviso('Movilidad caída. Se reinicia sola en unos segundos.');
    bloquear(btn, 5000);
  } catch { aviso('No se pudo simular la caída'); }
  setTimeout(actualizar, 300);
};

actualizar();
setInterval(actualizar, 1000);
