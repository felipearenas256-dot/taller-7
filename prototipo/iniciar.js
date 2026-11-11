// Lanzador local: arranca cada nodo como un proceso independiente y, como lo haría Kubernetes,
// reinicia automáticamente cualquier proceso que falle.
const { fork } = require('child_process');
const path = require('path');

process.env.SIM_T0 = String(Date.now()); // reloj simulado común para todos los nodos

const NODOS = [
  ['broker', 'broker.js'],
  ['energia', 'energia.js'],
  ['movilidad', 'movilidad.js'],
  ['residuos', 'residuos.js'],
  ['edge-norte', 'edge.js', ['edge-norte']],
  ['edge-sur', 'edge.js', ['edge-sur']],
  ['gateway', 'gateway.js'],
  ['sensores', 'sensores.js'],
];

const procesos = new Map();
let cerrando = false;

function arrancar([nombre, archivo, args = []]) {
  const p = fork(path.join(__dirname, 'servicios', archivo), args, { env: process.env });
  procesos.set(nombre, p);
  p.on('exit', (codigo) => {
    if (cerrando) return;
    console.log(`[lanzador] ${nombre} terminó (código ${codigo}). Reiniciando en 2 s...`);
    setTimeout(() => arrancar([nombre, archivo, args]), 2000);
  });
}

NODOS.forEach((n, i) => setTimeout(() => arrancar(n), i * 150));

function cerrar() {
  cerrando = true;
  for (const p of procesos.values()) p.kill();
  process.exit(0);
}
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
