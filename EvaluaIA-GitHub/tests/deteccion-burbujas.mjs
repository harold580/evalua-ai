import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const AQUI = dirname(fileURLToPath(import.meta.url));
import { detectarBurbujaMarcada } from '../api/_bubbleDetect.js';
console.log('MATRIZ DE CONTROL (4 opciones, marca en cada posicion)\n');
let ok=0;
for(const L of ['A','B','C','D']){
  const b64=readFileSync(join(AQUI, `imagenes/marca_${L}.jpg`)).toString('base64');
  const r=detectarBurbujaMarcada(`data:image/jpeg;base64,${b64}`);
  const det=r[0];
  const acierto = det && det.letra===L && det.total===4;
  if(acierto) ok++;
  console.log(`  marca real ${L} -> ${det? `${det.letra} (total ${det.total}, lum ${det.luminancia})` : '(sin deteccion)'}  ${acierto?'✓':'✗'}`);
}
console.log(`\nRESULTADO: ${ok}/4`);
if (ok !== 4) process.exitCode = 1;
