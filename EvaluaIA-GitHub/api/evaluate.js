import { gradeExam } from './_gradePipeline.js';

// ── CORS — allowlist de orígenes, igual que en CardinalLabs (api/src/server.js) ──
// En vez de 'Access-Control-Allow-Origin: *', solo se permite el propio dominio
// de producción (o los que se listen en ALLOWED_ORIGIN, separados por coma).
// El frontend llama a /api/evaluate desde el mismo origen, así que esto no
// rompe nada: los navegadores no envían headers CORS en peticiones same-origin.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || 'https://evalua-ia-simple.vercel.app')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
}

// ── RATE LIMITER SERVER-SIDE — Token Bucket por IP ─────────────────────────
// Nota de arquitectura: en un servidor Node de larga duración (como el
// Fastify de CardinalLabs) esto es sólido porque el proceso vive entre
// peticiones. En una función serverless de Vercel el estado en memoria NO
// está garantizado entre invocaciones (cold starts, múltiples instancias
// concurrentes) — esto reduce el abuso automatizado en la práctica (Vercel
// reutiliza instancias "calientes" para ráfagas de tráfico) pero no es un
// límite duro. Para una garantía real bajo carga alta haría falta un store
// compartido (Vercel KV / Upstash Redis) — no se añade aquí para no
// introducir una dependencia/infra nueva sin que el usuario lo decida.
const ipBuckets = new Map();
// Calibrado para que un docente pueda calificar un curso entero sin que su
// propio trabajo parezca un ataque. Con 3 estudiantes en paralelo y ~15 s por
// estudiante, un lote consume unas 12 peticiones por minuto; este cubo permite
// 20/min con ráfagas de 10, así que deja pasar el uso legítimo y sigue cortando
// el abuso automatizado, que va mucho más rápido que eso.
const BUCKET_MAX_TOKENS = 10;
const REFILL_INTERVAL_MS = 3_000;

function getClientIp(req) {
  // Vercel es el único proxy delante de la función: el primer valor de
  // x-forwarded-for es la IP real del cliente que Vercel añadió en su edge
  // (no un valor que el cliente pueda forjar para saltarse esto), igual que
  // CardinalLabs confía en el primer hop de Traefik vía TRUST_PROXY=1.
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  if (!ipBuckets.has(ip)) {
    ipBuckets.set(ip, { tokens: BUCKET_MAX_TOKENS, lastRefill: now });
  }
  const bucket = ipBuckets.get(ip);
  const elapsed = now - bucket.lastRefill;
  const refillTokens = Math.floor(elapsed / REFILL_INTERVAL_MS);
  if (refillTokens > 0) {
    bucket.tokens = Math.min(BUCKET_MAX_TOKENS, bucket.tokens + refillTokens);
    bucket.lastRefill = now - (elapsed % REFILL_INTERVAL_MS);
  }
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, remaining: bucket.tokens };
  }
  return { allowed: false, retryAfter: Math.ceil(REFILL_INTERVAL_MS / 1000) };
}

// Valida que `image` sea realmente una cadena base64 de imagen razonable
// antes de reenviarla a OpenRouter — evita el type-confusion (objeto -> 500) y
// el relay de valores arbitrarios que no son imágenes.
const MAX_IMAGE_LENGTH = 3_500_000; // una sola hoja nunca puede pasar de esto
// Vercel corta el cuerpo de la petición en ~4.5 MB. Ese tope es de la PETICIÓN
// COMPLETA, no de cada imagen: si llegan 6 hojas, se suman las 6. El navegador
// ya reparte las hojas en tandas que quepan aquí (ver payloadBudget.js); esto es
// la red de seguridad del servidor por si llega una tanda mal calculada.
const MAX_PAYLOAD_LENGTH = 3_900_000;
const MAX_PAGINAS_POR_PETICION = 6;
const DATA_URL_RE = /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const BARE_BASE64_RE = /^[A-Za-z0-9+/=]+$/;

// Acepta tanto `image` (una hoja, como siempre) como `images` (varias hojas del
// mismo estudiante). Devuelve la lista normalizada.
function validatePaginas(body) {
  const lista = Array.isArray(body.images) && body.images.length
    ? body.images
    : [body.image];

  if (lista.length > MAX_PAGINAS_POR_PETICION) {
    return { valid: false, error: `Máximo ${MAX_PAGINAS_POR_PETICION} hojas por envío.` };
  }

  let total = 0;
  for (const img of lista) {
    const check = validateImageInput(img);
    if (!check.valid) return check;
    total += img.length;
  }
  if (total > MAX_PAYLOAD_LENGTH) {
    // 413 y no 400: el navegador lo distingue para partir la tanda y reintentar
    // en vez de darle un error al docente.
    return { valid: false, status: 413, error: 'El envío supera el tamaño máximo. Se reintentará en tandas más pequeñas.' };
  }
  return { valid: true, paginas: lista };
}

function validateImageInput(image) {
  if (typeof image !== 'string' || image.length === 0) {
    return { valid: false, error: 'La imagen del examen es obligatoria.' };
  }
  if (image.length > MAX_IMAGE_LENGTH) {
    return { valid: false, error: 'La imagen supera el tamaño máximo permitido.' };
  }
  if (image.startsWith('data:')) {
    if (!DATA_URL_RE.test(image)) {
      return { valid: false, error: 'Formato de imagen no soportado (se espera JPEG, PNG o WebP en base64).' };
    }
  } else if (!BARE_BASE64_RE.test(image)) {
    return { valid: false, error: 'La imagen debe estar codificada en base64.' };
  }
  return { valid: true };
}

// ── TIMEOUT PROPIO PARA LA LLAMADA A OPENROUTER ────────────────────────────
// Sin timeout, si el modelo se cuelga la función serverless queda esperando
// hasta que la plataforma la mate, sin devolver un error útil al usuario.
const OPENROUTER_TIMEOUT_MS = 35_000;

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const clientIp = getClientIp(req);
  const rate = checkRateLimit(clientIp);
  res.setHeader('X-RateLimit-Limit', BUCKET_MAX_TOKENS);
  if (!rate.allowed) {
    res.setHeader('Retry-After', rate.retryAfter);
    return res.status(429).json({
      error: '⚠️ Demasiadas peticiones. Intenta de nuevo en unos segundos.',
      retryAfterSeconds: rate.retryAfter
    });
  }
  res.setHeader('X-RateLimit-Remaining', rate.remaining);

  try {
    const imgCheck = validatePaginas(req.body || {});
    if (!imgCheck.valid) {
      return res.status(imgCheck.status || 400).json({ error: imgCheck.error });
    }

    // La credencial vive exclusivamente en el servidor. Nunca se acepta una
    // clave enviada por el navegador ni se incluye una clave de respaldo.
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();

    if (!apiKey) {
      return res.status(503).json({
        error: 'OpenRouter no está configurado en el servidor. Define OPENROUTER_API_KEY.'
      });
    }

    const paginas = imgCheck.paginas.map((img) =>
      img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`
    );

    // Pipeline de dos pasos (visión + razonamiento) con mapeo determinista en código.
    const result = await gradeExam({
      apiKey,
      imageUrls: paginas,
      fetchWithTimeout,
      timeoutMs: OPENROUTER_TIMEOUT_MS,
    });

    if (!result.ok) {
      return res.status(result.status || 502).json({ error: result.error || 'No se pudo evaluar el examen.' });
    }

    return res.status(200).json(result.data);
  } catch (error) {
    console.error('[evaluate] Error interno:', error?.name || 'Error');
    return res.status(500).json({ error: 'Ocurrió un error interno en la función serverless.' });
  }
}
