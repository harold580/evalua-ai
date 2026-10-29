import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { callOpenRouterChat } from '../api/_openRouter.js';
import { VISION_TEXT_SYSTEM, VISION_USER_TEXT } from '../api/_gradePipeline.js';

const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey) throw new Error('Falta OPENROUTER_API_KEY en .env.');

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

const result = await callOpenRouterChat({
  apiKey,
  model: 'openai/gpt-6-luna',
  messages: [
    { role: 'developer', content: VISION_TEXT_SYSTEM },
    { role: 'user', content: [
      { type: 'text', text: VISION_USER_TEXT },
      { type: 'image_url', image_url: { url: imageUrl } },
    ] },
  ],
  maxTokens: 4_000,
  reasoningEffort: 'medium',
  fetchWithTimeout,
  timeoutMs: 60_000,
  maxRetries: 0,
});

if (result.ok) {
  console.log(JSON.stringify({
    ok: true,
    model: result.model,
    hasContent: Boolean(result.content),
  }));
} else {
  console.log(JSON.stringify({
    ok: false,
    status: result.status,
    networkError: Boolean(result.networkError),
    timedOut: Boolean(result.timedOut),
    upstreamCode: result.upstreamCode,
    upstreamProvider: result.upstreamProvider,
    upstreamMessage: result.upstreamMessage,
    upstreamRaw: result.upstreamRaw,
    requestId: result.requestId || result.generationId,
  }));
  process.exitCode = 1;
}
