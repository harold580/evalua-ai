
export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-6-luna';
export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const VALID_REASONING_EFFORTS = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

const TRANSIENT_STATUS_CODES = new Set([408, 409, 429, 502, 503, 504, 524, 529]);

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

export function getOpenRouterSettings(env = process.env) {
  const baseUrl = (clean(env.OPENROUTER_BASE_URL) || DEFAULT_OPENROUTER_BASE_URL)
    .replace(/\/+$/, '');
  const requestedEffort = clean(env.OPENROUTER_REASONING_EFFORT).toLowerCase();

  return {
    baseUrl,
    chatUrl: `${baseUrl}/chat/completions`,
    model: clean(env.OPENROUTER_MODEL) || DEFAULT_OPENROUTER_MODEL,
    reasoningEffort: VALID_REASONING_EFFORTS.has(requestedEffort)
      ? requestedEffort
      : 'medium',
    siteUrl: clean(env.OPENROUTER_SITE_URL),
    appName: clean(env.OPENROUTER_APP_NAME) || 'EvaluaIA',
  };
}

export function buildOpenRouterHeaders(apiKey, env = process.env) {
  const settings = getOpenRouterSettings(env);
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'X-OpenRouter-Title': settings.appName,
    // OpenRouter incluye contexto de enrutamiento en errores 5xx cuando se
    // solicita explícitamente. Nunca se reenvía al navegador ni contiene la key.
    'X-OpenRouter-Metadata': 'enabled',
  };

  if (settings.siteUrl) headers['HTTP-Referer'] = settings.siteUrl;
  return headers;
}

export function buildOpenRouterBody({
  model,
  messages,
  maxTokens,
  reasoningEffort,
  responseFormat = { type: 'json_object' },
  env = process.env,
}) {
  const settings = getOpenRouterSettings(env);
  const effort = VALID_REASONING_EFFORTS.has(reasoningEffort)
    ? reasoningEffort
    : settings.reasoningEffort;

  return {
    model: clean(model) || settings.model,
    messages,
    max_tokens: maxTokens,
    reasoning: {
      effort,
      // Los modelos o-series no exponen su cadena de pensamiento. Este campo
      // mantiene además la respuesta limitada al JSON útil para la aplicación.
      exclude: true,
    },
    response_format: responseFormat,
  };
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
    .join('');
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readFailureDetails(response) {
  let payload;
  try {
    payload = typeof response?.json === 'function' ? await response.json() : null;
  } catch {
    payload = null;
  }

  const upstreamMessage = clean(payload?.error?.message).slice(0, 240);
  const upstreamCode = payload?.error?.code ?? response?.status;
  const upstreamProvider = clean(payload?.error?.metadata?.provider_name).slice(0, 80);
  const rawValue = payload?.error?.metadata?.raw;
  let upstreamRaw;
  try {
    upstreamRaw = typeof rawValue === 'string'
      ? rawValue
      : rawValue == null ? '' : JSON.stringify(rawValue);
  } catch {
    upstreamRaw = '';
  }
  upstreamRaw = upstreamRaw
    .replace(/\b(?:sk|nvapi)-[A-Za-z0-9_-]{8,}\b/gi, '[redacted]')
    .slice(0, 600);
  const header = (name) => {
    try {
      return clean(response?.headers?.get?.(name));
    } catch {
      return '';
    }
  };

  return {
    upstreamCode,
    upstreamMessage,
    upstreamProvider,
    upstreamRaw,
    requestId: header('x-request-id'),
    generationId: header('x-generation-id'),
  };
}

/**
 * Ejecuta una llamada OpenAI-compatible contra OpenRouter.
 * `fetchWithTimeout` se inyecta para compartir el timeout del servidor y para
 * poder probar el contrato HTTP sin consumir créditos.
 */
export async function callOpenRouterChat({
  apiKey,
  model,
  messages,
  maxTokens,
  fetchWithTimeout,
  timeoutMs,
  reasoningEffort,
  responseFormat,
  env = process.env,
  maxRetries = 1,
  retryDelayMs = 1_500,
}) {
  const settings = getOpenRouterSettings(env);
  const body = JSON.stringify(buildOpenRouterBody({
    model,
    messages,
    maxTokens,
    reasoningEffort,
    responseFormat,
    env,
  }));

  let response;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      response = await fetchWithTimeout(settings.chatUrl, {
        method: 'POST',
        headers: buildOpenRouterHeaders(apiKey, env),
        body,
      }, timeoutMs);
    } catch (error) {
      const canRetry = attempt < maxRetries;
      if (canRetry) {
        if (retryDelayMs > 0) await wait(retryDelayMs * (attempt + 1));
        continue;
      }
      return {
        ok: false,
        status: error?.name === 'AbortError' ? 504 : 502,
        timedOut: error?.name === 'AbortError',
        networkError: error?.name !== 'AbortError',
      };
    }

    if (!TRANSIENT_STATUS_CODES.has(response.status) || attempt >= maxRetries) break;
    if (retryDelayMs > 0) await wait(retryDelayMs * (attempt + 1));
  }

  if (!response?.ok) {
    return {
      ok: false,
      status: response?.status || 502,
      ...(await readFailureDetails(response)),
    };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, status: 502, invalidJson: true };
  }

  const choice = data?.choices?.[0];
  const content = contentToText(choice?.message?.content);
  if (choice?.finish_reason === 'length') {
    return {
      ok: false,
      status: 502,
      truncated: true,
      content,
      model: data.model || model || settings.model,
      usage: data.usage,
    };
  }
  if (!content) return { ok: false, status: 502, noContent: true };

  return {
    ok: true,
    status: 200,
    content,
    model: data.model || model || settings.model,
    usage: data.usage,
  };
}

export function openRouterError(status, details = {}) {
  if (details.networkError) return 'El servidor no pudo conectarse con OpenRouter. Revisa la conexión de red e intenta de nuevo.';
  if (details.timedOut) return 'La conexión con OpenRouter agotó el tiempo de espera. Intenta de nuevo.';
  if (status === 400) return 'OpenRouter rechazó la configuración de la solicitud. Revisa el modelo y sus parámetros.';
  if (status === 401 || status === 403) return 'API Key inválida, expirada o sin acceso al modelo configurado en OpenRouter.';
  if (status === 402) return 'La cuenta de OpenRouter no tiene saldo suficiente para usar el modelo configurado.';
  if (status === 408 || status === 504) return 'OpenRouter tardó demasiado en responder. Intenta de nuevo.';
  if (status === 429) return 'Límite de peticiones de OpenRouter alcanzado. Intenta en unos segundos.';
  if ([502, 503, 524, 529].includes(status)) return `OpenRouter está temporalmente no disponible (${status}). Intenta de nuevo.`;
  return `Error en OpenRouter (código ${status}).`;
}
