import { getOpenRouterSettings } from './_openRouter.js';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || 'https://evalua-ia-simple.vercel.app')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export default function handler(req, res) {
  // CORS restringido a la allowlist (ver api/evaluate.js para el detalle) en
  // vez de 'Access-Control-Allow-Origin: *'.
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const settings = getOpenRouterSettings();
  res.status(200).json({
    hasServerKey: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    nodeEnv: process.env.NODE_ENV || 'production',
    provider: 'OpenRouter',
    model: settings.model,
  });
}
