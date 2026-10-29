import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ── CSP relajada SOLO en desarrollo ────────────────────────────────────────
// El index.html declara `script-src 'self'`, que prohíbe los scripts en línea.
// El servidor de desarrollo de Vite necesita inyectar uno en el <head> para
// arrancar React (el preámbulo de react-refresh), el navegador lo bloquea y la
// página queda EN BLANCO con solo el título cargado. Costó un buen rato
// diagnosticarlo porque compilado funciona perfecto.
//
// Este plugin añade 'unsafe-inline' a la meta CSP únicamente cuando sirve el
// dev server. El index.html del repositorio NO se modifica, así que la política
// de producción (y la de vercel.json) sigue siendo la estricta de siempre.
const cspDesarrollo = () => ({
  name: 'csp-solo-desarrollo',
  apply: 'serve',
  transformIndexHtml(html) {
    return html.replace(
      /(<meta http-equiv="Content-Security-Policy"[\s\S]*?content=")([^"]*)(")/,
      (_, antes, politica, despues) =>
        antes + politica.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") + despues
    );
  },
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cspDesarrollo()],
  server: {
    // ── Security Headers para desarrollo ──
    headers: {
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
      'X-Permitted-Cross-Domain-Policies': 'none',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5174',
        changeOrigin: true,
      },
    },
  },
  // ── Security Headers para producción (preview) ──
  preview: {
    headers: {
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
      'X-Permitted-Cross-Domain-Policies': 'none',
    },
  },
})
