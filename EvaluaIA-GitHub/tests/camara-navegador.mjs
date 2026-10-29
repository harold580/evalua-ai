import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const output = new URL('../qa/', import.meta.url);
fs.mkdirSync(output, { recursive: true });
const vercelConfig = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const evaluations = [];
const server = http.createServer((req, res) => {
  for (const header of vercelConfig.headers[0].headers) res.setHeader(header.key, header.value);
  if (req.url === '/api/config') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ hasServerKey: true, provider: 'OpenRouter', model: 'openai/gpt-6-luna' })); return; }
  if (req.url === '/api/evaluate') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      evaluations.push(JSON.parse(body));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ nombreEstudiante: 'Estudiante simulado', totalPreguntas: 1,
        preguntas: [{ id: 1, pregunta: '2 + 2', correcta: true, revisar: false,
          opciones: { A: '3', B: '4' }, respuestaAlumno: 'B', respuestaCorrecta: 'B', comentario: 'Correcto.' }], temasAFallar: [] }));
    });
    return;
  }
  const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!file.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  console.log('Iniciando navegador con cámara simulada y servidor local.');
  browser = await puppeteer.launch({ headless: true, pipe: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1050 }]) {
    for (const mode of ['Un estudiante', 'Carga masiva']) {
      const page = await browser.newPage();
      const errors = [];
      const before = evaluations.length;
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewport(viewport);
      await page.setRequestInterception(true);
      page.on('request', (request) => request.url().startsWith(url) || request.url().startsWith('data:') ? request.continue() : request.abort());
      await page.evaluateOnNewDocument((portrait) => {
        navigator.mediaDevices.getUserMedia = async () => {
          const canvas = document.createElement('canvas'); canvas.width = portrait ? 960 : 1280; canvas.height = portrait ? 1280 : 960;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#666'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.translate((canvas.width - 1280) / 2, (canvas.height - 960) / 2);
          ctx.fillStyle = 'white'; ctx.fillRect(345, 55, 590, 835);
          ctx.fillStyle = '#111'; ctx.font = '24px sans-serif';
          ctx.fillText('EVALUACIÓN · HOJA COMPLETA', 365, 105);
          ctx.fillText('Nombre: Estudiante de prueba', 365, 165);
          for (let i = 0; i < 4; i++) { ctx.strokeRect(375, 290 + i * 90, 26, 26); ctx.fillText('ABCD'[i] + ') Opción ' + (i + 1), 430, 312 + i * 90); }
          ctx.fillStyle = '#555'; ctx.fillRect(375, 380, 26, 26);
          ctx.fillStyle = '#111'; ctx.fillText('Final de la hoja · Página 1', 365, 860);
          const stream = canvas.captureStream(10);
          const original = ctx.getImageData(0, 0, canvas.width, canvas.height);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          window.testCameraMode = 'good';
          const timer = setInterval(() => {
            if (!stream.active) { clearInterval(timer); return; }
            if (window.testCameraMode === 'good') ctx.putImageData(original, 0, 0);
            else {
              ctx.fillStyle = window.testCameraMode === 'dark' ? '#111' : '#fff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
          }, 100);
          window.testStream = stream;
          return stream;
        };
      }, viewport.width < 500);
      await page.goto(url, { waitUntil: 'networkidle0' });
      const prefix = `${viewport.width}-${mode === 'Un estudiante' ? 'estudiante' : 'masiva'}`;
      const screenshot = async (suffix) => {
        await page.evaluate(async () => {
          window.scrollTo(0, 0);
          await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
        });
        await page.screenshot({ path: fileURLToPath(new URL(`${prefix}-${suffix}.png`, output)), fullPage: true });
      };
      if (mode === 'Un estudiante') await screenshot('inicio');
      const click = async (label) => {
        await page.waitForFunction((text) => [...document.querySelectorAll('button')].some((b) => b.textContent.includes(text) && !b.disabled), {}, label);
        await page.evaluate((text) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(text) && !b.disabled).click(), label);
      };
      await click(mode);
      await screenshot('seleccion');
      await click(mode === 'Un estudiante' ? 'Tomar las fotos ahora' : 'Fotografiar con la cámara');
      const capture = mode === 'Un estudiante' ? 'Tomar hoja 1' : 'Tomar foto';
      await page.waitForFunction((text) => [...document.querySelectorAll('button')].some((b) => b.textContent.includes(text) && !b.disabled), {}, capture);
      // El bloqueo real se mantiene en ambos modos, aunque el encuadre sea orientativo.
      for (const bad of ['dark', 'blank']) {
        await page.evaluate(value => { window.testCameraMode = value; }, bad);
        await page.waitForFunction((text) => {
          const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes(text));
          return button?.disabled && ['dark', 'blur'].includes(document.querySelector('[data-camera-status]')?.dataset.cameraStatus);
        }, {}, capture);
        assert.equal(evaluations.length, before);
        await page.evaluate(() => { window.testCameraMode = 'good'; });
        await page.waitForFunction((text) => [...document.querySelectorAll('button')].some(b => b.textContent.includes(text) && !b.disabled), {}, capture);
      }
      const dimensions = await page.evaluate(() => {
        const video = document.querySelector('video'), guide = document.querySelector('[data-page-guide]');
        const v = video.getBoundingClientRect(), g = guide.getBoundingClientRect();
        return { fit: getComputedStyle(video).objectFit, ratio: v.width / v.height, sourceRatio: video.videoWidth / video.videoHeight,
          guideInside: g.left >= v.left && g.right <= v.right && g.top >= v.top && g.bottom <= v.bottom,
          overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(dimensions.fit, 'contain');
      assert.ok(Math.abs(dimensions.ratio - dimensions.sourceRatio) < 0.01);
      assert.equal(dimensions.guideInside, true);
      assert.equal(dimensions.overflow, false);
      await click('Hoja vertical');
      const horizontalRatio = await page.evaluate(() => {
        const box = document.querySelector('[data-page-guide]').getBoundingClientRect();
        return box.width / box.height;
      });
      assert.ok(Math.abs(horizontalRatio - 297 / 210) < 0.02);
      await click('Hoja horizontal');
      await page.evaluate(() => document.querySelector('[data-page-guide]').parentElement.parentElement.scrollIntoView({ block: 'center' }));
      const name = `${viewport.width}-${mode === 'Un estudiante' ? 'estudiante' : 'masiva'}.png`;
      await page.screenshot({ path: fileURLToPath(new URL(name, output)) });
      await click(capture);
      await page.waitForFunction(() => [...document.images].some((image) => image.src.startsWith('data:image/')));
      const photo = await page.evaluate(() => {
        const image = [...document.images].find((i) => i.src.startsWith('data:image/'));
        return { w: image.naturalWidth, h: image.naturalHeight, streamActive: window.testStream.active };
      });
      assert.ok(Math.abs(photo.w / photo.h - dimensions.sourceRatio) < 0.01, 'La captura debe conservar el fotograma completo');
      assert.equal(photo.streamActive, true, 'La cámara sigue abierta entre hojas');
      assert.equal(evaluations.length, before, 'Capturar no consume una evaluación');
      if (mode === 'Un estudiante') {
        await click('Tomar hoja 2');
        await page.waitForFunction(() => [...document.images].filter(image => image.src.startsWith('data:image/')).length === 2);
      }
      if (mode === 'Un estudiante') await click('Listo');
      else await click('Terminar y revisar los grupos');
      await page.waitForFunction(() => window.testStream.getTracks().every((track) => track.readyState === 'ended'));
      await screenshot('revision');
      if (mode === 'Un estudiante') {
        await click('Calificar las 2 hojas');
        await page.waitForFunction(() => document.body.textContent.includes('Estudiante simulado'));
        assert.equal(evaluations.length, before + 1);
        assert.equal(evaluations.at(-1).images.length, 2, 'Las dos fotos llegan juntas al endpoint');
        await screenshot('resultado-simulado');
      }
      assert.deepEqual(errors, []);
      console.log('OK', name, dimensions, photo);
      await page.close();
    }
  }
} finally { await browser?.close(); server.close(); }
