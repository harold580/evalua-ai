// ============================================================================
// Recorte de la imagen en franjas horizontales solapadas.
//
// Por qué existe: los modelos de visión reducen internamente la imagen antes de
// analizarla. En una foto de página completa (1200x1600) la burbuja de respuesta
// queda de unos pocos píxeles y la marca desaparece. Medido sobre una foto real
// con una burbuja rellena inequívoca (P31, opción D):
//   - foto completa  -> el modelo multimodal acertó 2/6 (se desplazaba una letra)
//   - recorte + zoom -> el mismo modelo acertó 4/4 en 1,3 s
// Por eso el paso de MARCA no analiza la foto entera sino franjas ampliadas.
//
// Se usa jpeg-js (JavaScript puro, sin binarios nativos) para que siga
// funcionando en las funciones serverless de Vercel sin configuración extra.
// ============================================================================

import jpeg from 'jpeg-js';

const MAX_DECODE_PIXELS = 40_000_000; // tope defensivo de memoria

/** Convierte un data URL o base64 pelado en Buffer. */
function toBuffer(imageUrl) {
  const base64 = imageUrl.startsWith('data:') ? imageUrl.split(',')[1] : imageUrl;
  return Buffer.from(base64, 'base64');
}

/**
 * Divide la imagen en franjas horizontales solapadas y las devuelve como data URLs.
 * El solape evita que una pregunta quede partida entre dos franjas.
 *
 * @param {string} imageUrl  data URL (o base64) de un JPEG
 * @param {object} opts      { tiles = 3, overlap = 0.18, scale = 2 }
 * @returns {string[]} data URLs de cada franja; [] si no se pudo procesar
 */
export function sliceIntoTiles(imageUrl, opts = {}) {
  const { tiles = 3, overlap = 0.18, scale = 2 } = opts;
  let img;
  try {
    img = jpeg.decode(toBuffer(imageUrl), { useTArray: true, maxMemoryUsageInMB: 512 });
  } catch {
    return []; // PNG u otro formato: el llamador se queda con la imagen completa
  }
  if (!img || !img.width || !img.height) return [];
  if (img.width * img.height > MAX_DECODE_PIXELS) return [];

  const { width, height, data } = img;
  const bandaBase = Math.floor(height / tiles);
  const margen = Math.floor(bandaBase * overlap);
  const salida = [];

  for (let i = 0; i < tiles; i++) {
    const y0 = Math.max(0, i * bandaBase - margen);
    const y1 = Math.min(height, (i + 1) * bandaBase + margen);
    const alto = y1 - y0;
    if (alto <= 0) continue;

    // Ampliar por duplicación de píxeles (vecino más cercano): suficiente para
    // que la marca gane tamaño y no requiere librería de reescalado.
    const zoom = Math.max(1, Math.floor(scale));
    const outW = width * zoom;
    const outH = alto * zoom;
    const out = Buffer.alloc(outW * outH * 4);

    for (let y = 0; y < outH; y++) {
      const srcY = y0 + Math.floor(y / zoom);
      const filaSrc = srcY * width * 4;
      const filaDst = y * outW * 4;
      for (let x = 0; x < outW; x++) {
        const srcX = Math.floor(x / zoom);
        const s = filaSrc + srcX * 4;
        const d = filaDst + x * 4;
        out[d] = data[s];
        out[d + 1] = data[s + 1];
        out[d + 2] = data[s + 2];
        out[d + 3] = 255;
      }
    }

    try {
      const jpg = jpeg.encode({ data: out, width: outW, height: outH }, 88);
      salida.push(`data:image/jpeg;base64,${jpg.data.toString('base64')}`);
    } catch {
      // Si una franja falla, se continúa con las demás.
    }
  }
  return salida;
}
