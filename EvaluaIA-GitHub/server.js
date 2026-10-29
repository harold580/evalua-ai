import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import evaluate from './api/evaluate.js';
import config from './api/config.js';

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json({ limit: '4mb' }));
app.all('/api/evaluate', evaluate);
app.all('/api/config', config);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
app.use(express.static(path.join(root, 'dist')));
app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
const port = Number(process.env.PORT || 5174);
app.listen(port, '127.0.0.1', () => console.log(`EvaluaIA: http://localhost:${port}`));
