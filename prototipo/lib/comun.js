// Utilidades compartidas por todos los nodos del sistema distribuido (sin dependencias externas).
const http = require('http');

// ---------- Configuración de red (cada nodo es un proceso independiente) ----------
const HOST = process.env.HOST_SERVICIOS || '127.0.0.1';
const PUERTOS = {
  gateway: 7100,
  broker: 7101,
  energia: 7102,
  movilidad: 7103,
  residuos: 7104,
  'edge-norte': 7111,
  'edge-sur': 7112,
};
// En Docker cada servicio tiene su propio hostname; en local todo es 127.0.0.1.
const url = (nodo, ruta = '') =>
  `http://${process.env.EN_DOCKER ? nodo : HOST}:${PUERTOS[nodo]}${ruta}`;

// ---------- Ciudad simulada ----------
const ZONAS = [
  { id: 'z1', nombre: 'Centro', edge: 'edge-norte', x: 0, y: 0, luminarias: 140 },
  { id: 'z2', nombre: 'Norte', edge: 'edge-norte', x: 1, y: 0, luminarias: 110 },
  { id: 'z3', nombre: 'Sur', edge: 'edge-sur', x: 0, y: 1, luminarias: 120 },
  { id: 'z4', nombre: 'Industrial', edge: 'edge-sur', x: 1, y: 1, luminarias: 90 },
];

// Generador pseudoaleatorio determinista: todos los procesos ven los mismos contenedores.
function semilla(s) {
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const CONTENEDORES = (() => {
  const r = semilla(42);
  const lista = [];
  for (const z of ZONAS) {
    for (let i = 1; i <= 6; i++) {
      // coordenadas en km dentro de una ciudad de 10 x 10 km (separados al menos 0,8 km)
      let p;
      do {
        p = { x: +(z.x * 5 + 0.6 + r() * 3.8).toFixed(2), y: +(z.y * 5 + 1.5 + r() * 3.0).toFixed(2) };
      } while (lista.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < 0.8));
      lista.push({ id: `${z.id}-c${i}`, zona: z.id, ...p });
    }
  }
  return lista;
})();
const DEPOSITO = { x: 5, y: 5 };

// ---------- Reloj simulado compartido: 1 s real = 2 min en la ciudad ----------
const T0 = Number(process.env.SIM_T0 || Date.now());
const MIN_POR_SEG = 2;
const HORA_INICIAL = 16; // la simulación arranca a las 4 p. m. para ver el anochecer pronto
function minutosSim() {
  return HORA_INICIAL * 60 + ((Date.now() - T0) / 1000) * MIN_POR_SEG;
}
function horaSim() {
  return (minutosSim() / 60) % 24;
}
function etiquetaHora(min = minutosSim()) {
  const h = Math.floor((min / 60) % 24);
  const m = Math.floor(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
const esDeNoche = (h = horaSim()) => h >= 18 || h < 6;

// Factor de emisión aproximado de la red eléctrica colombiana (kg CO2 / kWh).
const FACTOR_CO2_RED = 0.126;
// Emisión aproximada de un camión recolector diésel (kg CO2 / km).
const FACTOR_CO2_CAMION = 0.9;

// ---------- HTTP mínimo ----------
function pedir(metodo, destino, cuerpo, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    const req = http.request(
      destino,
      {
        method: metodo,
        timeout,
        headers: datos
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(datos) }
          : {},
      },
      (res) => {
        let t = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (t += c));
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
          try {
            resolve(t ? JSON.parse(t) : null);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (datos) req.write(datos);
    req.end();
  });
}
const obtener = (destino, timeout) => pedir('GET', destino, undefined, timeout);
const enviar = (destino, cuerpo, timeout) => pedir('POST', destino, cuerpo, timeout);

function leerCuerpo(req) {
  return new Promise((resolve) => {
    let t = '';
    req.on('data', (c) => (t += c));
    req.on('end', () => {
      try {
        resolve(t ? JSON.parse(t) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function json(res, codigo, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' });
  res.end(s);
}

// Crea un servidor con rutas { 'GET /ruta': handler } y /health incluido.
function crearServicio(nombre, rutas) {
  const inicio = Date.now();
  const servidor = http.createServer(async (req, res) => {
    const ruta = req.url.split('?')[0];
    const clave = `${req.method} ${ruta}`;
    if (clave === 'GET /health') {
      return json(res, 200, { nodo: nombre, ok: true, activoSeg: Math.round((Date.now() - inicio) / 1000) });
    }
    if (clave === 'POST /crash') {
      json(res, 200, { ok: true });
      log(nombre, 'Falla simulada: el proceso se detiene');
      return setTimeout(() => process.exit(1), 50);
    }
    const h = rutas[clave];
    if (!h) return json(res, 404, { error: 'no encontrado' });
    try {
      const cuerpo = req.method === 'POST' ? await leerCuerpo(req) : undefined;
      const r = await h(cuerpo, req, res);
      if (!res.headersSent) json(res, 200, r === undefined ? { ok: true } : r);
    } catch (e) {
      log(nombre, 'Error:', e.message);
      if (!res.headersSent) json(res, 500, { error: e.message });
    }
  });
  servidor.listen(PUERTOS[nombre], process.env.EN_DOCKER ? '0.0.0.0' : HOST, () =>
    log(nombre, `escuchando en ${url(nombre)}`)
  );
  return servidor;
}

// Suscribe un servicio a tópicos del bus, reintentando hasta que el broker responda.
// La suscripción se renueva cada 5 s: si el broker se reinicia y pierde su tabla, se recupera sola.
async function suscribir(nombre, topicos) {
  const registrar = async () => {
    for (const t of topicos) {
      await enviar(url('broker', '/subscribe'), { topico: t, destino: url(nombre, '/evento'), nodo: nombre });
    }
  };
  for (;;) {
    try {
      await registrar();
      log(nombre, `suscrito a: ${topicos.join(', ')}`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  setInterval(() => registrar().catch(() => {}), 5000);
}

const publicar = (topico, origen, datos) =>
  enviar(url('broker', '/publish'), { topico, origen, datos, ts: Date.now() });

function log(nombre, ...args) {
  console.log(`[${new Date().toLocaleTimeString('es-CO')}] [${nombre}]`, ...args);
}

const distancia = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

module.exports = {
  PUERTOS, url, ZONAS, CONTENEDORES, DEPOSITO,
  minutosSim, horaSim, etiquetaHora, esDeNoche, MIN_POR_SEG,
  FACTOR_CO2_RED, FACTOR_CO2_CAMION,
  obtener, enviar, json, crearServicio, suscribir, publicar, log, distancia,
};
