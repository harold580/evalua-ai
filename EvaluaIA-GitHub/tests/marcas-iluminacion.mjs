import test from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { detectarBurbujaMarcada } from '../api/_bubbleDetect.js';
import { assignVisualMarks, resolveMarkEvidence, stateMarkedLetter } from '../api/_markEvidence.js';
import { gradeExam } from '../api/_gradePipeline.js';

const options = { A: '3', B: '4', C: '5', D: '6' };
function sheet({ selected = null, gray = 70, light = 1, shadow = null } = {}) {
  const width = 300, height = 360;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let rgb = [245, 245, 245];
    for (let index = 0; index < 4; index++) {
      if ((x - 70) ** 2 + (y - (80 + index * 50)) ** 2 <= 12 ** 2) {
        rgb = index === selected ? [gray, gray, gray] : [65, 125, 210];
      }
    }
    const factor = light * (shadow != null && Math.abs(y - (80 + shadow * 50)) < 24 ? 0.5 : 1);
    const offset = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) data[offset + c] = Math.round(rgb[c] * factor);
    data[offset + 3] = 255;
  }
  return 'data:image/jpeg;base64,' + jpeg.encode({ data, width, height }, 95).data.toString('base64');
}

test('segunda opción B en negro y gris con luz normal y tenue', () => {
  for (const gray of [20, 70, 150]) for (const light of [1, 0.65, 0.45]) {
    const detected = detectarBurbujaMarcada(sheet({ selected: 1, gray, light }));
    assert.equal(detected.length, 1, JSON.stringify({ gray, light, detected }));
    assert.equal(detected[0].letra, 'B');
    assert.equal(detected[0].total, 4);
  }
});

test('las sombras sobre opciones sin marcar no son respuestas', () => {
  for (const light of [1, 0.65, 0.45]) for (const shadow of [null, 0, 1, 2, 3]) {
    assert.deepEqual(detectarBurbujaMarcada(sheet({ light, shadow })), [], JSON.stringify({ light, shadow }));
  }
});

test('conserva B bajo una sombra local; oscuridad extrema requiere respaldo', () => {
  assert.equal(detectarBurbujaMarcada(sheet({ selected: 1, shadow: 1 }))[0]?.letra, 'B');
  assert.deepEqual(detectarBurbujaMarcada(sheet({ selected: 1, light: 0.1 })), []);
});

test('no marcada, dudosa, múltiples y estados incompletos nunca se fuerzan con texto', () => {
  assert.equal(stateMarkedLetter({ estado: { A: 'vacia', B: 'no marcada' } }), '');
  for (const estado of [
    { A: 'vacia', B: 'vacia', C: 'vacia', D: 'vacia' },
    { A: 'marcada', B: 'marcada', C: 'vacia', D: 'vacia' },
    { A: 'vacia', B: 'marcada', C: 'dudosa', D: 'vacia' },
    { B: 'marcada' },
  ]) assert.equal(resolveMarkEvidence({ estado, letra_marcada: 'B', texto_marcado: '4' }, options).letter, '');
});

test('fila 2 es B únicamente en bloque vertical completo; contradicciones se revisan', () => {
  const mark = { fila_marcada: 2, disposicion: 'vertical', bloque_completo: true, texto_marcado: '4' };
  assert.equal(resolveMarkEvidence(mark, options).letter, 'B');
  assert.equal(resolveMarkEvidence({ ...mark, letra_marcada: 'A' }, options).letter, '');
  assert.equal(resolveMarkEvidence({ ...mark, texto_marcado: '5' }, options).letter, '');
  assert.equal(resolveMarkEvidence({ fila_marcada: 2, bloque_completo: false }, options).letter, '');
  assert.equal(resolveMarkEvidence({ texto_marcado: '3' }, { A: '30', B: '13' }).letter, '');
});

test('recortes solapados no desplazan textos repetidos a otras preguntas', () => {
  const questions = [{ id: 1, opciones: options }, { id: 2, opciones: options }];
  assert.equal(assignVisualMarks(questions, [{ texto_marcado: '4' }]).size, 0);
  const mapped = assignVisualMarks(questions, [{ id: 2, texto_marcado: '4' }, { id: 2, texto_marcado: '4' }]);
  assert.equal(mapped.has(0), false);
  assert.equal(mapped.get(1).letter, 'B');
  assert.equal(assignVisualMarks(questions, [{ id: 2, texto_marcado: '4' }, { id: 2, texto_marcado: '5' }]).get(1).letter, '');
});

async function run({ questions = [{ id: 1, pregunta: '2 + 2', opciones: options }], marks, answers, imageUrl, imageUrls }) {
  const requests = [];
  const result = await gradeExam({
    apiKey: 'test-only', imageUrl: imageUrl || 'data:image/jpeg;base64,AA==', imageUrls,
    timeoutMs: 1000, budgetMs: 50000,
    fetchWithTimeout: async (_url, request) => {
      const body = JSON.parse(request.body);
      requests.push(body);
      const prompt = body.messages[0].content;
      const content = prompt.includes('sistema OCR') ? { preguntas: questions }
        : prompt.includes('profesor que resuelve') ? { respuestas: answers }
          : { preguntas: marks };
      return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }) };
    },
  });
  return { result, requests };
}

test('calificación conserva B detectada aunque la solución independiente sea C', async () => {
  const { result, requests } = await run({
    marks: [{ id: 1, texto_marcado: '4', fila_marcada: 2, disposicion: 'vertical', bloque_completo: true }],
    answers: [{ id: 1, respuesta_correcta: '5' }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.preguntas[0].correcta, false);
  assert.equal(result.data.preguntas[0].revisar, false);
  assert.match(result.data.preguntas[0].comentario, /marcó B/);
  const reasoning = requests.find((r) => r.messages[0].content.includes('profesor que resuelve'));
  assert.doesNotMatch(JSON.stringify(reasoning.messages[1]), /marcada|fila_marcada|texto_marcado|image_url/);
});

test('pipeline respeta ids de soluciones devueltas en orden inverso', async () => {
  const { result } = await run({
    questions: [{ id: 31, pregunta: 'uno', opciones: options }, { id: 65, pregunta: 'dos', opciones: options }],
    marks: [{ id: 65, texto_marcado: '5' }, { id: 31, texto_marcado: '4' }],
    answers: [{ id: 65, respuesta_correcta: '5' }, { id: 31, respuesta_correcta: '4' }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.preguntas.map((p) => p.correcta), [true, true]);
});

test('marcas ambiguas y soluciones sin correspondencia requieren revisión', async () => {
  for (const marks of [
    [{ id: 1, estado: { A: 'marcada', B: 'marcada', C: 'vacia', D: 'vacia' }, texto_marcado: '4' }],
    [{ id: 1, estado: { A: 'vacia', B: 'vacia', C: 'vacia', D: 'vacia' }, texto_marcado: '4' }],
    [{ id: 1, letra_marcada: 'A', texto_marcado: '4' }],
  ]) {
    const { result } = await run({ marks, answers: [{ id: 1, respuesta_correcta: '4' }] });
    assert.equal(result.data.preguntas[0].revisar, true);
    assert.equal(result.data.preguntas[0].correcta, false);
  }
  const { result } = await run({ marks: [{ id: 1, texto_marcado: '4' }], answers: [{ id: 1, respuesta_correcta: '99' }] });
  assert.equal(result.data.preguntas[0].revisar, true);
});

test('una detección de píxeles parcial no bloquea la lectura de las demás preguntas', async () => {
  const { result, requests } = await run({
    imageUrls: [sheet({ selected: 1 }), 'data:image/jpeg;base64,AA=='],
    questions: [{ id: 1, pregunta: 'uno', opciones: options }, { id: 2, pregunta: 'dos', opciones: options }],
    marks: [{ id: 1, texto_marcado: '4' }, { id: 2, texto_marcado: '5' }],
    answers: [{ id: 1, respuesta_correcta: '4' }, { id: 2, respuesta_correcta: '5' }],
  });
  assert.equal(result.ok, true);
  assert.ok(requests.some((r) => r.messages[0].content.includes('examina que respuesta eligio')));
  assert.deepEqual(result.data.preguntas.map((p) => p.correcta), [true, true]);
});
