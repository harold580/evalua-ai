import test from 'node:test';
import assert from 'node:assert/strict';
import evaluate from '../api/evaluate.js';
import { repartirEnTandas } from '../src/services/payloadBudget.js';
import { fusionarResultados } from '../src/services/multiPageGrader.js';

let ip = 0;
const response = () => ({
  statusCode: 200, headers: {}, body: null,
  setHeader(name, value) { this.headers[name] = value; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }, end() { return this; },
});
const request = (body) => ({ method: 'POST', headers: {}, socket: { remoteAddress: `offline-${++ip}` }, body });

test('endpoint Vercel recibe las dos hojas y conserva la detección reforzada', async () => {
  const oldFetch = globalThis.fetch;
  const calls = [];
  process.env.OPENROUTER_API_KEY = 'test-only';
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    const prompt = body.messages[0].content;
    const preguntas = [1, 2].map(id => ({ id, pregunta: '2 + 2', opciones: { A: '3', B: '4', C: '5', D: '6' } }));
    const value = prompt.includes('sistema OCR') ? { nombreEstudiante: 'Prueba', preguntas }
      : prompt.includes('profesor que resuelve') ? { respuestas: [2, 1].map(id => ({ id, respuesta_correcta: '4' })) }
        : { preguntas: [
          { id: 1, letra_marcada: 'B', texto_marcado: '4' },
          { id: 2, letra_marcada: 'A', texto_marcado: '4' },
        ] };
    return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }) };
  };
  try {
    const res = response();
    await evaluate(request({ images: ['AA==', 'AQ=='] }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.totalPreguntas, 2);
    assert.equal(res.body.preguntas[0].correcta, true);
    assert.equal(res.body.preguntas[1].revisar, true);
    const images = calls[0].messages[1].content.filter(item => item.type === 'image_url');
    assert.deepEqual(images.map(item => item.image_url.url), ['data:image/jpeg;base64,AA==', 'data:image/jpeg;base64,AQ==']);
    assert.equal(calls.length, 3);
  } finally { globalThis.fetch = oldFetch; delete process.env.OPENROUTER_API_KEY; }
});

test('rechaza más de seis hojas, formatos inválidos y payload agregado excesivo antes de llamar IA', async () => {
  for (const [body, status] of [
    [{ images: Array(7).fill('AA==') }, 400],
    [{ images: ['AA==', {}] }, 400],
    [{ images: ['A'.repeat(2_000_000), 'A'.repeat(2_000_000)] }, 413],
  ]) {
    const res = response();
    await evaluate(request(body), res);
    assert.equal(res.statusCode, status);
  }
});

test('reparte las hojas en orden dentro del presupuesto', () => {
  const pages = ['A', 'B', 'C'].map(letter => letter.repeat(2_000_000));
  const batches = repartirEnTandas(pages);
  assert.equal(batches.length, 3);
  assert.deepEqual(batches.flat().map(page => page[0]), ['A', 'B', 'C']);
});

test('fusiona los resultados de tandas sin perder preguntas', () => {
  const result = fusionarResultados([
    { nombreEstudiante: 'Ana', preguntas: [{ id: 1, correcta: true, tema: 'Suma' }] },
    { nombreEstudiante: 'Ana', preguntas: [{ id: 2, correcta: false, tema: 'Suma' }] },
  ]);
  assert.equal(result.totalPreguntas, 2);
  assert.equal(result.preguntas.length, 2);
});
