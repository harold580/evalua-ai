// Comprobación local de captura. No envía fotogramas a la IA ni guarda video.
// El encuadre es orientativo. Solo la falta de detalle/luz bloquea la captura.
// Es una estimación local de calidad, no un reconocimiento del texto.
export const SAMPLE_SIZE = 480;
export const SAMPLE_INTERVAL = 200;
export const MAX_FRAME_AGE = 1200;

export function pageGuide(width, height, horizontal = false) {
  const ratio = width / height;
  const pageRatio = horizontal ? 297 / 210 : 210 / 297;
  const w = Math.min(0.9, 0.9 * pageRatio / ratio);
  const h = w * ratio / pageRatio;
  return { x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h };
}

const fail = (code, message, extra = {}) => ({ valid: false, code, message, ...extra });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const polygonArea = (points) => Math.abs(points.reduce((sum, p, i) => {
  const next = points[(i + 1) % points.length];
  return sum + p.x * next.y - next.x * p.y;
}, 0)) / 2;

function otsu(histogram, count) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += histogram[i] * i;
  let weight = 0, accumulated = 0, best = -1, threshold = 128;
  for (let i = 0; i < 255; i++) {
    weight += histogram[i]; accumulated += histogram[i] * i;
    if (!weight || weight === count) continue;
    const delta = accumulated / weight - (sum - accumulated) / (count - weight);
    const score = weight * (count - weight) * delta * delta;
    if (score > best) { best = score; threshold = i; }
  }
  return threshold;
}

function pointToEdge(p, a, b) {
  const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (!lengthSquared) return Infinity;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / lengthSquared));
  return Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y));
}

/** ImageData ya reducido a un máximo de SAMPLE_SIZE en cada lado. */
function analyzeFraming({ data, width, height }, horizontal = false) {
  if (!data || width < 80 || height < 80 || data.length !== width * height * 4) {
    return fail('waiting', 'Esperando imagen de la cámara…');
  }
  const count = width * height;
  const gray = new Uint8Array(count);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    const value = Math.round(data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114);
    gray[i] = value; histogram[value]++;
  }
  let percentile = 0, seen = 0;
  for (; percentile < 255; percentile++) { seen += histogram[percentile]; if (seen >= count * 0.95) break; }
  if (percentile < 115) return fail('dark', 'Falta luz. Ilumina la hoja sin crear sombras.');

  const threshold = Math.max(110, Math.min(220, otsu(histogram, count) + 12));
  const mask = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    const spread = Math.max(data[p], data[p + 1], data[p + 2]) - Math.min(data[p], data[p + 1], data[p + 2]);
    mask[i] = gray[i] >= threshold && spread < 85 ? 1 : 0;
  }
  // Componentes conexas: el texto oscuro deja huecos dentro del papel blanco.
  const queue = new Int32Array(count);
  let best = null;
  for (let start = 0; start < count; start++) {
    if (!mask[start]) continue;
    let head = 0, tail = 1;
    queue[0] = start; mask[start] = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    let tl, tr, br, bl;
    while (head < tail) {
      const i = queue[head++], x = i % width, y = Math.floor(i / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const p = { x, y };
      if (!tl || x + y < tl.x + tl.y) tl = p;
      if (!br || x + y > br.x + br.y) br = p;
      if (!tr || x - y > tr.x - tr.y) tr = p;
      if (!bl || x - y < bl.x - bl.y) bl = p;
      if (x > 0 && mask[i - 1]) { mask[i - 1] = 0; queue[tail++] = i - 1; }
      if (x < width - 1 && mask[i + 1]) { mask[i + 1] = 0; queue[tail++] = i + 1; }
      if (y > 0 && mask[i - width]) { mask[i - width] = 0; queue[tail++] = i - width; }
      if (y < height - 1 && mask[i + width]) { mask[i + width] = 0; queue[tail++] = i + width; }
    }
    if (!best || tail > best.size) best = { size: tail, minX, minY, maxX, maxY, corners: [tl, tr, br, bl], pixels: queue.slice(0, tail) };
  }
  if (!best || best.size < count * 0.08) return fail('missing', 'Coloca la hoja sobre un fondo que contraste. Deben verse sus cuatro bordes.');
  const { minX, minY, maxX, maxY, corners } = best;
  const geometry = { corners: corners.map((p) => ({ x: p.x / width, y: p.y / height })) };
  if (minX < 3 || minY < 3 || maxX >= width - 3 || maxY >= height - 3) {
    return fail('clipped', 'Procura dejar visibles las cuatro esquinas de la hoja.', geometry);
  }
  const guide = pageGuide(width, height, horizontal);
  // La guía es una ayuda de encuadre, no un molde exacto. Una desviación pequeña
  // se admite si las cuatro esquinas siguen visibles dentro de la imagen real.
  const margin = -0.015;
  if (geometry.corners.some((p) => p.x < guide.x + margin || p.x > guide.x + guide.width - margin
    || p.y < guide.y + margin || p.y > guide.y + guide.height - margin)) {
    return fail('outside', 'La hoja sale del marco. Céntrala y deja sus cuatro esquinas dentro.', geometry);
  }
  const top = distance(corners[0], corners[1]), bottom = distance(corners[3], corners[2]);
  const left = distance(corners[0], corners[3]), right = distance(corners[1], corners[2]);
  const ratio = (top + bottom) / (left + right);
  const expectedRatio = horizontal ? 297 / 210 : 210 / 297;
  if (ratio / expectedRatio < 0.76 || ratio / expectedRatio > 1.27
    || Math.min(top, bottom) / Math.max(top, bottom) < 0.72
    || Math.min(left, right) / Math.max(left, right) < 0.72) {
    return fail('shape', 'Pon la cámara de frente a la hoja y comprueba la orientación del marco.', geometry);
  }
  if ((maxX - minX) / width < guide.width * 0.55 || (maxY - minY) / height < guide.height * 0.55) {
    return fail('small', 'Acerca la cámara: la hoja debe ocupar casi todo el marco.', geometry);
  }
  const area = polygonArea(corners);
  if (area <= 0 || best.size / area < 0.72 || best.size / area > 1.08) {
    return fail('edges', 'No distingo una hoja completa. Evita sombras y deja visibles los cuatro bordes.', geometry);
  }
  // Comprueba que los contornos exteriores sean cuatro lados rectos, no un objeto redondo.
  const rowMin = new Int32Array(height).fill(width), rowMax = new Int32Array(height).fill(-1);
  const colMin = new Int32Array(width).fill(height), colMax = new Int32Array(width).fill(-1);
  for (const i of best.pixels) {
    const x = i % width, y = Math.floor(i / width);
    rowMin[y] = Math.min(rowMin[y], x); rowMax[y] = Math.max(rowMax[y], x);
    colMin[x] = Math.min(colMin[x], y); colMax[x] = Math.max(colMax[x], y);
  }
  let aligned = 0, boundary = 0;
  const edgeTolerance = Math.max(3, Math.min(top, left) * 0.02);
  const inspect = (p) => {
    boundary++;
    if (corners.some((a, i) => pointToEdge(p, a, corners[(i + 1) % 4]) <= edgeTolerance)) aligned++;
  };
  for (let y = minY; y <= maxY; y += 3) if (rowMax[y] >= 0) { inspect({ x: rowMin[y], y }); inspect({ x: rowMax[y], y }); }
  for (let x = minX; x <= maxX; x += 3) if (colMax[x] >= 0) { inspect({ x, y: colMin[x] }); inspect({ x, y: colMax[x] }); }
  if (aligned / boundary < 0.78) return fail('edges', 'Hay bordes ocultos o sombras. Extiende la hoja y mejora el contraste con el fondo.', geometry);

  // Luz y enfoque dentro de la hoja: su borde exterior NO cuenta como texto nítido.
  const insetX = Math.ceil((maxX - minX) * 0.12), insetY = Math.ceil((maxY - minY) * 0.12);
  let n = 0, light = 0, lap = 0, lap2 = 0, detail = 0;
  for (let y = minY + insetY; y < maxY - insetY; y++) for (let x = minX + insetX; x < maxX - insetX; x++) {
    const i = y * width + x, value = gray[i];
    const l = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * value;
    n++; light += value; lap += l; lap2 += l * l;
    if (Math.abs(gray[i - 1] - gray[i + 1]) + Math.abs(gray[i - width] - gray[i + width]) > 65) detail++;
  }
  if (!n || light / n < 145) return fail('dark', 'La hoja está muy oscura. Añade luz uniforme antes de capturar.', geometry);
  const sharpness = lap2 / n - (lap / n) ** 2;
  const metrics = { sharpness, brightness: light / n, detail: detail / n };
  if (sharpness < 65 || detail / n < 0.003) {
    return fail('blur', 'No se distingue el texto. Enfoca, evita reflejos y mantén la cámara quieta.', { ...geometry, metrics });
  }
  return { valid: true, code: 'valid', message: 'Hoja completa y legible.', ...geometry, metrics };
}

/** Comprueba detalle interior sin exigir papel blanco ni un rectángulo perfecto. */
export function analyzeCameraFrame(frame, horizontal = false) {
  const { data, width, height } = frame;
  if (!data || width < 80 || height < 80 || data.length !== width * height * 4) {
    return fail('waiting', 'Esperando imagen de la cámara…');
  }
  const framing = analyzeFraming(frame, horizontal);
  // Si se reconoce la hoja, excluimos sus bordes: un papel vacío con un borde
  // bien enfocado no equivale a texto legible. En fondos claros usamos el centro.
  const corners = framing.corners;
  const bounds = corners ? {
    left: Math.min(...corners.map(p => p.x)), right: Math.max(...corners.map(p => p.x)),
    top: Math.min(...corners.map(p => p.y)), bottom: Math.max(...corners.map(p => p.y)),
  } : { left: 0, right: 1, top: 0, bottom: 1 };
  const inset = 0.14;
  const x0 = Math.max(1, Math.ceil((bounds.left + (bounds.right - bounds.left) * inset) * width));
  const x1 = Math.min(width - 1, Math.floor((bounds.right - (bounds.right - bounds.left) * inset) * width));
  const y0 = Math.max(1, Math.ceil((bounds.top + (bounds.bottom - bounds.top) * inset) * height));
  const y1 = Math.min(height - 1, Math.floor((bounds.bottom - (bounds.bottom - bounds.top) * inset) * height));
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = Math.round(data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114);
  let count = 0, light = 0, lap = 0, lap2 = 0, detail = 0;
  const histogram = new Uint32Array(256);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * width + x, value = gray[i];
    const l = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * value;
    count++; light += value; histogram[value]++; lap += l; lap2 += l * l;
    if (Math.abs(gray[i - 1] - gray[i + 1]) + Math.abs(gray[i - width] - gray[i + width]) > 35) detail++;
  }
  if (!count) return fail('waiting', 'Acerca un poco la cámara para comprobar el texto.');
  let p90 = 0, seen = 0;
  for (; p90 < 255; p90++) { seen += histogram[p90]; if (seen >= count * 0.9) break; }
  const metrics = { brightness: light / count, sharpness: lap2 / count - (lap / count) ** 2, detail: detail / count };
  if (p90 < 60) return fail('dark', 'La imagen está demasiado oscura. Añade luz para poder tomar la foto.', { metrics });
  if (metrics.sharpness < 35 || metrics.detail < 0.002) {
    return fail('blur', 'No se distingue suficiente detalle. Enfoca el texto o evita el reflejo antes de tomar la foto.', { metrics });
  }
  const recommendations = {
    outside: 'Puedes tomar la foto. Recomendación: centra la hoja para incluir todas las respuestas.',
    clipped: 'Puedes tomar la foto. Recomendación: deja visibles las cuatro esquinas.',
    shape: 'Puedes tomar la foto. Recomendación: coloca la cámara más de frente a la hoja.',
    small: 'Puedes tomar la foto. Recomendación: acércate un poco para ver mejor el texto.',
    missing: 'Puedes tomar la foto. Recomendación: usa un fondo que contraste con la hoja.',
    edges: 'Puedes tomar la foto. Recomendación: extiende la hoja y evita sombras.',
    dark: 'Puedes tomar la foto. Recomendación: añade un poco más de luz.',
  };
  const recommendation = recommendations[framing.code] || '';
  return { valid: true, code: recommendation ? 'recommendation' : 'valid',
    message: recommendation || 'Detalle suficiente para tomar la foto. Revisa que estén todas las respuestas.',
    recommendation: Boolean(recommendation), corners, metrics };
}

/** No exige inmovilidad ni coincidencia con la guía; una lectura ilegible bloquea. */
export function createCaptureGate() {
  let lastAt = -Infinity, ready = false;
  const reset = () => { lastAt = -Infinity; ready = false; };
  const observe = (quality, now) => {
    if (!quality.valid) { reset(); return { ...quality, ready: false }; }
    lastAt = now; ready = true;
    return { ...quality, ready, code: quality.recommendation ? 'recommendation' : 'ready' };
  };
  return { observe, reset, canCapture: (now) => ready && now - lastAt <= MAX_FRAME_AGE };
}
