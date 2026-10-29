// Pruebas de la carga masiva: cómo se agrupan las hojas por estudiante y si el
// Excel que se genera es un archivo válido. Sin llamadas externas.
//
// La primera prueba existe por un fallo real: los ZIP casi siempre traen una
// carpeta raíz ("curso/1001/hoja.jpg") y agrupar por el primer tramo de la ruta
// metía a los 40 estudiantes en un único grupo llamado "curso".

import { agruparHojas } from '../src/services/loteArchivos.js';
import { construirXlsx } from '../src/services/exportarExcel.js';
import { unzipSync, strFromU8 } from 'fflate';

let pasadas = 0;
let total = 0;

const comprobar = (nombre, condicion, detalle = '') => {
  total += 1;
  if (condicion) pasadas += 1;
  console.log(`  ${condicion ? '✓' : '✗'} ${nombre}${detalle ? ` (${detalle})` : ''}`);
};

const agrupar = (rutas) => agruparHojas(rutas.map((ruta) => ({ ruta, src: 'x' })));

console.log('AGRUPACION DE HOJAS POR ESTUDIANTE\n');

const conRaiz = agrupar(['curso/1001/a.jpg', 'curso/1001/b.jpg', 'curso/1002/a.jpg']);
comprobar('ZIP con carpeta raiz agrupa por la carpeta del alumno', conRaiz.length === 2, `${conRaiz.length} grupos`);

const sinRaiz = agrupar(['1001/a.jpg', '1001/b.jpg', '1002/a.jpg']);
comprobar('ZIP sin carpeta raiz', sinRaiz.length === 2, `${sinRaiz.length} grupos`);

const porNombre = agrupar(['1001_p1.jpg', '1001_p2.jpg', '1002_p1.jpg', '1002_p2.jpg', '1002_p3.jpg']);
comprobar('nombre de archivo con numero de hoja', porNombre.length === 2, `${porNombre.length} grupos`);

const orden = agrupar(['ana_p10.jpg', 'ana_p2.jpg', 'ana_p1.jpg']);
comprobar(
  'las hojas se ordenan 1,2,10 y no alfabeticamente',
  JSON.stringify(orden[0]?.hojas.map((h) => h.pagina)) === '[1,2,10]',
  JSON.stringify(orden[0]?.hojas.map((h) => h.pagina)),
);

const sueltas = agrupar(['foto.jpg', 'otra.jpg', 'mas.jpg']);
comprobar('sin pistas: un archivo, un estudiante', sueltas.length === 3, `${sueltas.length} grupos`);

const variantes = agrupar(['luis-hoja1.jpg', 'luis-hoja2.jpg', 'marta pag 1.jpg', 'marta pag 2.jpg']);
comprobar('reconoce hoja/pag y guiones o espacios', variantes.length === 2, `${variantes.length} grupos`);

console.log('\nEXPORTACION A EXCEL\n');

const bytes = construirXlsx([
  ['Estudiante', 'Identificador', 'Nota'],
  ['Ana Gómez & Cía', '1001', 4.2],
  ['Luis <Díaz>', '1002', 3.4],
]);
const partes = unzipSync(bytes);
for (const parte of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml']) {
  comprobar(`el .xlsx contiene ${parte}`, parte in partes);
}
const hoja = strFromU8(partes['xl/worksheets/sheet1.xml']);
comprobar('la nota va como numero, no como texto', hoja.includes('<v>4.2</v>'));
comprobar('los caracteres XML se escapan', hoja.includes('&amp;') && hoja.includes('&lt;Díaz&gt;'));
comprobar('una fila por estudiante mas el encabezado', (hoja.match(/<row /g) || []).length === 3);
console.log('\nAGRUPACION POR NUMERO FIJO DE HOJAS\n');

const img = (n) => Array.from({ length: n }, (_, i) => ({
  ruta: `foto-${String(i + 1).padStart(3, '0')}.jpg`, src: 'x',
}));

const { agruparPorCantidad } = await import('../src/services/loteArchivos.js');

const exacto = agruparPorCantidad(img(12), 3);
comprobar('12 fotos de 3 en 3 -> 4 estudiantes', exacto.length === 4, `${exacto.length}`);
comprobar('cada grupo lleva 3 hojas', exacto.every((g) => g.hojas.length === 3));
comprobar('las hojas se numeran 1..3 dentro del grupo',
  JSON.stringify(exacto[0].hojas.map((h) => h.pagina)) === '[1,2,3]');
comprobar('respeta el orden de captura',
  exacto[1].hojas[0].ruta === 'foto-004.jpg', exacto[1].hojas[0].ruta);

const sobra = agruparPorCantidad(img(7), 3);
comprobar('7 fotos de 3 en 3 -> 3 grupos, el ultimo incompleto',
  sobra.length === 3 && sobra[2].hojas.length === 1, `${sobra.length} grupos, ultimo ${sobra[2]?.hojas.length}`);

const unaPorAlumno = agruparPorCantidad(img(5), 1);
comprobar('1 hoja por examen -> un estudiante por foto', unaPorAlumno.length === 5, `${unaPorAlumno.length}`);

console.log(`\nRESULTADO FINAL: ${pasadas}/${total}`);
if (pasadas !== total) process.exit(1);
