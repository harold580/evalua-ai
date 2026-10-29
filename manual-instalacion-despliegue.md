# Manual de instalación y despliegue de EvaluaIA

**Versión:** 1.0  
**Fecha:** 29 de octubre de 2026  
**Dirigido a:** administración del proyecto y despliegue

## 1. Alcance

Este manual explica cómo preparar EvaluaIA en un equipo local, configurar el proveedor de IA y publicar la aplicación en Vercel. En el repositorio, la aplicación está dentro de `EvaluaIA-GitHub/`; ejecuta los comandos desde esa carpeta.

Producción: [https://evalua-ai-lac.vercel.app](https://evalua-ai-lac.vercel.app). El despliegue actual se realiza manualmente con Vercel CLI; el proyecto no está conectado automáticamente a GitHub.

## 2. Requisitos previos

- Git.
- Node.js 22.x y npm.
- Cuenta Vercel con acceso al proyecto `evalua-ai` del equipo `harold580s-projects`.
- Clave OpenRouter para evaluaciones reales.
- Conexión a internet.

Las evaluaciones reales llaman a OpenRouter y pueden consumir créditos. No uses datos de estudiantes sin autorización institucional.

## 3. Obtener e instalar el proyecto

Clona el repositorio y entra a la carpeta de la aplicación:

```bash
git clone https://github.com/harold580/evalua-ai.git
cd evalua-ai/EvaluaIA-GitHub
npm ci
```

`npm ci` instala las versiones fijadas en `package-lock.json`.

### Configurar el entorno local

Copia la plantilla de variables:

```bash
cp .env.example .env
```

En PowerShell:

```powershell
Copy-Item .env.example .env
```

Edita `.env` y define `OPENROUTER_API_KEY`. No subas `.env` ni `.env.local` al repositorio, no incluyas la clave en el frontend ni uses variables `VITE_*` para secretos.

### Ejecutar localmente

Abre dos terminales desde `EvaluaIA-GitHub/`:

```bash
npm run dev
```

```bash
npm run start:dev
```

El frontend queda en `http://localhost:5173`; Express sirve la API en `http://localhost:5174`. Vite reenvía `/api/*` al backend.

Para compilar producción localmente, usa `npm run build`; los archivos quedan en `dist/`. Para servir ese build mediante Express, ejecuta `npm start`.

## 4. Configurar variables de producción

En Vercel abre el proyecto `evalua-ai`, ve a **Settings → Environment Variables** y añade `OPENROUTER_API_KEY` como variable sensible para **Production**. Después de cambiar variables, crea un nuevo despliegue para aplicarlas.

| Variable | Obligatoria | Descripción |
|---|---:|---|
| `OPENROUTER_API_KEY` | Sí para calificar | Clave OpenRouter utilizada exclusivamente por las funciones de servidor. |
| `OPENROUTER_MODEL` | No | Modelo multimodal; predeterminado `openai/gpt-6-luna`. |
| `OPENROUTER_BASE_URL` | No | URL de API; predeterminada `https://openrouter.ai/api/v1`. |
| `OPENROUTER_REASONING_EFFORT` | No | `none`, `minimal`, `low`, `medium`, `high`, `xhigh` o `max`; predeterminado `medium`. |
| `OPENROUTER_SITE_URL` | No | URL reportada al proveedor como `HTTP-Referer`. |
| `OPENROUTER_APP_NAME` | No | Nombre reportado al proveedor; predeterminado `EvaluaIA`. |
| `ALLOWED_ORIGIN` | No | Orígenes CORS permitidos, separados por coma. Usa dominios exactos. |

`.env.example` contiene solo valores de referencia y no incluye secretos.

## 5. Ajustes de Vercel

Si importas el repositorio completo desde GitHub, selecciona:

| Ajuste | Valor |
|---|---|
| Framework Preset | Vite |
| Root Directory | `EvaluaIA-GitHub` |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node.js Version | 22.x |

`vercel.json` ya especifica el framework, build, salida, rewrites y encabezados. Si seleccionas la carpeta raíz superior del repositorio en lugar de `EvaluaIA-GitHub`, Vercel no encontrará el `package.json` del proyecto.

## 6. Publicar manualmente con Vercel CLI

Usa este flujo para el proyecto de Vercel existente, que actualmente no tiene integración con GitHub:

1. Instala Vercel CLI si el comando `vercel` no existe:

   ```bash
   npm install --global vercel
   ```

2. Desde `EvaluaIA-GitHub/`, autentícate:

   ```bash
   vercel login
   ```

3. Vincula la carpeta al proyecto existente:

   ```bash
   vercel link --yes --scope harold580s-projects --project evalua-ai
   ```

   CLI genera configuración local en `.vercel/` y puede crear `.env.local`. Ambos patrones están excluidos de Git; no los publiques.

4. Despliega a producción:

   ```bash
   vercel deploy --prod --yes --scope harold580s-projects --project evalua-ai
   ```

5. Espera la confirmación **Ready** y comprueba que el dominio de producción apunte a la versión nueva.

Vercel instala dependencias y compila en su entorno. No subas manualmente `node_modules/` ni `dist/`.

## 7. Conectar GitHub para despliegues automáticos (opcional)

Actualmente Vercel no publica automáticamente los cambios de GitHub. Para habilitarlo, la administración puede conectar el repositorio desde **Project Settings → Git**, seleccionar la rama de producción, fijar `EvaluaIA-GitHub` como Root Directory y verificar que las variables de entorno estén configuradas. Después, los pushes a esa rama generarán despliegues.

Coordina los despliegues por CLI y los cambios de la rama de producción para evitar publicar versiones distintas.

## 8. Verificar el despliegue

1. Comprueba en Vercel que el deployment figure como **Ready**.
2. Abre [https://evalua-ai-lac.vercel.app](https://evalua-ai-lac.vercel.app) y verifica la pantalla principal.
3. Abre **Configuración de IA** y confirma que indica OpenRouter configurado y muestra el modelo esperado.
4. Visita `https://evalua-ai-lac.vercel.app/api/config`. La respuesta debe incluir `"hasServerKey":true`; solo informa que la variable existe y no revela su valor.
5. Si hace falta probar una evaluación, usa una imagen de prueba autorizada. La solicitud real a `/api/evaluate` puede consumir créditos.

La cámara requiere HTTPS y permiso del navegador.

## 9. Reversión de una publicación

Si el despliegue presenta un problema, abre **Deployments** en Vercel, identifica la última versión estable y usa **Instant Rollback** o promueve el deployment estable. Revisa los logs del build y de las funciones antes de volver a desplegar.

## 10. Solución de problemas

| Problema | Acción |
|---|---|
| `package.json` no encontrado | Ejecuta los comandos desde `EvaluaIA-GitHub/`. |
| Vercel no encuentra `vercel.json` | Configura Root Directory como `EvaluaIA-GitHub`. |
| La app carga, pero no califica | Comprueba `OPENROUTER_API_KEY` en Production y vuelve a desplegar. Revisa `/api/config` sin compartir secretos. |
| Error `401` o `403` de OpenRouter | Revisa validez de la clave y acceso al modelo en la cuenta del proveedor. |
| Error `429` | Comprueba límites de solicitudes y saldo/cuota de OpenRouter. |
| Error `413` | Reduce el tamaño de las imágenes o permite que el cliente las divida en tandas. |
| Cámara no disponible | Usa HTTPS, habilita el permiso o carga imágenes desde el dispositivo. |

Nunca incluyas claves, tokens, fotografías, nombres ni notas en capturas o logs que compartas.

## Documentación relacionada

- [Manual de usuario](manual-usuario.md)
- [Manual técnico](manual-tecnico.md)
- [Resumen rápido de despliegue](../SUBIR-A-VERCEL.md)
