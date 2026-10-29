// ============================================================================
// Cálculo de la nota — una sola fuente de verdad.
//
// Estaba metido dentro de EvaluationResult.jsx, así que la planilla del lote
// habría tenido su propia copia de la fórmula y con el tiempo las dos se
// habrían separado. Aquí queda una sola, y la usan los dos.
// ============================================================================

/** El backend puede devolver `correcta` como booleano, número o texto. */
export const esCorrecta = (val) => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val === 1;
  if (typeof val === 'string') {
    const n = val.trim().toLowerCase();
    return ['true', 'verdadero', 'sí', 'si', 'correcto', 'correcta', '1'].includes(n);
  }
  return false;
};

/**
 * Resume un resultado del backend en cifras para la UI y para el Excel.
 *
 * Las preguntas marcadas "revisar" son las que el sistema NO pudo determinar
 * (no vio la marca, o no logró establecer la respuesta correcta). No son fallos
 * del alumno, así que no cuentan para la nota: se separan para que el docente
 * las mire. Sin esto, una foto borrosa le bajaría la nota a un estudiante que
 * sí respondió bien.
 *
 * NOTA SOBRE LA ESCALA: la nota va de 0.0 a 5.0 — un examen todo malo da 0.0.
 * Está pendiente de confirmar con el docente si el mínimo debe ser 1.0, como se
 * acostumbra en Colombia. Si se cambia, se cambia AQUÍ y afecta a toda la app.
 */
export function resumirResultado(resultado) {
  const preguntas = resultado?.preguntas || [];
  const correctas = preguntas.filter((p) => esCorrecta(p.correcta)).length;
  const porRevisar = preguntas.filter((p) => p.revisar && !esCorrecta(p.correcta)).length;
  const incorrectas = preguntas.length - correctas - porRevisar;

  const calificadas = Math.max(preguntas.length - porRevisar, 0);
  const nota = calificadas > 0 ? (correctas / calificadas) * 5 : null;

  return {
    total: preguntas.length,
    correctas,
    incorrectas,
    porRevisar,
    calificadas,
    nota,                                        // número o null
    notaTexto: nota == null ? '—' : nota.toFixed(1),
  };
}

/**
 * Temas a reforzar de TODO el curso, no de un solo estudiante.
 *
 * Al terminar un lote, lo que le sirve al docente no es la lista de fallos de
 * cada alumno —esa la ve abriendo el examen— sino saber qué preguntas falló el
 * grupo entero: eso es lo que hay que volver a explicar en clase.
 *
 * Se agrupa por NÚMERO DE PREGUNTA y no por el texto del consejo, porque todos
 * los exámenes del lote son el mismo: la pregunta 12 es la 12 para todos. El
 * consejo que se muestra es el más repetido entre quienes la fallaron.
 *
 * Solo cuentan los fallos REALES: una pregunta marcada "revisar" es una que el
 * sistema no pudo leer, y meterla aquí mandaría al docente a reexplicar un tema
 * que quizá nadie falló.
 */
export function temasDelCurso(resultados, { umbral } = {}) {
  const lista = (resultados || []).filter(Boolean);
  const total = lista.length;
  if (!total) return { total: 0, umbral: 0, temas: [] };

  // Cuatro estudiantes es el umbral pedido, pero en un grupo pequeño cuatro
  // puede ser el curso entero, así que baja a la mitad cuando son menos de ocho.
  const u = umbral ?? Math.max(2, Math.min(4, Math.ceil(total / 2)));

  const porPregunta = new Map();
  for (const r of lista) {
    for (const p of r?.preguntas || []) {
      if (esCorrecta(p.correcta) || p.revisar) continue;
      if (!porPregunta.has(p.id)) porPregunta.set(p.id, { id: p.id, fallaron: 0, consejos: new Map() });
      const entrada = porPregunta.get(p.id);
      entrada.fallaron += 1;
      const consejo = String(p.feedback || '').trim();
      if (consejo) entrada.consejos.set(consejo, (entrada.consejos.get(consejo) || 0) + 1);
    }
  }

  const temas = [...porPregunta.values()]
    .filter((t) => t.fallaron >= u)
    .map((t) => ({
      id: t.id,
      fallaron: t.fallaron,
      total,
      consejo: [...t.consejos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '',
    }))
    .sort((a, b) => b.fallaron - a.fallaron || a.id - b.id);

  return { total, umbral: u, temas };
}
