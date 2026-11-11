// Capa 4 · Microservicio de Residuos.
// Sigue el llenado de los contenedores y, cuando hace falta, calcula una ruta optimizada
// que solo visita los contenedores llenos. La orden de vaciado viaja por el bus hasta el Edge.
const { CONTENEDORES, DEPOSITO, crearServicio, suscribir, publicar, etiquetaHora, distancia, FACTOR_CO2_CAMION, log } = require('../lib/comun');

const UMBRAL = 75; // % a partir del cual un contenedor entra en la ruta
const MIN_PARA_DESPACHO = 5;
const ENFRIAMIENTO_MS = 20000; // tiempo que tarda el camión en hacer la ruta

const llenado = {};
const alertas = [];
const historialRutas = [];
let ultimaRuta = null;
let ultimoDespacho = 0;
let kmAhorrados = 0;
let kmRecorridos = 0;

// Ruta por vecino más cercano desde el depósito y de regreso.
function planear(puntos) {
  const pendientes = [...puntos];
  const orden = [];
  let actual = DEPOSITO, km = 0;
  while (pendientes.length) {
    pendientes.sort((a, b) => distancia(actual, a) - distancia(actual, b));
    const sig = pendientes.shift();
    km += distancia(actual, sig);
    orden.push(sig);
    actual = sig;
  }
  km += distancia(actual, DEPOSITO);
  return { orden, km };
}
// Línea base: ruta fija tradicional que pasa por todos los contenedores.
const KM_RUTA_FIJA = planear(CONTENEDORES).km;

async function despachar(motivo) {
  const llenos = CONTENEDORES.filter((c) => (llenado[c.id] ?? 0) >= UMBRAL);
  if (!llenos.length) return { ok: false, motivo: 'No hay contenedores sobre el umbral' };
  const { orden, km } = planear(llenos);
  ultimoDespacho = Date.now();
  kmRecorridos += km;
  kmAhorrados += Math.max(0, KM_RUTA_FIJA - km);
  ultimaRuta = { hora: etiquetaHora(), motivo, contenedores: orden.map((c) => c.id), km: +km.toFixed(1), kmRutaFija: +KM_RUTA_FIJA.toFixed(1) };
  historialRutas.unshift(ultimaRuta);
  historialRutas.length = Math.min(historialRutas.length, 8);
  log('residuos', `Ruta despachada (${motivo}): ${orden.length} contenedores, ${km.toFixed(1)} km vs ${KM_RUTA_FIJA.toFixed(1)} km de ruta fija`);
  try {
    await publicar('control', 'residuos', { accion: 'vaciar', contenedores: ultimaRuta.contenedores });
  } catch (e) {
    log('residuos', 'No se pudo publicar la orden:', e.message);
  }
  return { ok: true, ruta: ultimaRuta };
}

crearServicio('residuos', {
  'POST /evento': ({ datos }) => {
    for (const [id, v] of Object.entries(datos.llenado)) {
      if (v >= 95 && (llenado[id] ?? 0) < 95) {
        alertas.unshift({ hora: etiquetaHora(), texto: `Contenedor ${id} al ${v.toFixed(0)}%: riesgo de desborde`, nivel: 'alta' });
        alertas.length = Math.min(alertas.length, 15);
      }
      llenado[id] = v;
    }
  },
  'POST /despachar': () => despachar('manual'),
  'GET /estado': () => ({
    contenedores: CONTENEDORES.map((c) => ({ ...c, llenado: llenado[c.id] ?? null })),
    deposito: DEPOSITO,
    umbral: UMBRAL,
    camionEnRuta: Date.now() - ultimoDespacho < ENFRIAMIENTO_MS,
    ultimaRuta,
    historialRutas,
    kmRutaFija: +KM_RUTA_FIJA.toFixed(1),
    kmRecorridos: +kmRecorridos.toFixed(1),
    kmAhorrados: +kmAhorrados.toFixed(1),
    co2EvitadoKg: +(kmAhorrados * FACTOR_CO2_CAMION).toFixed(1),
    alertas,
  }),
});

// Decisión automática cada 2 s
setInterval(() => {
  if (Date.now() - ultimoDespacho < ENFRIAMIENTO_MS) return;
  const valores = Object.values(llenado);
  const llenos = valores.filter((v) => v >= UMBRAL).length;
  if (llenos >= MIN_PARA_DESPACHO) despachar(`${llenos} contenedores sobre ${UMBRAL}%`);
  else if (valores.some((v) => v >= 97)) despachar('riesgo de desborde');
}, 2000);

suscribir('residuos', ['residuos']);
log('residuos', `Microservicio de residuos listo (ruta fija de referencia: ${KM_RUTA_FIJA.toFixed(1)} km)`);
