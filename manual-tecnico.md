# Manual técnico de EvaluaIA

**Versión:** 1.0  
**Fecha:** 29 de octubre de 2026  
**Dirigido a:** desarrollo y administración del despliegue

## 1. Descripción

EvaluaIA es una aplicación web para leer y calificar exámenes de selección múltiple a partir de fotografías. El frontend está construido con React y Vite; la API se ejecuta como funciones serverless en Vercel y consulta OpenRouter para las tareas de visión y razonamiento. No hay base de datos configurada: los resultados del curso se mantienen en memoria en la pestaña del docente y se exportan desde el navegador.

La aplicación pública no implementa inicio de sesión ni roles. Cualquier persona que tenga el enlace puede abrir la interfaz; la clave de OpenRouter se mantiene en el backend. No expongas datos académicos sin autorización institucional.

## 2. Tecnologías y estructura

| Ruta | Función |
|---|---|
| `src/App.jsx` | Entrada y composición de la interfaz principal. |
| `src/components/` | Carga individual, cámara, carga masiva, resultados, configuración y guías. |
| `src/services/` | Compresión y preparación de imágenes, límite de carga, lotes, notas y exportación Excel. |
| `api/evaluate.js` | Endpoint de evaluación, validación, limitación de solicitudes y llamada al pipeline. |
| `api/config.js` | Endpoint informativo de configuración: proveedor, modelo y presencia de clave. No devuelve la clave. |
| `api/_gradePipeline.js` | Flujo de análisis por visión, lectura de marcas, razonamiento y normalización de resultados. |
| `api/_openRouter.js` | Configuración y comunicación con OpenRouter. |
| `api/_imageTiles.js`, `api/_bubbleDetect.js`, `api/_markEvidence.js` | Procesamiento de recortes, detección de burbujas y evidencia visual de marcas. |
| `public/libarchive/` | Worker y recursos WebAssembly para abrir archivos RAR en el navegador. |
| `tests/` | Pruebas automatizadas sin llamadas reales al proveedor. |
| `vercel.json` | Framework, build, salida, duración de funciones, rewrites y encabezados de seguridad. |

El proyecto dentro del repositorio está en `EvaluaIA-GitHub/`. Para usar GitHub como fuente de Vercel, esa carpeta debe ser la raíz del proyecto.

## 3. Flujo de una evaluación

1. El frontend valida tipo y tamaño, lee las imágenes y las comprime para ajustarse al presupuesto de carga.
2. En carga masiva, el ZIP/RAR se abre y se agrupa en el navegador. Se muestra una pantalla de revisión antes de iniciar las llamadas de IA.
3. El cliente envía las hojas de un examen a `POST /api/evaluate`. Los exámenes de un lote se procesan como trabajos independientes con una concurrencia predeterminada de tres.
4. La función serverless valida el formato, el tamaño y la cantidad de páginas. La clave `OPENROUTER_API_KEY` se lee exclusivamente en el servidor.
5. El pipeline usa el modelo configurado para leer el texto y las marcas, y razonar sobre la respuesta correcta. El código compara la respuesta marcada con la respuesta determinada por el modelo y forma el resultado JSON.
6. El frontend calcula la nota en escala 0.0–5.0. Las preguntas sin una decisión confiable quedan como `revisar` y se excluyen del cálculo; el docente debe cotejarlas con la imagen original.

Las imágenes de los exámenes se transmiten al backend y luego a OpenRouter para procesarlas. El archivo comprimido permanece en el navegador, pero sus imágenes se envían durante la calificación. EvaluaIA no escribe los resultados en una base de datos; la permanencia y el tratamiento de solicitudes en el proveedor externo se rigen por la cuenta y las condiciones de OpenRouter.

## 4. Requisitos e instalación local

- Node.js 22.x (definido en `package.json`) y npm.
- Acceso a internet para descargar dependencias y llamar a OpenRouter.
- Una clave de API de OpenRouter para realizar evaluaciones reales.

Desde `EvaluaIA-GitHub/`:

```bash
npm ci
cp .env.example .env
```

En Windows PowerShell, la segunda instrucción es:

```powershell
Copy-Item .env.example .env
```

Edita `.env` y asigna `OPENROUTER_API_KEY`. No añadas la clave al frontend, no uses variables `VITE_*` para secretos y no subas `.env` ni `.env.local` al repositorio.

Inicia el frontend y la API local en dos terminales, ambas desde `EvaluaIA-GitHub/`:

```bash
npm run dev
```

```bash
npm run start:dev
```

Vite sirve la interfaz en `http://localhost:5173` y Express sirve las rutas API en `http://localhost:5174`. Vite reenvía `/api/*` al servidor Express. El script `start:dev` lee `.env` y usa el puerto 5174, salvo que se defina `PORT`.

Para servir localmente el build, ejecuta `npm run build` y después `npm start`. `npm start` sirve `dist/` y las mismas rutas API mediante Express.

## 5. Variables de entorno

| Variable | Requerida | Descripción |
|---|---:|---|
| `OPENROUTER_API_KEY` | Sí, para evaluar | Clave secreta usada únicamente por las funciones del servidor. |
| `OPENROUTER_MODEL` | No | Modelo multimodal para el pipeline. Predeterminado: `openai/gpt-6-luna`. |
| `OPENROUTER_BASE_URL` | No | URL base de la API. Predeterminada: `https://openrouter.ai/api/v1`. |
| `OPENROUTER_REASONING_EFFORT` | No | `none`, `minimal`, `low`, `medium`, `high`, `xhigh` o `max`; predeterminado: `medium`. |
| `OPENROUTER_SITE_URL` | No | Valor enviado como `HTTP-Referer` al proveedor. |
| `OPENROUTER_APP_NAME` | No | Título enviado a OpenRouter. Predeterminado: `EvaluaIA`. |
| `ALLOWED_ORIGIN` | No | Lista de orígenes permitidos para CORS, separados por coma. Configura dominios exactos; no uses `*`. |

`GET /api/config` devuelve `hasServerKey`, `provider`, `model` y el entorno. Devuelve solo si la clave existe; nunca el valor secreto.

## 6. API y límites operativos

### `GET /api/config`

Comprueba la configuración visible para el frontend. Acepta `GET` y `OPTIONS`; los demás métodos devuelven `405`.

### `POST /api/evaluate`

Recibe JSON con `image` para una página o `images` como arreglo de páginas del mismo examen. Cada valor debe ser una imagen JPEG, PNG o WebP en data URL/base64.

| Límite | Valor en el código |
|---|---:|
| Páginas por solicitud | 6 |
| Tamaño codificado por imagen | 3.500.000 caracteres |
| Tamaño codificado total validado | 3.900.000 caracteres |
| Presupuesto de página en el cliente | 3.800.000 caracteres aprox. |
| Duración máxima de función en Vercel | 90 s para `evaluate`; 10 s para `config` |
| Timeout por llamada al proveedor | 35 s |
| Recarga del rate limiter del servidor | 1 token cada 3 s, hasta 10 tokens |

La interfaz también aplica un limitador de cliente (5 tokens con recarga de 1 cada 12 s) y un circuit breaker. El limitador en memoria de una función serverless no constituye una cuota global garantizada: las instancias de Vercel no comparten ese estado.

Respuestas de error relevantes: `400` entrada inválida, `405` método no permitido, `413` carga grande (el cliente divide y reintenta en tandas), `429` límite de solicitudes, `503` clave no configurada y `500` error interno. Los fallos del proveedor pueden devolver el estado correspondiente o `502`.

## 7. Compilación y comandos

| Comando | Uso |
|---|---|
| `npm run build` | Compila el frontend de producción en `dist/`. |
| `npm run lint` | Ejecuta ESLint sobre el proyecto. |
| `npm test` | Ejecuta la suite automatizada offline indicada en `package.json`. |
| `npm run test:openrouter:live` | Prueba real que requiere clave válida y puede consumir créditos. |
| `npm run test:camera` | Prueba de cámara en navegador. |

Las pruebas con proveedor real consumen créditos; no las ejecutes como parte de una verificación rutinaria.

## 8. Despliegue en Vercel

La configuración `vercel.json` establece Vite, `npm ci`, `npm run build`, `dist` como salida, funciones serverless, rewrites a la SPA y encabezados de seguridad. En el proyecto de Vercel:

1. Define `EvaluaIA-GitHub` como **Root Directory** si conectas el repositorio GitHub completo.
2. Usa Node.js 22.x.
3. Configura `OPENROUTER_API_KEY` en **Settings → Environment Variables**, para el entorno Production. Añade variables opcionales solo cuando se necesiten.
4. Despliega y verifica la página principal, `/api/config` y una evaluación autorizada de prueba. Las llamadas de evaluación reales pueden consumir créditos.

En la entrega actual, Vercel se publica manualmente desde la carpeta `EvaluaIA-GitHub/`; el proyecto no tiene despliegue automático conectado a GitHub. Para mantener ese flujo, inicia sesión con Vercel CLI, vincula la carpeta al proyecto existente y ejecuta `vercel deploy --prod` desde esa ruta. No copies `.vercel/` ni archivos `.env*` a GitHub. Consulta [SUBIR-A-VERCEL.md](../SUBIR-A-VERCEL.md) para los pasos de despliegue.

## 9. Seguridad y privacidad

- La clave de OpenRouter permanece en variables de entorno del servidor; nunca debe compilarse dentro del bundle del navegador.
- `.env*` está excluido de Git y `.env.example` contiene nombres/configuración sin secretos.
- `vercel.json` configura `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` y Content Security Policy.
- El backend valida los formatos de imagen y limita tamaños, páginas, métodos y frecuencia de solicitudes.
- El almacenamiento de notas e imágenes no está implementado. Los lotes se pierden al cerrar o recargar la pestaña si no se exporta el Excel.
- La aplicación no tiene autenticación ni roles. La clave de API no sirve como control de acceso a la interfaz; protege el gasto y los datos mediante políticas de Vercel y del proveedor según corresponda.
- Antes de procesar datos personales de estudiantes, confirma que el uso de OpenRouter cumple las políticas de la institución y revisa las condiciones de tratamiento configuradas para la cuenta.

## 10. Diagnóstico

| Síntoma | Revisión técnica |
|---|---|
| `OpenRouter no está configurado` | Comprueba `OPENROUTER_API_KEY` en el entorno correcto de Vercel y vuelve a desplegar. No consultes ni compartas el valor en logs. |
| Error `401`/`403` del proveedor | Verifica la validez, saldo/permisos y restricciones del modelo de la clave en OpenRouter. |
| Error `429` | Revisa límite de la app y el estado/cuota del proveedor; espera la recarga o reduce la velocidad del lote. |
| Error `413` | El cliente debería dividir la solicitud; revisa el peso de las imágenes y los límites de Vercel antes de cambiar topes. |
| Cámara negra o bloqueada | Confirma HTTPS/localhost, permiso del navegador y que el video esté activo. |
| Desarrollo queda en blanco | Usa Node 22.x, instala con `npm ci` e inicia `npm run dev`; Vite configura una CSP de desarrollo para React Refresh. |
| `/api/*` devuelve 404 localmente | Inicia también `npm run start:dev` en el puerto 5174 y verifica el proxy de Vite. |

Para errores en producción, revisa los logs de funciones y el resultado de build en Vercel. Comparte logs después de retirar claves, tokens, imágenes, nombres y cualquier dato académico identificable.

## Documentación relacionada

- [Manual de usuario](manual-usuario.md)
- [Guía de despliegue en Vercel](../SUBIR-A-VERCEL.md)
