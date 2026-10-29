const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
const clean = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const letter = (value) => /^[A-F]$/.test(String(value ?? '').trim().toUpperCase()) ? String(value).trim().toUpperCase() : '';
const hasText = (value) => typeof value === 'string' && value.trim() && !['?', 'null', 'ninguna'].includes(clean(value));

// Para ubicar una marca se exige el texto completo, sin convertir números ni
// buscar subcadenas: «3» y «30» son opciones visualmente distintas.
export function exactMarkedText(text, options = {}) {
  if (!hasText(text)) return '';
  const matches = letters.filter((key) => options[key] != null && clean(options[key]) === clean(text));
  return matches.length === 1 ? matches[0] : '';
}

export function stateMarkedLetter(mark) {
  if (!mark || typeof mark !== 'object') return '';
  if (mark.estado != null) {
    if (typeof mark.estado !== 'object' || Array.isArray(mark.estado)) return '';
    const entries = Object.entries(mark.estado).filter(([key]) => letter(key));
    const valid = entries.every(([, value]) => ['marcada', 'vacia', 'no marcada', 'sin marcar'].includes(clean(value)));
    const selected = entries.filter(([, value]) => clean(value) === 'marcada');
    return valid && selected.length === 1 ? letter(selected[0][0]) : '';
  }
  return letter(mark.letra_marcada);
}

/** Nunca usa la solución académica para elegir una marca. */
export function resolveMarkEvidence(mark, options = {}) {
  const uncertain = (reason) => ({ letter: '', reason });
  if (!mark || typeof mark !== 'object') return uncertain('No se pudo leer la marca.');
  if (mark.revisar === true || mark.legible === false) return uncertain('La marca no es legible con suficiente seguridad.');
  const signals = [];
  if (mark.estado != null) {
    const fromState = stateMarkedLetter(mark);
    const stateKeys = Object.keys(mark.estado || {}).map(letter);
    if (!fromState || Object.keys(options).some((key) => !stateKeys.includes(key))) {
      return uncertain('Hay opciones vacías, múltiples, incompletas o dudosas; revisa la marca.');
    }
    signals.push(fromState);
  }
  const fromLetter = letter(mark.letra_marcada);
  if (fromLetter) signals.push(fromLetter);
  if (hasText(mark.texto_marcado)) {
    const fromText = exactMarkedText(mark.texto_marcado, options);
    if (!fromText) return uncertain('El texto marcado no identifica una única opción completa.');
    signals.push(fromText);
  }
  // Una línea envuelta NO es otra opción; un recorte que empieza en B NO empieza en A.
  if (mark.fila_marcada != null) {
    const keys = Object.keys(options).sort();
    const completeSequence = keys.every((key, i) => key === letters[i]);
    if (mark.bloque_completo === true && mark.disposicion === 'vertical' && completeSequence) {
      if (!Number.isInteger(mark.fila_marcada) || mark.fila_marcada < 1 || mark.fila_marcada > keys.length) {
        return uncertain('La fila marcada está fuera del bloque de opciones.');
      }
      signals.push(letters[mark.fila_marcada - 1]);
    }
  }
  if (!signals.length) return uncertain('No se detectó una marca verificable.');
  if (signals.some((value) => value !== signals[0] || options[value] == null)) {
    return uncertain('La letra, la fila y el texto de la marca se contradicen.');
  }
  return { letter: signals[0], reason: '' };
}

export function assignVisualMarks(questions, marks) {
  const result = new Map();
  for (const mark of marks) {
    if (!mark || typeof mark !== 'object') continue;
    const hasId = mark.id != null && String(mark.id).trim() !== '';
    const candidates = questions.map((question, index) => ({ question, index })).filter(({ question }) =>
      hasId ? String(question.id) === String(mark.id) : Boolean(exactMarkedText(mark.texto_marcado, question.opciones)));
    // Nunca asignes un recorte sin identidad al primer texto repetido de la hoja.
    if (candidates.length !== 1) continue;
    const { question, index } = candidates[0];
    const next = resolveMarkEvidence(mark, question.opciones);
    const previous = result.get(index);
    result.set(index, previous && (!previous.letter || previous.letter !== next.letter)
      ? { letter: '', reason: 'Las lecturas de esta pregunta no coinciden; requiere revisión.' }
      : next);
  }
  return result;
}
