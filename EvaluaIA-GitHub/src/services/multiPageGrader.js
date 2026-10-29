// ============================================================================
// Calificación de un examen de VARIAS hojas del mismo estudiante.
//
// Manda las hojas al backend en tandas que quepan en el límite de Vercel y
// fusiona los resultados en UNA sola calificación. Si una tanda vuelve con 413
// (demasiado peso), la parte a la mitad y reintenta: así el docente nunca ve un
// error por un cálculo de peso que se quedó corto.
// ============================================================================

import { prepararEnvio, repartirEnTandas } from './payloadBudget.js';
import { getServerConfig } from './openRouterApi.js';
import { apiRateLimiter } from './security.js';

/** Envía una tanda de hojas. Devuelve el JSON del backend o lanza error. */
async function enviarTanda(hojas) {
  const response = await fetch('/api/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images: hojas }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const err = new Error(data.error || `Error del servidor (${response.status})`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

/**
 * Envía una tanda; si el servidor la rechaza por peso, la parte en dos y
 * reintenta cada mitad. Devuelve la lista de resultados parciales.
 */
async function enviarConReparto(hojas) {
  try {
    return [await enviarTanda(hojas)];
  } catch (err) {
    // 413 = no cupo. Con una sola hoja ya no hay nada que partir.
    if (err.status !== 413 || hojas.length < 2) throw err;
    const mitad = Math.ceil(hojas.length / 2);
    const izquierda = await enviarConReparto(hojas.slice(0, mitad));
    const derecha = await enviarConReparto(hojas.slice(mitad));
    return [...izquierda, ...derecha];
  }
}

/**
 * Fusiona los resultados parciales de varias tandas en una sola calificación.
 * Las preguntas se renumeran de corrido para que el docente vea 1..N seguidas,
 * sin importar en cuántos viajes se enviaron.
 */
export function fusionarResultados(parciales) {
  const preguntas = [];
  const temas = [];
  const razones = [];
  let nombre = '';

  for (const parcial of parciales) {
    if (!parcial) continue;
    const n = String(parcial.nombreEstudiante || '').trim();
    // Basta con que UNA hoja traiga el nombre — normalmente solo la primera.
    if (!nombre && n && n.toLowerCase() !== 'no especificado') nombre = n;

    for (const p of parcial.preguntas || []) {
      preguntas.push({ ...p, id: preguntas.length + 1 });
    }
    if (Array.isArray(parcial.temasAFallar)) temas.push(...parcial.temasAFallar);
    if (parcial.razonamiento_visual) razones.push(parcial.razonamiento_visual);
  }

  return {
    nombreEstudiante: nombre || 'No especificado',
    totalPreguntas: preguntas.length,
    preguntas,
    // Sin repetir entre tandas: dos hojas distintas pueden fallar el mismo tema.
    temasAFallar: [...new Set(temas.filter(Boolean))].slice(0, 20),
    razonamiento_visual: razones.join(' | '),
  };
}

/**
 * Califica un examen de 1 a 6 hojas de un mismo estudiante.
 *
 * @param {string[]} hojas    data URLs, en el orden de las páginas
 * @param {object}   opciones { onProgress(hecho, total) }
 */
export async function analyzeExamPages(hojas, { onProgress } = {}) {
  if (!Array.isArray(hojas) || hojas.length === 0) {
    throw new Error('No hay ninguna hoja para calificar.');
  }

  // El limitador se consume UNA vez por estudiante, no por tanda: partir un
  // examen en dos viajes es una decisión interna, no dos usos del docente.
  const rateCheck = apiRateLimiter.tryConsume();
  if (!rateCheck.allowed) {
    if (rateCheck.reason === 'circuit_breaker') {
      const secs = Math.ceil(rateCheck.retryAfterMs / 1000);
      throw new Error(`🛑 Circuit breaker activado. Demasiados errores seguidos. Intenta en ${secs} segundos.`);
    }
    throw new Error('⚠️ Demasiadas solicitudes. Espera unos segundos antes de intentar de nuevo.');
  }

  const sCfg = await getServerConfig();
  if (!sCfg.hasServerKey) {
    throw new Error('🔑 OpenRouter no está configurado en el servidor. Define OPENROUTER_API_KEY.');
  }

  try {
    const tandas = await prepararEnvio(hojas);
    const parciales = [];
    let hechas = 0;

    // En serie y no en paralelo: son hojas del mismo alumno, no hay prisa por
    // adelantar, y así no se le echan varias peticiones pesadas encima al
    // limitador del servidor.
    for (const tanda of tandas) {
      parciales.push(...await enviarConReparto(tanda));
      hechas += tanda.length;
      onProgress?.(hechas, hojas.length);
    }

    apiRateLimiter.recordSuccess();
    return fusionarResultados(parciales);
  } catch (error) {
    apiRateLimiter.recordError();
    if (import.meta.env.DEV) console.error('Error en analyzeExamPages:', error);
    throw error;
  }
}

export { repartirEnTandas };
