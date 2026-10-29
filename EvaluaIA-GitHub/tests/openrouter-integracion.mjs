import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_OPENROUTER_MODEL,
  buildOpenRouterBody,
  buildOpenRouterHeaders,
  callOpenRouterChat,
  getOpenRouterSettings,
  openRouterError,
} from '../api/_openRouter.js';
import { gradeExam, PIPELINE_AI_MODEL } from '../api/_gradePipeline.js';
import configHandler from '../api/config.js';
import evaluateHandler from '../api/evaluate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(path);
    return /\.(?:js|jsx|mjs)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

function mockCompletion(content, extras = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model: 'openai/gpt-6-luna',
      choices: [{
        finish_reason: extras.finishReason || 'stop',
        message: { content },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  };
}

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

test('la configuración predeterminada usa OpenRouter y GPT-6 Luna', () => {
  const settings = getOpenRouterSettings({});
  assert.equal(DEFAULT_OPENROUTER_MODEL, 'openai/gpt-6-luna');
  assert.equal(PIPELINE_AI_MODEL, 'openai/gpt-6-luna');
  assert.equal(settings.model, 'openai/gpt-6-luna');
  assert.equal(settings.chatUrl, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(settings.reasoningEffort, 'medium');
});

test('el payload de GPT-6 Luna contiene solo parámetros compatibles', () => {
  const body = buildOpenRouterBody({
    messages: [{ role: 'developer', content: 'Devuelve JSON.' }],
    maxTokens: 4_000,
    env: {},
  });

  assert.equal(body.model, 'openai/gpt-6-luna');
  assert.equal(body.max_tokens, 4_000);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.deepEqual(body.reasoning, { effort: 'medium', exclude: true });
  assert.equal(Object.hasOwn(body, 'temperature'), false);
  assert.equal(Object.hasOwn(body, 'top_p'), false);
});

test('las cabeceras usan Bearer sin exponer metadatos vacíos', () => {
  const headers = buildOpenRouterHeaders('sk-or-test', {
    OPENROUTER_SITE_URL: 'https://evalua.example',
    OPENROUTER_APP_NAME: 'EvaluaIA Test',
  });

  assert.equal(headers.Authorization, 'Bearer sk-or-test');
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers['HTTP-Referer'], 'https://evalua.example');
  assert.equal(headers['X-OpenRouter-Title'], 'EvaluaIA Test');
  assert.equal(headers['X-OpenRouter-Metadata'], 'enabled');
});

test('callOpenRouterChat respeta URL, modelo, rol developer e imagen base64', async () => {
  let request;
  const result = await callOpenRouterChat({
    apiKey: 'sk-or-test',
    messages: [
      { role: 'developer', content: 'Analiza la imagen.' },
      { role: 'user', content: [
        { type: 'text', text: 'Devuelve JSON.' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA==' } },
      ] },
    ],
    maxTokens: 2_000,
    timeoutMs: 1_000,
    maxRetries: 0,
    env: {},
    fetchWithTimeout: async (url, options, timeoutMs) => {
      request = { url, options, timeoutMs };
      return mockCompletion('{"ok":true}');
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.content, '{"ok":true}');
  assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(request.timeoutMs, 1_000);
  assert.equal(request.options.headers.Authorization, 'Bearer sk-or-test');
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, 'openai/gpt-6-luna');
  assert.equal(body.messages[0].role, 'developer');
  assert.match(body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal(Object.hasOwn(body, 'temperature'), false);
  assert.equal(Object.hasOwn(body, 'top_p'), false);
});

test('reintenta un error transitorio y detecta salida truncada', async () => {
  let attempts = 0;
  const recovered = await callOpenRouterChat({
    apiKey: 'sk-or-test',
    messages: [{ role: 'user', content: 'JSON' }],
    maxTokens: 1_000,
    timeoutMs: 1_000,
    retryDelayMs: 0,
    env: {},
    fetchWithTimeout: async () => {
      attempts += 1;
      return attempts === 1
        ? { ok: false, status: 503 }
        : mockCompletion('{"ok":true}');
    },
  });
  assert.equal(recovered.ok, true);
  assert.equal(attempts, 2);

  const truncated = await callOpenRouterChat({
    apiKey: 'sk-or-test',
    messages: [{ role: 'user', content: 'JSON' }],
    maxTokens: 10,
    timeoutMs: 1_000,
    maxRetries: 0,
    env: {},
    fetchWithTimeout: async () => mockCompletion('{"incompleto":', { finishReason: 'length' }),
  });
  assert.equal(truncated.ok, false);
  assert.equal(truncated.truncated, true);
});

test('el pipeline completo usa GPT-6 Luna en visión, marcas y razonamiento', async () => {
  const requests = [];
  const fetchWithTimeout = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, headers: options.headers, body });
    const instruction = body.messages[0]?.content || '';

    if (instruction.includes('sistema OCR')) {
      return mockCompletion(JSON.stringify({
        nombreEstudiante: 'Ana',
        preguntas: [{
          id: 1,
          contexto: '',
          pregunta: '¿Cuánto es 2 + 2?',
          opciones: { A: '3', B: '4', C: '5', D: '6' },
        }],
      }));
    }
    if (instruction.includes('examina que respuesta eligio')) {
      return mockCompletion(JSON.stringify({
        preguntas: [{
          id: 1,
          estado: { A: 'vacia', B: 'marcada', C: 'vacia', D: 'vacia' },
          letra_marcada: 'B',
          texto_marcado: '4',
        }],
      }));
    }
    if (instruction.includes('profesor que resuelve')) {
      return mockCompletion(JSON.stringify({
        respuestas: [{ id: 1, respuesta_correcta: '4', por_que: '2 + 2 = 4' }],
      }));
    }
    throw new Error(`Prompt inesperado: ${instruction.slice(0, 50)}`);
  };

  const result = await gradeExam({
    apiKey: 'sk-or-test',
    imageUrl: 'data:image/jpeg;base64,AA==',
    fetchWithTimeout,
    timeoutMs: 1_000,
    budgetMs: 50_000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.nombreEstudiante, 'Ana');
  assert.equal(result.data.totalPreguntas, 1);
  assert.equal(result.data.preguntas[0].correcta, true);
  assert.equal(requests.length, 3);
  assert.deepEqual(new Set(requests.map((request) => request.body.model)), new Set(['openai/gpt-6-luna']));
  for (const request of requests) {
    assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(request.headers.Authorization, 'Bearer sk-or-test');
    assert.equal(request.body.messages[0].role, 'developer');
    assert.equal(Object.hasOwn(request.body, 'temperature'), false);
    assert.equal(Object.hasOwn(request.body, 'top_p'), false);
  }
});

test('el pipeline reintenta una sola vez un 502 real del proveedor', async () => {
  const attempts = new Map();
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';

  try {
    const fetchWithTimeout = async (_url, options) => {
      const body = JSON.parse(options.body);
      const instruction = body.messages[0]?.content || '';
      const label = instruction.includes('sistema OCR')
        ? 'ocr'
        : instruction.includes('examina que respuesta eligio')
          ? 'mark'
          : 'reason';
      attempts.set(label, (attempts.get(label) || 0) + 1);

      if (label !== 'reason' && attempts.get(label) === 1) {
        return {
          ok: false,
          status: 502,
          headers: { get: (name) => name.toLowerCase() === 'x-request-id' ? `req-${label}` : null },
          json: async () => ({ error: { code: 502, message: 'Provider returned an error' } }),
        };
      }

      if (label === 'ocr') {
        return mockCompletion(JSON.stringify({
          nombreEstudiante: 'Ana',
          preguntas: [{
            id: 1,
            pregunta: '¿Cuánto es 2 + 2?',
            opciones: { A: '3', B: '4', C: '5', D: '6' },
          }],
        }));
      }
      if (label === 'mark') {
        return mockCompletion(JSON.stringify({
          preguntas: [{ id: 1, letra_marcada: 'B', texto_marcado: '4' }],
        }));
      }
      return mockCompletion(JSON.stringify({
        respuestas: [{ id: 1, respuesta_correcta: '4', por_que: '2 + 2 = 4' }],
      }));
    };

    const result = await gradeExam({
      apiKey: 'sk-or-test',
      imageUrl: 'data:image/jpeg;base64,AA==',
      fetchWithTimeout,
      timeoutMs: 1_000,
      budgetMs: 50_000,
    });

    assert.equal(result.ok, true);
    assert.equal(attempts.get('ocr'), 2);
    assert.equal(attempts.get('mark'), 2);
    assert.equal(attempts.get('reason'), 1);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('el pipeline no inicia llamadas si no queda presupuesto seguro', async () => {
  let requests = 0;
  const result = await gradeExam({
    apiKey: 'sk-or-test',
    imageUrl: 'data:image/jpeg;base64,AA==',
    fetchWithTimeout: async () => {
      requests += 1;
      return mockCompletion('{}');
    },
    timeoutMs: 35_000,
    budgetMs: 5_000,
  });

  assert.equal(requests, 0);
  assert.equal(result.ok, false);
  assert.equal(result.status, 504);
});

test('el pipeline no duplica la llamada al agotarse el timeout de visión', async () => {
  let requests = 0;
  const result = await gradeExam({
    apiKey: 'sk-or-test',
    imageUrl: 'data:image/jpeg;base64,AA==',
    fetchWithTimeout: async () => {
      requests += 1;
      const error = new Error('timeout simulado');
      error.name = 'AbortError';
      throw error;
    },
    timeoutMs: 1_000,
    budgetMs: 20_000,
  });

  assert.equal(requests, 1, 'solo debe ejecutarse la transcripción inicial');
  assert.equal(result.ok, false);
  assert.equal(result.status, 504);
});

test('los handlers no aceptan claves del navegador y reportan servidor sin configurar', async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const configRes = mockResponse();
    configHandler({ method: 'GET', headers: {} }, configRes);
    assert.equal(configRes.statusCode, 200);
    assert.equal(configRes.body.hasServerKey, false);
    assert.equal(configRes.body.model, 'openai/gpt-6-luna');
    assert.equal(configRes.headers['Cache-Control'], 'no-store');

    const evaluateRes = mockResponse();
    await evaluateHandler({
      method: 'POST',
      headers: {},
      socket: { remoteAddress: 'test-openrouter-no-key' },
      body: { image: 'AA==', clientKey: 'no-debe-usarse' },
    }, evaluateRes);
    assert.equal(evaluateRes.statusCode, 503);
    assert.match(evaluateRes.body.error, /OPENROUTER_API_KEY/);
  } finally {
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test('mensajes de error de OpenRouter cubren autenticación, créditos y límites', () => {
  assert.match(openRouterError(401), /API Key/);
  assert.match(openRouterError(402), /saldo/);
  assert.match(openRouterError(429), /Límite/);
  assert.match(openRouterError(529), /OpenRouter/);
});

test('no quedan proveedores anteriores ni secretos de IA en el navegador', async () => {
  const browserFiles = await collectJavaScriptFiles(join(ROOT, 'src'));
  const serverFiles = await collectJavaScriptFiles(join(ROOT, 'api'));
  const browserSource = (await Promise.all(browserFiles.map((file) => readFile(file, 'utf8')))).join('\n');
  const source = [
    browserSource,
    ...(await Promise.all(serverFiles.map((file) => readFile(file, 'utf8')))),
    await readFile(join(ROOT, 'server.js'), 'utf8'),
  ].join('\n');

  assert.doesNotMatch(source, /integrate\.api\.nvidia\.com/i);
  assert.doesNotMatch(source, /meta\/llama|gpt-oss/i);
  assert.doesNotMatch(source, /nvapi-[A-Za-z0-9_-]+/);
  assert.doesNotMatch(source, /clientKey\s*[:=]/);
  assert.doesNotMatch(browserSource, /localStorage|sessionStorage/);
  assert.doesNotMatch(browserSource, /import\.meta\.env\.[A-Z0-9_]*(?:KEY|TOKEN|SECRET)/i);
});
