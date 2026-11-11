# PCII · Prototipo de la Plataforma Ciudad Inteligente Integrada

Prototipo funcional de la arquitectura propuesta en el taller *Tecnologías emergentes y sostenibles en sistemas distribuidos*.
Integra la gestión de **energía, movilidad y residuos** de una ciudad simulada mediante un sistema distribuido de 8 procesos independientes que se comunican por red (HTTP + publicar/suscribir).

No necesita instalar dependencias: solo Node.js 18 o superior.

## Cómo ejecutarlo

```bash
cd prototipo
npm start
```

Luego abre **http://localhost:7100** en el navegador.

Para detenerlo, presiona `Ctrl + C` en la terminal.

### Con contenedores (Docker)

```bash
docker compose up --build
```

Cada nodo corre en su propio contenedor con `restart: always`, el mismo principio que usa Kubernetes.

## Arquitectura (5 capas)

| Capa | Proceso | Puerto | Qué hace |
| --- | --- | --- | --- |
| 1. Dispositivos IoT | `servicios/sensores.js` | — | Simula 20 medidores de energía, alumbrado, 12 sensores de tráfico y 24 contenedores. Envía lecturas cada segundo e incluye ~3 % de lecturas defectuosas. |
| 2. Edge Computing | `servicios/edge.js` (Norte y Sur) | 7111, 7112 | Filtra lecturas inválidas, agrega por ventana de 3 s, atenúa el alumbrado de noche si no hay tráfico (control local) y guarda datos si pierde la nube (*store & forward*). |
| 3. Comunicación | `servicios/broker.js` | 7101 | Bus de eventos publicar/suscribir (papel de MQTT/Kafka). Tópicos: `energia`, `movilidad`, `residuos`, `control`. |
| 4. Servicios distribuidos | `energia.js`, `movilidad.js`, `residuos.js`, `gateway.js` | 7102–7104, 7100 | Microservicios por dominio con IA sencilla: predicción de demanda, tiempo de verde de semáforos y rutas de recolección optimizadas. El API Gateway es la única puerta de entrada. |
| 5. Visualización | `public/` | 7100 | Dashboard web en vivo (se actualiza cada segundo). |

`iniciar.js` actúa como orquestador local: arranca cada nodo como proceso separado y **lo reinicia automáticamente si falla**.

## Qué demostrar en la presentación

1. **Flujo de datos de punta a punta**: el mapa, la gráfica de energía y la tabla de movilidad cambian cada segundo.
2. **Edge Computing**: el indicador “Datos filtrados en el borde” muestra que ~85 % menos datos viajan a la nube.
3. **Sostenibilidad**: de noche (después de las 23:00 simuladas) el Edge baja el alumbrado al 40 % en zonas sin tráfico; el ahorro en kWh y el CO₂ evitado suben.
4. **IA en residuos**: cuando 5 contenedores pasan del 75 %, se calcula una ruta que solo los visita a ellos y se compara con la ruta fija tradicional.
5. **Resiliencia del Edge**: botón *Desconectar 20 s*. El nodo sigue operando en local, acumula datos en buffer y los sincroniza al reconectarse.
6. **Tolerancia a fallos**: botón *Simular caída*. El microservicio cae, el resto sigue funcionando y el orquestador lo reinicia en 2 s.

## Reloj simulado

1 segundo real = 2 minutos en la ciudad; la simulación arranca a las 16:00. Un día completo dura 12 minutos.

## Supuestos

- Factor de emisión de la red eléctrica colombiana: 0,126 kg CO₂/kWh (aproximado).
- Emisiones de un camión recolector: 0,9 kg CO₂/km (aproximado).
- Los datos son simulados; en producción los sensores usarían MQTT/LoRaWAN, el bus sería Kafka y los servicios correrían en Kubernetes.
