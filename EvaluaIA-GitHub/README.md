# EvaluaIA

Aplicación web para que docentes evalúen exámenes de opción múltiple a partir de fotos, ya sea de un estudiante o mediante carga masiva.

## Funciones

- Carga de imágenes y captura con cámara.
- Exámenes de varias hojas con revisión y ordenamiento de imágenes.
- Calificación individual y por lote.
- Lectura asistida por IA y cálculo determinista de la nota.
- Resultados, retroalimentación y guía de marcación.
- Revisión de respuestas ambiguas antes de cerrar la calificación.

## Arquitectura

- Frontend: React y Vite.
- API: funciones serverless compatibles con Vercel; Express sirve las mismas rutas en desarrollo local.
- IA: OpenRouter. La configuración de esta copia usa `openai/gpt-6-luna`.
- Persistencia: no se configura una base de datos para guardar evaluaciones.

## Requisitos y desarrollo local

Se requiere Node.js 22.x y npm.

1. Instala dependencias: `npm ci`.
2. Copia `.env.example` a `.env` y agrega tu `OPENROUTER_API_KEY`.
3. En una terminal ejecuta `npm run dev`.
4. En otra terminal ejecuta `npm run start:dev`.

Vite sirve el frontend en `http://localhost:5173`; Express sirve la API en `http://localhost:5174`.

## Comandos disponibles

- `npm test`: pruebas automatizadas sin llamadas reales al proveedor.
- `npm run lint`: análisis estático.
- `npm run build`: compilación de producción.
- `npm run test:camera`: prueba del flujo de cámara simulada en Chrome.
- `npm run test:openrouter:live`: prueba opcional que requiere una clave y consume créditos.

## Despliegue

El proyecto está configurado para desplegarse desde la raíz del repositorio en Vercel. Revisa [SUBIR-A-VERCEL.md](SUBIR-A-VERCEL.md) antes del despliegue. La captura con cámara requiere HTTPS.

## Seguridad

No publiques el archivo `.env` ni pegues claves en el código. Configura `OPENROUTER_API_KEY` como variable de entorno sensible en Vercel. El archivo `.env.example` contiene solo nombres de variables y valores de ejemplo.