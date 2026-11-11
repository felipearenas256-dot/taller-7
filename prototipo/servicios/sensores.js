// Capa 1 · Dispositivos IoT simulados.
// Cada segundo, cada zona envía sus lecturas crudas a su nodo Edge y recibe órdenes de control
// en la respuesta (nivel de las luminarias, contenedores recolectados).
const { ZONAS, CONTENEDORES, url, enviar, horaSim, esDeNoche, log } = require('../lib/comun');

const nivelLuz = Object.fromEntries(ZONAS.map((z) => [z.id, 1]));
const llenado = Object.fromEntries(CONTENEDORES.map((c) => [c.id, 10 + Math.random() * 55]));
const ritmo = Object.fromEntries(CONTENEDORES.map((c) => [c.id, 0.12 + Math.random() * 0.4]));
const caidos = new Set();

const ruido = (v, p = 0.08) => v * (1 + (Math.random() * 2 - 1) * p);

// Perfil de tráfico (vehículos/min por sensor) según la hora: picos 7 a. m. y 6 p. m.
function trafico(h, zona) {
  const pico = Math.exp(-((h - 7.5) ** 2) / 2) + 1.1 * Math.exp(-((h - 18) ** 2) / 2.5);
  const base = h >= 23 || h < 5 ? 1.5 : 10;
  const f = zona.id === 'z1' ? 1.4 : zona.id === 'z4' ? 0.7 : 1;
  return Math.max(0, (base + 38 * pico) * f);
}
// Consumo de edificios y semáforos (kW) según la hora.
function consumo(h, zona) {
  const dia = h >= 7 && h < 19 ? 1 : 0.55;
  const f = zona.id === 'z4' ? 2.1 : zona.id === 'z1' ? 1.5 : 1;
  return 180 * dia * f;
}

async function ciclo(zona) {
  const h = horaSim();
  const lecturas = [];
  // Medidores de energía (5 por zona)
  for (let i = 1; i <= 5; i++) lecturas.push({ tipo: 'energia', id: `${zona.id}-m${i}`, valor: ruido(consumo(h, zona) / 5) });
  // Alumbrado público: consume solo de noche, según el nivel que ordene el Edge
  const kwLuz = esDeNoche(h) ? zona.luminarias * 0.1 * nivelLuz[zona.id] : 0;
  lecturas.push({ tipo: 'alumbrado', id: `${zona.id}-lum`, valor: ruido(kwLuz, 0.02), nivel: nivelLuz[zona.id] });
  // Sensores de tráfico (3 por zona)
  for (let i = 1; i <= 3; i++) {
    const v = ruido(trafico(h, zona), 0.2);
    lecturas.push({ tipo: 'trafico', id: `${zona.id}-t${i}`, valor: v });
    lecturas.push({ tipo: 'velocidad', id: `${zona.id}-t${i}`, valor: Math.max(5, 55 - v * 0.75 + (Math.random() * 6 - 3)) });
  }
  // Contenedores de residuos
  for (const c of CONTENEDORES.filter((c) => c.zona === zona.id)) {
    llenado[c.id] = Math.min(100, llenado[c.id] + ritmo[c.id] * (h >= 6 && h < 22 ? 1 : 0.3));
    lecturas.push({ tipo: 'llenado', id: c.id, valor: llenado[c.id] });
  }
  // ~3 % de lecturas defectuosas, para que el Edge las filtre
  for (const l of lecturas) if (Math.random() < 0.03) l.valor = Math.random() < 0.5 ? -999 : null;

  try {
    const r = await enviar(url(zona.edge, '/ingest'), { zona: zona.id, ts: Date.now(), lecturas }, 800);
    if (caidos.has(zona.edge)) {
      caidos.delete(zona.edge);
      log('sensores', `${zona.edge} volvió a responder`);
    }
    for (const cmd of r.comandos || []) {
      if (cmd.accion === 'nivel-luz') nivelLuz[zona.id] = cmd.nivel;
      if (cmd.accion === 'vaciar') for (const id of cmd.contenedores) if (id in llenado) llenado[id] = 2 + Math.random() * 6;
    }
  } catch {
    if (!caidos.has(zona.edge)) {
      caidos.add(zona.edge);
      log('sensores', `No se pudo contactar a ${zona.edge}; se reintentará`);
    }
  }
}

setInterval(() => ZONAS.forEach(ciclo), 1000);
log('sensores', `Simulando ${ZONAS.length} zonas, ${CONTENEDORES.length} contenedores, ${ZONAS.length * 5} medidores y ${ZONAS.length * 3} sensores de tráfico`);
