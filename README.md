# Taller 7 · Tecnologías emergentes y sostenibles en sistemas distribuidos

Ingeniería de Software · Sistemas Distribuidos

Propuesta de la **Plataforma Ciudad Inteligente Integrada (PCII)**: un sistema distribuido que integra la gestión de energía, movilidad y residuos de una ciudad colombiana con IoT, Edge Computing, microservicios, contenedores, inteligencia artificial y nube.

## Contenido

| Archivo / carpeta | Descripción |
| --- | --- |
| `Taller_Tecnologias_Emergentes_Sistemas_Distribuidos.docx` | Documento académico: introducción, objetivos, las 5 actividades, tabla comparativa, propuesta de sostenibilidad, conclusiones y referencias APA 7 |
| `arquitectura.drawio` | Diagrama de arquitectura por capas (abrir en [diagrams.net](https://app.diagrams.net)) |
| `arquitectura.mmd` | El mismo diagrama en Mermaid (ver en [mermaid.live](https://mermaid.live)) |
| `prototipo/` | Prototipo funcional del sistema distribuido con dashboard web |

## Ejecutar el prototipo

Requiere Node.js 18 o superior; no tiene dependencias externas.

```bash
cd prototipo
npm start
```

Abrir **http://localhost:7100**. Más detalles en [`prototipo/README.md`](prototipo/README.md).

## Arquitectura

1. **Dispositivos IoT**: sensores de energía, tráfico y llenado de contenedores (simulados).
2. **Edge Computing**: dos nodos que filtran y agregan datos, controlan el alumbrado localmente y operan sin conexión.
3. **Comunicación**: bus de eventos publicar/suscribir.
4. **Servicios distribuidos**: microservicios de energía, movilidad y residuos con IA, detrás de un API Gateway.
5. **Visualización**: dashboard en vivo.
