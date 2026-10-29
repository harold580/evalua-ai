// ============================================================================
// Exportación a Excel (.xlsx) sin librerías pesadas.
//
// Un .xlsx no es más que un ZIP con unos cuantos XML dentro, y ya tenemos
// fflate para leer los ZIP del docente. Escribirlo a mano aquí evita añadir una
// dependencia de ~800 KB al bundle solo para volcar una tabla de notas.
//
// Se escriben los textos como "inlineStr" para no tener que mantener la tabla
// de cadenas compartidas: el archivo pesa un poco más, pero para una planilla
// de curso es irrelevante y el código queda mucho más simple.
// ============================================================================

import { zipSync, strToU8 } from 'fflate';

const escapar = (v) => String(v ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  // Excel rechaza el archivo entero si aparece un carácter de control.
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/** 0 → A, 25 → Z, 26 → AA */
function columna(indice) {
  let letras = '';
  let n = indice;
  do {
    letras = String.fromCharCode(65 + (n % 26)) + letras;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letras;
}

function celda(valor, ref) {
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return `<c r="${ref}"><v>${valor}</v></c>`;
  }
  const texto = escapar(valor);
  if (!texto) return `<c r="${ref}"/>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${texto}</t></is></c>`;
}

function hoja(filas) {
  const xml = filas.map((fila, f) => {
    const celdas = fila.map((valor, c) => celda(valor, `${columna(c)}${f + 1}`)).join('');
    return `<row r="${f + 1}">${celdas}</row>`;
  }).join('');

  const anchos = (filas[0] || []).map((_, c) =>
    `<col min="${c + 1}" max="${c + 1}" width="${c === 0 ? 28 : 14}" customWidth="1"/>`
  ).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    (anchos ? `<cols>${anchos}</cols>` : '') +
    `<sheetData>${xml}</sheetData></worksheet>`;
}

/**
 * Construye el .xlsx y lo descarga.
 * @param {Array<Array<string|number>>} filas  la primera fila son los encabezados
 * @param {string} nombreArchivo
 */
export function construirXlsx(filas) {
  const archivos = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Notas" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(hoja(filas)),
  };

  return zipSync(archivos, { level: 6 });
}

/** Construye el .xlsx y lo descarga en el navegador. */
export function descargarExcel(filas, nombreArchivo = 'notas.xlsx') {
  const blob = new Blob([construirXlsx(filas)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  // Sin esto el blob queda retenido en memoria hasta recargar la página.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
