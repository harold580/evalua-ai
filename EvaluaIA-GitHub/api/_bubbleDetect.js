// ============================================================================
// Detección de la burbuja marcada por ANÁLISIS DE PÍXELES (sin IA).
//
// Por qué: los modelos de visión fallan sistemáticamente al decir QUÉ opción
// está marcada. Medido sobre una foto real con una burbuja rellena inequívoca
// (pregunta 31, opción D = "$3000"), todos se desplazaban una fila y respondían
// "C" de forma reproducible, incluso sobre recortes ampliados.
//
// Idea: en los cuadernillos impresos las opciones sin marcar tienen la burbuja
// de COLOR (azul) con su letra en blanco, y la que el alumno rellenó a lápiz
// queda GRIS OSCURA. Entonces no hace falta "ver" la marca: basta con localizar
// las burbujas de color, que son muy distinguibles, y buscar el HUECO de la
// secuencia. Ese hueco es la opción marcada, y su posición da la letra.
//
// Medido en la misma foto: burbujas azules en y=1250/1290/1329 (A, B, C) y hueco
// en y=1369 con luminancia 58 sobre papel de ~170 -> opción D. Determinista.
//
// Es un detector COMPLEMENTARIO: si no encuentra una columna clara devuelve []
// y el pipeline se queda con lo que diga el modelo de visión.
// ============================================================================

import jpeg from 'jpeg-js';

const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F'];

function toBuffer(imageUrl) {
  const base64 = imageUrl.startsWith('data:') ? imageUrl.split(',')[1] : imageUrl;
  return Buffer.from(base64, 'base64');
}

/**
 * Paso vertical entre opciones consecutivas a partir de las distancias medidas.
 *
 * Se usa el MÍNIMO, no la mediana: donde el alumno marcó falta una burbuja de
 * color, así que ese tramo mide el doble. Con 4 opciones y la marca en B o en C
 * quedan 3 burbujas y dos distancias (p. ej. [60, 120]); la mediana de un número
 * par de valores tomaba la mayor (120) y entonces ningún tramo parecía tener un
 * hueco, de modo que la marca no se llegaba a evaluar. El paso real es siempre
 * la distancia más pequeña observada.
 *
 * Se promedian los tramos cercanos al mínimo para no quedar a merced del ruido
 * de un único par de burbujas.
 */
function pasoDeGaps(gaps) {
  if (!gaps.length) return 0;
  const min = Math.min(...gaps);
  if (!min) return 0;
  const cercanos = gaps.filter((g) => g <= min * 1.35);
  return Math.round(cercanos.reduce((a, b) => a + b, 0) / cercanos.length);
}

/**
 * Localiza columnas de burbujas de color y deduce cuál falta (= la marcada).
 *
 * @returns {Array<{x:number, indice:number, letra:string, total:number, luminancia:number, yTop:number}>}
 *          Una entrada por bloque de opciones donde se detectó marca.
 *          `indice` es 0-based dentro del bloque; `letra` su equivalente A/B/C/D.
 */
export function detectarBurbujaMarcada(imageUrl) {
  let img;
  try {
    img = jpeg.decode(toBuffer(imageUrl), { useTArray: true, maxMemoryUsageInMB: 512 });
  } catch {
    return [];
  }
  if (!img || !img.width || !img.height) return [];
  // Tope de tamaño: el recorrido de píxeles es lineal, pero una foto grande cuyo
  // fondo sea del mismo color que las burbujas (una mesa azul, por ejemplo) forma
  // una región enorme que se recorre entera antes de descartarla. Medido: 25 s en
  // una imagen de 2400x3200 mayormente azul. Por encima de este límite se cede el
  // paso al modelo de visión en vez de bloquear la función.
  if (img.width * img.height > 12_000_000) return [];
  const { width: W, height: H, data: D } = img;

  const px = (x, y) => { const i = (y * W + x) * 4; return [D[i], D[i + 1], D[i + 2]]; };
  // Burbuja sin marcar: claramente azulada (canal B por encima de R y G).
  const esColor = (r, g, b) => b > 25 && b - r > Math.max(10, b * 0.18) && b - g > Math.max(5, b * 0.05);

  // ── Componentes conexas sobre una rejilla de paso 2 (suficiente y rápido) ──
  const vis = new Uint8Array(W * H);
  const burbujas = [];
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const id = y * W + x;
      if (vis[id]) continue;
      const [r, g, b] = px(x, y);
      if (!esColor(r, g, b)) { vis[id] = 1; continue; }
      let n = 0, sx = 0, sy = 0, minx = x, maxx = x, miny = y, maxy = y;
      const pila = [[x, y]];
      vis[id] = 1;
      while (pila.length) {
        const [cx, cy] = pila.pop();
        n++; sx += cx; sy += cy;
        if (cx < minx) minx = cx; if (cx > maxx) maxx = cx;
        if (cy < miny) miny = cy; if (cy > maxy) maxy = cy;
        for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const nid = ny * W + nx;
          if (vis[nid]) continue;
          vis[nid] = 1;
          const [rr, gg, bb] = px(nx, ny);
          if (esColor(rr, gg, bb)) pila.push([nx, ny]);
        }
      }
      const an = maxx - minx + 1, al = maxy - miny + 1;
      // Se guardan también los fragmentos que no llegan a círculo completo: la
      // letra blanca del centro parte la burbuja en dos medias lunas cuando la
      // foto está algo lejos o mal iluminada, y descartarlos hacía perder la
      // burbuja entera (con ella, la referencia para deducir la letra).
      if (n >= 12 && an <= 70 && al <= 70) {
        const redondo = Math.abs(an - al) <= Math.max(an, al) * 0.45;
        const completa = n >= 25 && an >= 12 && al >= 12 && redondo;
        burbujas.push({
          cx: Math.round(sx / n), cy: Math.round(sy / n), d: (an + al) / 2,
          minx, maxx, miny, maxy, n, completa,
        });
      }
    }
  }

  // Fusionar fragmentos contiguos de una misma burbuja (las medias lunas que
  // deja la letra blanca): mismo alto aproximado y separados en horizontal por
  // menos que el ancho de una burbuja.
  const fusionadas = [];
  for (const b of burbujas.sort((p, q) => p.cy - q.cy || p.cx - q.cx)) {
    const cerca = fusionadas.find((f) =>
      Math.abs(f.cy - b.cy) <= 10 &&
      b.minx <= f.maxx + 14 && b.maxx >= f.minx - 14);
    if (cerca) {
      cerca.minx = Math.min(cerca.minx, b.minx); cerca.maxx = Math.max(cerca.maxx, b.maxx);
      cerca.miny = Math.min(cerca.miny, b.miny); cerca.maxy = Math.max(cerca.maxy, b.maxy);
      cerca.n += b.n;
      cerca.cx = Math.round((cerca.minx + cerca.maxx) / 2);
      cerca.cy = Math.round((cerca.miny + cerca.maxy) / 2);
      cerca.d = ((cerca.maxx - cerca.minx + 1) + (cerca.maxy - cerca.miny + 1)) / 2;
      cerca.completa = true;
    } else {
      fusionadas.push({ ...b });
    }
  }

  // Ya fusionados, se exige el tamaño y la forma de una burbuja real.
  burbujas.length = 0;
  for (const f of fusionadas) {
    const an = f.maxx - f.minx + 1, al = f.maxy - f.miny + 1;
    const redondo = Math.abs(an - al) <= Math.max(an, al) * 0.5;
    if (f.n >= 25 && an >= 12 && al >= 12 && an <= 70 && al <= 70 && redondo) {
      burbujas.push({ cx: f.cx, cy: f.cy, d: f.d });
    }
  }
  if (burbujas.length < 2) return [];

  // ── Agrupar por columna (mismo x aproximado) ──
  const columnas = [];
  for (const b of burbujas.sort((a, b2) => a.cx - b2.cx)) {
    const c = columnas.find((col) => Math.abs(col.x - b.cx) <= 15);
    if (c) { c.items.push(b); c.x = (c.x * (c.items.length - 1) + b.cx) / c.items.length; }
    else columnas.push({ x: b.cx, items: [b] });
  }

  // Luminancia media de un cuadrado centrado en (cx, cy).
  const luminancia = (cx, cy, rad) => {
    let s = 0, n = 0;
    for (let y = cy - rad; y <= cy + rad; y += 2) {
      for (let x = cx - rad; x <= cx + rad; x += 2) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const [r, g, b] = px(x, y);
        s += (r + g + b) / 3; n++;
      }
    }
    return n ? s / n : 255;
  };

  // Una misma columna puede contener las opciones de VARIAS preguntas seguidas.
  // Se parte en bloques cuando aparece un salto vertical mucho mayor que el paso
  // habitual: sin esto, un listado largo se trataba como un solo bloque y el
  // índice del hueco se disparaba (medido: "posición 14" en una foto real).
  const bloques = [];
  for (const col of columnas) {
    const items = col.items.sort((a, b) => a.cy - b.cy);
    if (items.length < 2) continue;
    const gaps = [];
    for (let i = 1; i < items.length; i++) gaps.push(items[i].cy - items[i - 1].cy);
    const pasoCol = pasoDeGaps(gaps);
    if (!pasoCol || pasoCol < 15 || pasoCol > 200) continue;

    // Corte entre preguntas. El umbral distingue dos saltos parecidos:
    //   - hueco DENTRO de una pregunta (la opción marcada) = 2 x paso
    //   - salto ENTRE preguntas (media el enunciado de la siguiente) = 2,2 x paso
    //     o más, según el diseño de la hoja.
    // Estaba en 2,5 y no separaba: las cuatro preguntas de una hoja quedaban en
    // un único bloque y solo se detectaba una marca. Con 2,15 se separan sin
    // partir una pregunta por su propio hueco.
    const CORTE = pasoCol * 2.15;
    let actual = [items[0]];
    for (let i = 1; i < items.length; i++) {
      if (items[i].cy - items[i - 1].cy > CORTE) {
        bloques.push({ x: col.x, items: actual });
        actual = [];
      }
      actual.push(items[i]);
    }
    if (actual.length) bloques.push({ x: col.x, items: actual });
  }

  const salida = [];
  for (const col of bloques) {
    const items = col.items;
    if (items.length < 2) continue;

    // Paso vertical entre opciones consecutivas.
    const gaps = [];
    for (let i = 1; i < items.length; i++) gaps.push(items[i].cy - items[i - 1].cy);
    const paso = pasoDeGaps(gaps);
    if (!paso || paso < 15 || paso > 200) continue;

    const rad = Math.max(3, Math.round(items[0].d / 3));
    // Papel de la MISMA fila y alrededor del disco. Una sombra oscurece tanto
    // el papel como la burbuja: comparar contra la fila más iluminada era falso.
    const papelLocal = (cx, cy) => {
      const samples = [];
      const distance = Math.max(12, Math.round(items[0].d * 0.95));
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
        const x = Math.round(cx + Math.cos(angle) * distance);
        const y = Math.round(cy + Math.sin(angle) * distance);
        if (x >= 2 && y >= 2 && x < W - 2 && y < H - 2) samples.push(luminancia(x, y, 2));
      }
      samples.sort((a, b) => a - b);
      return samples.length >= 10 ? samples[Math.floor(samples.length * 0.35)] : 0;
    };

    // Proporción de píxeles oscuros dentro del disco de la burbuja. Una burbuja
    // rellena es un disco compacto (~0,8-1,0); una línea de texto que cae en esa
    // posición deja huecos claros entre las letras (~0,2-0,4). Esto permite
    // aceptar también el hueco "antes de la primera" (cuando el alumno marcó la
    // opción A) sin tragarse el texto del enunciado como si fuera una marca.
    const relleno = (cx, cy, r, papel) => {
      let osc = 0, n = 0;
      for (let y = cy - r; y <= cy + r; y += 1) {
        for (let x = cx - r; x <= cx + r; x += 1) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
          const [rr, gg, bb] = px(x, y);
          // El azul impreso oscurecido por una sombra sigue siendo azul.
          if (!esColor(rr, gg, bb) && (rr + gg + bb) / 3 < papel * 0.76) osc++;
          n++;
        }
      }
      return n ? osc / n : 0;
    };

    // Candidatos: huecos internos, uno al final y uno antes de la primera.
    const candidatos = [];
    candidatos.push({ y: Math.round(items[0].cy - paso), pos: -1 });
    for (let i = 1; i < items.length; i++) {
      const k = Math.round((items[i].cy - items[i - 1].cy) / paso);
      for (let j = 1; j < k; j++) {
        candidatos.push({ y: Math.round(items[i - 1].cy + j * paso), pos: i - 1 + j });
      }
    }
    candidatos.push({ y: Math.round(items[items.length - 1].cy + paso), pos: items.length });

    let mejor = null;
    let plausibles = 0;
    for (const c of candidatos) {
      if (c.y < 0 || c.y >= H) continue;
      const lum = luminancia(Math.round(col.x), c.y, rad);
      const papel = papelLocal(Math.round(col.x), c.y);
      if (papel < 45 || lum / papel >= 0.7 || papel - lum < 15) continue;
      const frac = relleno(Math.round(col.x), c.y, Math.max(4, Math.round(items[0].d / 2.4)), papel);
      if (frac < 0.6) continue; // no es un disco relleno, probablemente texto
      plausibles++;
      if (!mejor || lum / papel < mejor.contraste) mejor = { ...c, lum, frac, contraste: lum / papel };
    }
    if (plausibles > 1) continue; // varias marcas: no elegir la más oscura
    // Si la marcada resultó estar antes de la primera burbuja de color, todas las
    // demás se desplazan una posición: la marcada pasa a ser la A.
    if (mejor && mejor.pos === -1) mejor = { ...mejor, pos: 0 };
    // Un examen de opción múltiple no pasa de A-F: un índice mayor significa que
    // el bloque no era una lista de opciones (o se agruparon varias preguntas).
    if (mejor && mejor.pos >= LETRAS.length) continue;

    // Nº de opciones que implica esta lectura: las burbujas de color localizadas
    // más la que se dio por marcada. El llamador DEBE comparar este valor con el
    // número real de opciones de la pregunta: si no coinciden es que se perdió
    // alguna burbuja (reflejos, desenfoque o la letra blanca partiendo el círculo
    // en dos medias lunas) y entonces la letra deducida está desplazada.
    // Caso medido: se detectaron solo C y D, la marca real era B y el detector
    // respondió "A" porque supuso que la primera burbuja hallada era la A.
    let total = items.length + 1;
    let indice = mejor ? mejor.pos : -1;
    let lumFinal = mejor ? mejor.lum : 0;

    // ── Segundo método: burbuja ENSUCIADA ──
    // Cuando el alumno tacha o garabatea ENCIMA de la burbuja en vez de
    // rellenarla, el círculo de color sigue ahí y no falta ninguna posición, así
    // que el método del hueco no ve nada. Aquí se compara el interior de todas
    // las burbujas entre sí: la que tiene tinta encima queda claramente más
    // oscura que sus compañeras.
    if (!mejor) {
      const lums = items.map((b) => luminancia(b.cx, b.cy, rad));
      const papers = items.map((b) => papelLocal(b.cx, b.cy));
      if (papers.some((paper) => paper < 45)) continue;
      const relative = lums.map((lum, i) => lum / papers[i]);
      const orden = relative.slice().sort((a, b) => a - b);
      const masOscura = orden[0];
      const segunda = orden[1];
      // Se exige que destaque claramente sobre la siguiente más oscura: si todas
      // se parecen, es que ninguna está marcada y hay que abstenerse.
      // Medido sobre una hoja real: las burbujas limpias varían entre sí unos 4
      // puntos de luminancia (130-134), mientras que una tachada baja a 106 y una
      // rellena a 70. Un margen de 18 separa con holgura la marca del ruido.
      if (segunda - masOscura >= 0.09) {
        const idx = relative.indexOf(masOscura);
        if (idx >= 0 && idx < LETRAS.length) {
          const b = items[idx];
          if (relleno(b.cx, b.cy, rad, papers[idx]) < 0.12) continue;
          indice = idx;
          lumFinal = lums[idx];
          total = items.length; // aquí no falta ninguna burbuja
        }
      }
    }

    if (indice < 0 || indice >= LETRAS.length) continue;
    salida.push({
      x: Math.round(col.x),
      indice,
      letra: LETRAS[indice] || '',
      total,
      luminancia: Math.round(lumFinal),
      yTop: items[0].cy,
    });
  }

  // De arriba hacia abajo, como aparecen las preguntas en la hoja.
  return salida.sort((a, b) => a.yTop - b.yTop);
}
