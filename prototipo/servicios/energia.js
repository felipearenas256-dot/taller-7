// Capa 4 · Microservicio de Energía.
// Consume los resúmenes del Edge, calcula el ahorro del alumbrado inteligente y predice la demanda.
const { ZONAS, crearServicio, suscribir, minutosSim, etiquetaHora, FACTOR_CO2_RED, MIN_POR_SEG, log } = require('../lib/comun');

const HORAS_POR_RESUMEN = (3 * MIN_POR_SEG) / 60; // ventana del Edge (3 s reales) en horas simuladas
const ultimo = {}; // zona -> último resumen
const serie = []; // puntos para la gráfica
const alertas = [];
let kwhAhorrados = 0;
let kwhConsumidos = 0;

// Modelo predictivo sencillo: promedio exponencial por hora del día (aprende el perfil diario)
// con respaldo de tendencia lineal (Holt) mientras no tenga datos de esa hora.
const perfil = new Array(24).fill(null);
let nivel = null, tendencia = 0;
function aprender(hora, valor) {
  const b = Math.floor(hora) % 24;
  perfil[b] = perfil[b] === null ? valor : 0.7 * perfil[b] + 0.3 * valor;
  if (nivel === null) nivel = valor;
  const anterior = nivel;
  nivel = 0.5 * valor + 0.5 * (nivel + tendencia);
  tendencia = 0.3 * (nivel - anterior) + 0.7 * tendencia;
}
function predecir(minutosAdelante) {
  const h = ((minutosSim() + minutosAdelante) / 60) % 24;
  const b = Math.floor(h);
  if (perfil[b] !== null) return perfil[b];
  return nivel === null ? null : nivel + tendencia * (minutosAdelante / (3 * MIN_POR_SEG));
}

crearServicio('energia', {
  'POST /evento': ({ datos }) => {
    ultimo[datos.zona] = datos;
    kwhAhorrados += Math.max(0, datos.alumbradoBaseKw - datos.alumbradoKw) * HORAS_POR_RESUMEN;
    kwhConsumidos += (datos.edificiosKw + datos.alumbradoKw) * HORAS_POR_RESUMEN;
    if (datos.edificiosKw > 600) alerta(`Consumo anómalo en ${nombreZona(datos.zona)}: ${datos.edificiosKw} kW`);
  },
  'GET /estado': () => ({
    zonas: ZONAS.map((z) => ultimo[z.id] || { zona: z.id }),
    totalKw: +total().toFixed(1),
    serie,
    prediccion: [15, 30, 60, 120].map((m) => ({ enMin: m, kw: predecir(m) === null ? null : +predecir(m).toFixed(1) })),
    kwhAhorrados: +kwhAhorrados.toFixed(1),
    kwhConsumidos: +kwhConsumidos.toFixed(1),
    co2EvitadoKg: +(kwhAhorrados * FACTOR_CO2_RED).toFixed(1),
    alertas,
  }),
});

const nombreZona = (id) => ZONAS.find((z) => z.id === id)?.nombre || id;
function alerta(texto) {
  if (alertas[0]?.texto === texto) return;
  alertas.unshift({ hora: etiquetaHora(), texto, nivel: 'alta' });
  alertas.length = Math.min(alertas.length, 15);
}
function total(campo = null) {
  return Object.values(ultimo).reduce((s, d) => s + (campo ? d[campo] : d.edificiosKw + d.alumbradoKw), 0);
}

// Cada 3 s se toma una muestra de toda la ciudad para la serie de tiempo.
setInterval(() => {
  if (Object.keys(ultimo).length < ZONAS.length) return;
  const real = total();
  const sinOptimizar = total('edificiosKw') + total('alumbradoBaseKw');
  const prevista = predecir(0);
  aprender(minutosSim() / 60, real);
  serie.push({ hora: etiquetaHora(), kw: +real.toFixed(1), sinOptimizarKw: +sinOptimizar.toFixed(1), previstoKw: prevista === null ? null : +prevista.toFixed(1) });
  if (serie.length > 120) serie.shift();
}, 3000);

suscribir('energia', ['energia']);
log('energia', 'Microservicio de energía listo');
