// Capa 4 · Microservicio de Movilidad.
// Calcula el nivel de congestión por zona y recomienda el tiempo de verde de los semáforos.
const { ZONAS, crearServicio, suscribir, etiquetaHora, log } = require('../lib/comun');

const ultimo = {};
const historial = {}; // zona -> últimos valores de velocidad
const alertas = [];

function congestion(v) {
  if (v < 20) return 'alta';
  if (v < 32) return 'media';
  return 'baja';
}
// Regla de optimización: más vehículos en espera -> más tiempo de verde (entre 20 y 90 s).
const verdeRecomendado = (vehMin) => Math.round(Math.min(90, Math.max(20, 18 + vehMin * 1.3)));

crearServicio('movilidad', {
  'POST /evento': ({ datos }) => {
    const nivel = congestion(datos.velocidadKmh);
    const antes = ultimo[datos.zona]?.congestion;
    ultimo[datos.zona] = { ...datos, congestion: nivel, verdeSeg: verdeRecomendado(datos.vehiculosMin) };
    (historial[datos.zona] ||= []).push(datos.velocidadKmh);
    if (historial[datos.zona].length > 40) historial[datos.zona].shift();
    if (nivel === 'alta' && antes !== 'alta') {
      const z = ZONAS.find((x) => x.id === datos.zona).nombre;
      alertas.unshift({ hora: etiquetaHora(), texto: `Congestión alta en ${z} (${datos.velocidadKmh} km/h). Verde ajustado a ${verdeRecomendado(datos.vehiculosMin)} s`, nivel: 'media' });
      alertas.length = Math.min(alertas.length, 15);
    }
  },
  'GET /estado': () => ({
    zonas: ZONAS.map((z) => ({ ...(ultimo[z.id] || { zona: z.id }), nombre: z.nombre, historial: historial[z.id] || [] })),
    vehiculosMinCiudad: +Object.values(ultimo).reduce((s, d) => s + d.vehiculosMin * 3, 0).toFixed(0),
    alertas,
  }),
});

suscribir('movilidad', ['movilidad']);
log('movilidad', 'Microservicio de movilidad listo');
