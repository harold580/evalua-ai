import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { callOpenRouterChat, DEFAULT_OPENROUTER_MODEL } from '../api/_openRouter.js';

const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey) {
  throw new Error('Falta OPENROUTER_API_KEY. Configúrala en .env para ejecutar la prueba live.');
}

assert.equal(
  process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL,
  'openai/gpt-6-luna',
  'La prueba live exige OPENROUTER_MODEL=openai/gpt-6-luna',
);

const here = dirname(fileURLToPath(import.meta.url));
const image = await readFile(join(here, 'imagenes', 'marca_B.jpg'));
const imageUrl = `data:image/jpeg;base64,${image.toString('base64')}`;

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const startedAt = Date.now();
const result = await callOpenRouterChat({
  apiKey,
  model: 'openai/gpt-6-luna',
  messages: [
    {
      role: 'developer',
      content: 'Analiza la imagen y responde exclusivamente un objeto JSON válido con el formato {"letra":"A"}.',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'La imagen tiene cuatro burbujas A, B, C y D. ¿Cuál está rellena? Devuelve solo el JSON.' },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    },
  ],
  maxTokens: 3_000,
  reasoningEffort: 'medium',
  fetchWithTimeout,
  timeoutMs: 60_000,
  maxRetries: 0,
});

assert.equal(result.ok, true, `OpenRouter respondió con error ${result.status}`);
assert.match(result.model || '', /gpt-6-luna/i);
const parsed = JSON.parse(result.content);
assert.equal(String(parsed.letra || '').toUpperCase(), 'B');

console.log(`✓ OpenRouter respondió con ${result.model} en ${Date.now() - startedAt} ms.`);
console.log('✓ La entrada de imagen, el modo JSON y la detección visual funcionan.');
