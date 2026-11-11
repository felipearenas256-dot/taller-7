// Bus de eventos publicar/suscribir (cumple el papel de MQTT/Kafka en la arquitectura).
// Desacopla a los nodos Edge (productores) de los microservicios (consumidores).
const { crearServicio, enviar, log } = require('../lib/comun');

const suscriptores = new Map(); // topico -> Map(destino -> nodo)
const ultimos = []; // últimos eventos para el dashboard
const conteo = { publicados: 0, entregados: 0, fallidos: 0, porTopico: {} };

crearServicio('broker', {
  'POST /subscribe': ({ topico, destino, nodo }) => {
    if (!suscriptores.has(topico)) suscriptores.set(topico, new Map());
    suscriptores.get(topico).set(destino, nodo);
    return { ok: true };
  },

  'POST /publish': async (evento) => {
    conteo.publicados++;
    conteo.porTopico[evento.topico] = (conteo.porTopico[evento.topico] || 0) + 1;
    ultimos.unshift({ topico: evento.topico, origen: evento.origen, ts: evento.ts });
    ultimos.length = Math.min(ultimos.length, 30);
    const destinos = [...(suscriptores.get(evento.topico) || new Map()).keys()];
    // Entrega en paralelo; un consumidor caído no bloquea a los demás.
    const r = await Promise.allSettled(destinos.map((d) => enviar(d, evento, 1000)));
    for (const x of r) x.status === 'fulfilled' ? conteo.entregados++ : conteo.fallidos++;
    return { entregadoA: r.filter((x) => x.status === 'fulfilled').length };
  },

  'GET /estado': () => ({
    conteo,
    topicos: Object.fromEntries([...suscriptores].map(([t, m]) => [t, [...m.values()]])),
    ultimos,
  }),
});

log('broker', 'Bus de eventos listo');
