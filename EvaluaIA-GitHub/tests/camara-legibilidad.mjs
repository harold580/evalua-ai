import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCameraFrame, pageGuide, createCaptureGate } from '../src/services/cameraQuality.js';

function scene({ horizontal = false, brightness = 240, background = 75, blank = false, small = false, outside = false, clipped = false, missing = false, shadow = false, blurred = false } = {}) {
  const width = 360, height = 480;
  const data = new Uint8ClampedArray(width * height * 4);
  const guide = pageGuide(width, height, horizontal);
  const size = small ? 0.35 : 0.85;
  const w = Math.round(guide.width * width * size), h = Math.round(guide.height * height * size);
  const x0 = clipped ? -8 : Math.round((width - w) / 2 + (outside ? 45 : 0));
  const y0 = Math.round((height - h) / 2);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let value = background;
    if (!missing && x >= x0 && x < x0 + w && y >= y0 && y < y0 + h) {
      value = brightness;
      // Trazos interiores; el enfoque no depende del borde de la hoja.
      if (!blank && x > x0 + w * 0.18 && x < x0 + w * 0.8 && y > y0 + h * 0.2 && y < y0 + h * 0.8
        && (y - y0) % 21 < 3 && (x - x0) % 12 < 8) value = 30;
      if (shadow && x > x0 + w / 2) value *= 0.4;
    }
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255;
  }
  if (blurred) {
    for (let pass = 0; pass < 3; pass++) {
      const original = data.slice();
      for (let y = 3; y < height - 3; y++) for (let x = 3; x < width - 3; x++) {
        let sum = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) sum += original[((y + dy) * width + x + dx) * 4];
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = sum / 49;
      }
    }
  }
  return { data, width, height };
}


test('acepta detalle legible en ambas orientaciones', () => {
  for (const horizontal of [false, true]) assert.equal(analyzeCameraFrame(scene({ horizontal }), horizontal).valid, true);
});
test('el encuadre y el tamaño son recomendaciones, no bloqueos', () => {
  for (const kind of ['clipped', 'outside', 'small']) {
    const result = analyzeCameraFrame(scene({ [kind]: true }));
    assert.equal(result.valid, true, kind + ': ' + JSON.stringify(result));
    assert.equal(result.recommendation, true, kind);
  }
  assert.equal(analyzeCameraFrame(scene({ horizontal: true }), false).valid, true);
});
test('acepta papel sobre fondo blanco y luz moderada', () => {
  for (const options of [{ background: 240 }, { brightness: 100 }, { shadow: true }]) {
    const result = analyzeCameraFrame(scene(options));
    assert.equal(result.valid, true, JSON.stringify({ options, result }));
  }
});
test('bloquea oscuridad severa, desenfoque y hoja sin detalle', () => {
  for (const options of [{ brightness: 30, background: 20 }, { blurred: true }, { blank: true }, { missing: true }]) {
    const result = analyzeCameraFrame(scene(options));
    assert.equal(result.valid, false, JSON.stringify({ options, result }));
  }
  const white = scene(); white.data.fill(255);
  assert.equal(analyzeCameraFrame(white).valid, false);
});
test('habilita sin inmovilidad; ilegibilidad y fotograma antiguo revocan captura', () => {
  const gate = createCaptureGate(), good = analyzeCameraFrame(scene());
  assert.equal(gate.canCapture(0), false);
  assert.equal(gate.observe(good, 0).ready, true);
  assert.equal(gate.observe({ ...good, corners: good.corners.map(p => ({ x: p.x + 0.1, y: p.y })) }, 200).ready, true);
  assert.equal(gate.canCapture(1399), true);
  assert.equal(gate.canCapture(1401), false);
  assert.equal(gate.observe({ valid: false, code: 'blur' }, 1500).ready, false);
  assert.equal(gate.canCapture(1501), false);
  assert.equal(gate.observe(good, 1600).ready, true);
  gate.reset();
  assert.equal(gate.canCapture(1601), false);
});
