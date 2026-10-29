// ============================================================================
// Motor de calificación por lotes.
//
// Cada estudiante es un trabajo INDEPENDIENTE: una llamada limpia al modelo,
// sin memoria del alumno anterior. Eso no es un detalle de implementación, es
// lo que evita que el modelo copie respuestas del examen anterior cuando la
// foto de este está borrosa.
//
// La cadencia la marca esta cola (2-3 estudiantes a la vez), no el cubo de
// tokens del limitador: por eso se envuelve todo en iniciarLote()/terminarLote().
// ============================================================================

import { analyzeExamPages } from './multiPageGrader.js';
import { apiRateLimiter } from './security.js';
import { resumirResultado } from './nota.js';

export const CONCURRENCIA_POR_DEFECTO = 3;

/**
 * Procesa los grupos de hojas, como máximo `concurrencia` a la vez.
 *
 * @param {Array<{clave:string, hojas:Array<{src:string}>}>} grupos
 * @param {object} opciones
 *   onCambio(indice, parcial)  — se llama en cada cambio de estado
 *   cancelado()                — devuelve true para detener el lote
 */
export async function procesarLote(grupos, { onCambio, cancelado, concurrencia = CONCURRENCIA_POR_DEFECTO } = {}) {
  apiRateLimiter.iniciarLote();
  let siguiente = 0;

  const trabajador = async () => {
    for (;;) {
      if (cancelado?.()) return;
      const i = siguiente++;
      if (i >= grupos.length) return;

      onCambio?.(i, { estado: 'calificando' });
      try {
        const resultado = await analyzeExamPages(grupos[i].hojas.map((h) => h.src));
        onCambio?.(i, {
          estado: 'listo',
          resultado,
          resumen: resumirResultado(resultado),
        });
      } catch (err) {
        // Un estudiante que falla NO tumba el lote: queda marcado para
        // reintentarlo solo a él.
        onCambio?.(i, { estado: 'error', error: err.message || 'Error desconocido' });
      }
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrencia, grupos.length) }, trabajador)
    );
  } finally {
    apiRateLimiter.terminarLote();
  }
}

/** Reintenta un solo estudiante. Mismo camino que el lote, pero para uno. */
export async function reintentarUno(grupo, { onCambio } = {}) {
  apiRateLimiter.iniciarLote();
  onCambio?.({ estado: 'calificando' });
  try {
    const resultado = await analyzeExamPages(grupo.hojas.map((h) => h.src));
    onCambio?.({ estado: 'listo', resultado, resumen: resumirResultado(resultado) });
  } catch (err) {
    onCambio?.({ estado: 'error', error: err.message || 'Error desconocido' });
  } finally {
    apiRateLimiter.terminarLote();
  }
}

// ── Por qué el lote NO se guarda en el navegador ───────────────────────────
// Se probó a conservar las notas en el almacenamiento del navegador para poder
// retomar un lote a medias. Se descartó por dos motivos:
//
//   1. tests/openrouter-integracion.mjs prohíbe ese almacenamiento en todo
//      `src/`. Es un guardia deliberado para que jamás acabe una credencial
//      guardada del lado del cliente, y no vale la pena debilitarlo por una
//      comodidad. (El test también revisa los comentarios, así que aquí no se
//      escriben los nombres de esas API.)
//   2. Lo que se guardaría son nombres y notas de MENORES. En el computador
//      compartido de una sala de profesores eso quedaría ahí hasta que alguien
//      lo borre. Que los datos vivan solo mientras dura el trabajo es más seguro.
//
// A cambio, la pantalla avisa antes de cerrar si hay notas sin exportar.
