# Desplegar EvaluaIA en Vercel

1. Sube este repositorio a GitHub e impórtalo en Vercel.
2. Configura la raíz del proyecto como la raíz del repositorio.
3. Usa estos ajustes:
   - Framework: Vite
   - Instalación: `npm ci`
   - Build: `npm run build`
   - Directorio de salida: `dist`
   - Runtime de Node.js: 22.x
4. En las variables de entorno de Vercel, agrega `OPENROUTER_API_KEY` como secreto.
5. Define `OPENROUTER_MODEL=openai/gpt-6-luna`. Puedes configurar opcionalmente `OPENROUTER_REASONING_EFFORT`, `OPENROUTER_SITE_URL`, `OPENROUTER_APP_NAME` y `ALLOWED_ORIGIN`.
6. Despliega y comprueba la aplicación y las rutas `/api/config` y `/api/evaluate`.

La clave se configura únicamente en el servidor; no la añadas a variables `VITE_*` ni al repositorio. Las evaluaciones reales llaman a OpenRouter y pueden consumir créditos. La cámara necesita HTTPS y permiso del navegador.