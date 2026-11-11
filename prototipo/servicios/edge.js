// Capa 2 · Nodo Edge Computing (uno por sector de la ciudad).
// - Recibe lecturas crudas de los sensores de sus zonas.
// - Filtra lecturas inválidas y agrega por ventana (solo envía resúmenes a la nube).
// - Ejecuta control local: atenúa el alumbrado cuando no hay tráfico de noche.
// - Si pierde la conexión con la nube, sigue operando y guarda los resúmenes (store & forward).
const { ZONAS, url, crearServicio, suscribir, publicar, esDeNoche, horaSim, etiquetaHora, log } = require('../lib/comun');

const NODO = process.argv[2] || 'edge-norte';
const MIS_ZONAS = ZONAS.filter((z) => z.edge === NODO);
const VENTANA_MS = 3000;
const UMBRAL_TRAFICO_NOCHE = 8; // veh/min por sensor por debajo del cual se atenúa
const NIVEL_ATENUADO = 0.4;

const ventana = {}; // zona -> lecturas válidas acumuladas
const nivelLuz = Object.fromEntries(MIS_ZONAS.map((z) => [z.id, 1]));
const comandosPendientes = Object.fromEntries(MIS_ZONAS.map((z) => [z.id, []]));
const bufferSinConexion = [];
let desconectadoHasta = 0;
const stats = { lecturasRecibidas: 0, lecturasInvalidas: 0, bytesRecibidos: 0, bytesEnviados: 0, resumenesEnviados: 0, decisionesLocales: 0 };

const LIMITES = { energia: [0, 2000], alumbrado: [0, 100], trafico: [0, 300], velocidad: [0, 150], llenado: [0, 100] };
const valida = (l) => typeof l.valor === 'number' && Number.isFinite(l.valor) && l.valor >= LIMITES[l.tipo][0] && l.valor <= LIMITES[l.tipo][1];
const enLinea = () => Date.now() >= desconectadoHasta;

crearServicio(NODO, {
  'POST /ingest': (msg, req) => {
    stats.bytesRecibidos += Number(req.headers['content-length'] || 0);
    const zona = MIS_ZONAS.find((z) => z.id === msg.zona);
    if (!zona) return { comandos: [] };
    const buenas = [];
    for (const l of msg.lecturas || []) {
      stats.lecturasRecibidas++;
      valida(l) ? buenas.push(l) : stats.lecturasInvalidas++;
    }
    (ventana[zona.id] ||= []).push(...buenas);

    // Control local inmediato (no depende de la nube)
    const trafico = buenas.filter((l) => l.tipo === 'trafico');
    const promedio = trafico.reduce((s, l) => s + l.valor, 0) / (trafico.length || 1);
    const nuevo = esDeNoche() && promedio < UMBRAL_TRAFICO_NOCHE ? NIVEL_ATENUADO : 1;
    if (nuevo !== nivelLuz[zona.id]) {
      nivelLuz[zona.id] = nuevo;
      stats.decisionesLocales++;
      log(NODO, `${zona.nombre} ${etiquetaHora()}: alumbrado al ${nuevo * 100}% (tráfico ${promedio.toFixed(1)} veh/min)`);
    }
    const comandos = [{ accion: 'nivel-luz', nivel: nivelLuz[zona.id] }, ...comandosPendientes[zona.id]];
    comandosPendientes[zona.id] = [];
    return { comandos };
  },

  // Órdenes que llegan desde la nube por el bus (p. ej. ruta de recolección)
  'POST /evento': (evento) => {
    const d = evento.datos;
    if (evento.topico === 'control' && d.accion === 'vaciar') {
      for (const z of MIS_ZONAS) {
        const ids = d.contenedores.filter((id) => id.startsWith(z.id + '-'));
        if (ids.length) comandosPendientes[z.id].push({ accion: 'vaciar', contenedores: ids });
      }
    }
  },

  'POST /simular-desconexion': ({ segundos = 20 }) => {
    desconectadoHasta = Date.now() + segundos * 1000;
    log(NODO, `Sin conexión a la nube durante ${segundos}s: opera en modo local`);
    return { ok: true, hasta: desconectadoHasta };
  },

  'GET /estado': () => ({
    nodo: NODO,
    zonas: MIS_ZONAS.map((z) => ({ id: z.id, nombre: z.nombre, nivelLuz: nivelLuz[z.id] })),
    enLinea: enLinea(),
    segundosSinConexion: Math.max(0, Math.ceil((desconectadoHasta - Date.now()) / 1000)),
    enBuffer: bufferSinConexion.length,
    stats,
    reduccionDatos: stats.bytesRecibidos ? 1 - stats.bytesEnviados / stats.bytesRecibidos : 0,
  }),
});

const prom = (arr) => (arr.length ? arr.reduce((s, l) => s + l.valor, 0) / arr.length : 0);
const suma = (arr) => arr.reduce((s, l) => s + l.valor, 0);

function resumir(zona) {
  const ls = ventana[zona.id] || [];
  ventana[zona.id] = [];
  if (!ls.length) return [];
  const de = (t) => ls.filter((l) => l.tipo === t);
  // edificiosKw = suma de los 5 medidores, promediada entre los mensajes de la ventana
  const muestras = Math.max(1, de('energia').length / 5);
  const ultimoLlenado = {};
  for (const l of de('llenado')) ultimoLlenado[l.id] = +l.valor.toFixed(1);
  const base = esDeNoche() ? zona.luminarias * 0.1 : 0;
  const ts = Date.now();
  const hora = horaSim();
  return [
    ['energia', { zona: zona.id, hora, edificiosKw: +(suma(de('energia')) / muestras).toFixed(1), alumbradoKw: +prom(de('alumbrado')).toFixed(2), alumbradoBaseKw: base, nivelLuz: nivelLuz[zona.id] }],
    ['movilidad', { zona: zona.id, hora, vehiculosMin: +prom(de('trafico')).toFixed(1), velocidadKmh: +prom(de('velocidad')).toFixed(1) }],
    ['residuos', { zona: zona.id, hora, llenado: ultimoLlenado }],
  ].map(([topico, datos]) => ({ topico, datos, ts }));
}

async function enviarResumenes() {
  const nuevos = MIS_ZONAS.flatMap(resumir);
  if (!enLinea()) {
    bufferSinConexion.push(...nuevos);
    if (bufferSinConexion.length > 600) bufferSinConexion.splice(0, bufferSinConexion.length - 600);
    return;
  }
  const cola = bufferSinConexion.splice(0).concat(nuevos);
  if (cola.length > nuevos.length) log(NODO, `Conexión recuperada: sincronizando ${cola.length - nuevos.length} resúmenes guardados`);
  for (let i = 0; i < cola.length; i++) {
    const r = cola[i];
    try {
      await publicar(r.topico, NODO, r.datos);
      stats.bytesEnviados += Buffer.byteLength(JSON.stringify(r));
      stats.resumenesEnviados++;
    } catch {
      bufferSinConexion.push(...cola.slice(i)); // broker caído: se guarda y se reintenta
      return;
    }
  }
}

setInterval(enviarResumenes, VENTANA_MS);
suscribir(NODO, ['control']);
log(NODO, `Atiende zonas: ${MIS_ZONAS.map((z) => z.nombre).join(', ')}`);
