// Capa 4/5 · API Gateway: punto único de entrada para el dashboard.
// Sirve la interfaz web, consulta a los microservicios y revisa la salud de cada nodo.
const fs = require('fs');
const path = require('path');
const { PUERTOS, url, obtener, enviar, crearServicio, etiquetaHora, horaSim, esDeNoche, log } = require('../lib/comun');

const PUBLICO = path.join(__dirname, '..', 'public');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const NODOS = Object.keys(PUERTOS).filter((n) => n !== 'gateway');

function estatico(archivo) {
  return (_c, _req, res) => {
    const ruta = path.join(PUBLICO, archivo);
    res.writeHead(200, { 'content-type': TIPOS[path.extname(ruta)] || 'text/plain', 'cache-control': 'no-store' });
    fs.createReadStream(ruta).pipe(res);
  };
}
const seguro = (p) => p.then((v) => v, () => null);

crearServicio('gateway', {
  'GET /': estatico('index.html'),
  'GET /app.js': estatico('app.js'),
  'GET /estilos.css': estatico('estilos.css'),

  'GET /api/estado': async () => {
    const [salud, energia, movilidad, residuos, norte, sur, broker] = await Promise.all([
      Promise.all(NODOS.map(async (n) => {
        const t = Date.now();
        const r = await seguro(obtener(url(n, '/health'), 600));
        return { nodo: n, ok: !!r, ms: r ? Date.now() - t : null, activoSeg: r?.activoSeg ?? null };
      })),
      seguro(obtener(url('energia', '/estado'))),
      seguro(obtener(url('movilidad', '/estado'))),
      seguro(obtener(url('residuos', '/estado'))),
      seguro(obtener(url('edge-norte', '/estado'))),
      seguro(obtener(url('edge-sur', '/estado'))),
      seguro(obtener(url('broker', '/estado'))),
    ]);
    return {
      reloj: { hora: etiquetaHora(), noche: esDeNoche(horaSim()) },
      salud: [{ nodo: 'gateway', ok: true, ms: 0, activoSeg: Math.round(process.uptime()) }, ...salud],
      energia, movilidad, residuos, edges: [norte, sur].filter(Boolean), broker,
    };
  },

  // ---- Simulaciones para la demostración ----
  'POST /api/simular/desconexion-edge': ({ nodo = 'edge-norte', segundos = 20 }) =>
    enviar(url(nodo, '/simular-desconexion'), { segundos }),
  'POST /api/simular/caida-servicio': ({ nodo }) => {
    if (!['energia', 'movilidad', 'residuos'].includes(nodo)) throw new Error('nodo no permitido');
    return enviar(url(nodo, '/crash'), {});
  },
  'POST /api/residuos/despachar': () => enviar(url('residuos', '/despachar'), {}),
});

log('gateway', `Dashboard disponible en http://localhost:${PUERTOS.gateway}`);
