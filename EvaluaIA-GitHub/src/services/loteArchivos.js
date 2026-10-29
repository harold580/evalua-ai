// ============================================================================
// Lectura del ZIP y agrupación de hojas por estudiante — TODO en el navegador.
//
// POR QUÉ EN EL NAVEGADOR: si el ZIP se subiera al servidor, los 40 exámenes
// del curso tendrían que pasar por el límite de ~4.5 MB por petición de Vercel
// y no cabrían. Abriéndolo aquí, el archivo nunca sale de la máquina del
// docente y al servidor solo viajan las hojas de un estudiante a la vez.
// ============================================================================

import { unzip } from 'fflate';

const EXT_IMAGEN = /\.(jpe?g|png|webp)$/i;
const TIPO_POR_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Nombre de archivo sin carpetas ni extensión. */
const nombreBase = (ruta) => ruta.split('/').pop().replace(/\.[^.]+$/, '');

const aDataUrl = (bytes, ruta) => {
  const ext = ruta.split('.').pop().toLowerCase();
  const tipo = TIPO_POR_EXT[ext] || 'image/jpeg';
  let binario = '';
  // En trozos para no reventar la pila con imágenes grandes.
  for (let i = 0; i < bytes.length; i += 8192) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return `data:${tipo};base64,${btoa(binario)}`;
};

/**
 * Abre un ZIP y devuelve sus imágenes.
 * @returns {Promise<Array<{ruta: string, src: string}>>}
 */
export function leerZip(file) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error('No se pudo leer el archivo ZIP.'));
    lector.onload = () => {
      unzip(new Uint8Array(lector.result), (err, entradas) => {
        if (err) {
          reject(new Error('El archivo no es un ZIP válido o está dañado.'));
          return;
        }
        const imagenes = [];
        for (const [ruta, bytes] of Object.entries(entradas)) {
          // Las carpetas vienen como entradas vacías; y __MACOSX es basura que
          // añade macOS al comprimir, con copias que no son imágenes reales.
          if (!bytes.length || ruta.startsWith('__MACOSX/') || ruta.endsWith('/')) continue;
          if (!EXT_IMAGEN.test(ruta)) continue;
          imagenes.push({ ruta, src: aDataUrl(bytes, ruta) });
        }
        if (!imagenes.length) {
          reject(new Error('El ZIP no contiene imágenes (JPG, PNG o WebP).'));
          return;
        }
        resolve(imagenes);
      });
    };
    lector.readAsArrayBuffer(file);
  });
}

// ── Agrupación ─────────────────────────────────────────────────────────────
// Tres reglas, de la más fiable a la más tosca. La app enseña los grupos que
// detectó ANTES de calificar para que el docente los corrija si se equivocó.
//
// Cuando exista el editor de plantilla, la casilla de identificación impresa
// será la fuente principal y esto quedará como respaldo para exámenes que no
// se hicieron con la plantilla.

// "juan_p2", "juan-hoja2", "juan 2" → { clave: "juan", pagina: 2 }
const PATRON_PAGINA = /^(.*?)[\s_-]*(?:p|pag|pagina|página|hoja|h)?[\s_-]*(\d{1,3})$/i;

export function agruparHojas(imagenes) {
  const grupos = new Map();

  const meter = (clave, pagina, imagen) => {
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push({ ...imagen, pagina });
  };

  for (const imagen of imagenes) {
    const partes = imagen.ruta.split('/').filter(Boolean);

    // Regla 1 — una carpeta por estudiante. Es la más clara y la que menos se
    // equivoca, así que gana sobre el nombre del archivo.
    //
    // Se toma la carpeta que CONTIENE la imagen, no la primera de la ruta: casi
    // todos los ZIP traen una carpeta raíz ("curso/1001/hoja.jpg"), y usar la
    // primera metía a los 40 estudiantes en un solo grupo llamado "curso".
    if (partes.length > 1) {
      const base = nombreBase(imagen.ruta);
      const m = base.match(PATRON_PAGINA);
      meter(partes[partes.length - 2], m ? Number(m[2]) : null, imagen);
      continue;
    }

    // Regla 2 — el nombre del archivo trae el número de hoja.
    const base = nombreBase(imagen.ruta);
    const m = base.match(PATRON_PAGINA);
    if (m && m[1].trim()) {
      meter(m[1].trim(), Number(m[2]), imagen);
      continue;
    }

    // Regla 3 — sin pista ninguna: un archivo, un estudiante.
    meter(base, 1, imagen);
  }

  return [...grupos.entries()].map(([clave, hojas]) => ({
    clave,
    // Orden por número de hoja cuando lo hay; si no, el orden del ZIP.
    hojas: [...hojas].sort((a, b) => {
      if (a.pagina != null && b.pagina != null) return a.pagina - b.pagina;
      return a.ruta.localeCompare(b.ruta, 'es', { numeric: true });
    }),
  })).sort((a, b) => a.clave.localeCompare(b.clave, 'es', { numeric: true }));
}

/** Describe en una frase cómo se agrupó, para mostrarlo en pantalla. */
export function explicarAgrupacion(grupos) {
  const total = grupos.reduce((n, g) => n + g.hojas.length, 0);
  const sueltas = grupos.filter((g) => g.hojas.length === 1).length;
  if (grupos.length === total) {
    return `${total} imágenes · cada una se tomó como un estudiante distinto.`;
  }
  return `${total} imágenes agrupadas en ${grupos.length} estudiantes` +
    (sueltas ? ` (${sueltas} de una sola hoja).` : '.');
}

// ── RAR ────────────────────────────────────────────────────────────────────
// RAR es un formato propietario y el navegador no lo abre solo, así que hace
// falta libarchive.js (WebAssembly). Se carga BAJO DEMANDA — solo cuando el
// docente sube un .rar — para no meterle 1 MB de descarga a quien use ZIP.
//
// El worker y el .wasm se sirven desde /libarchive/ (carpeta public/). Si algún
// día se actualiza la librería, hay que volver a copiar esos dos archivos:
//   cp node_modules/libarchive.js/dist/{worker-bundle.js,libarchive.wasm} public/libarchive/

let archivePromise = null;

async function cargarLibarchive() {
  if (!archivePromise) {
    archivePromise = import('libarchive.js').then(({ Archive }) => {
      Archive.init({ workerUrl: '/libarchive/worker-bundle.js' });
      return Archive;
    });
  }
  return archivePromise;
}

/**
 * Abre un RAR y devuelve sus imágenes, con la misma forma que leerZip().
 * @returns {Promise<Array<{ruta: string, src: string}>>}
 */
export async function leerRar(file) {
  let Archive;
  try {
    Archive = await cargarLibarchive();
  } catch {
    throw new Error('No se pudo cargar el lector de RAR. Comprime la carpeta como .zip y vuelve a intentarlo.');
  }

  let entradas;
  try {
    const archivo = await Archive.open(file);
    entradas = await archivo.extractFiles();
  } catch {
    throw new Error('El archivo no es un RAR válido, está dañado o tiene contraseña.');
  }

  // extractFiles() devuelve un árbol de carpetas anidadas; se aplana
  // conservando la ruta, que es justo lo que necesita el agrupador.
  const imagenes = [];
  const recorrer = async (nodo, prefijo) => {
    for (const [nombre, valor] of Object.entries(nodo)) {
      const ruta = prefijo ? `${prefijo}/${nombre}` : nombre;
      if (valor instanceof File || valor instanceof Blob) {
        if (!EXT_IMAGEN.test(nombre)) continue;
        imagenes.push({ ruta, src: await blobADataUrl(valor) });
      } else if (valor && typeof valor === 'object') {
        await recorrer(valor, ruta);
      }
    }
  };
  await recorrer(entradas, '');

  if (!imagenes.length) {
    throw new Error('El RAR no contiene imágenes (JPG, PNG o WebP).');
  }
  return imagenes;
}

const blobADataUrl = (blob) => new Promise((resolve, reject) => {
  const lector = new FileReader();
  lector.onloadend = () => resolve(lector.result);
  lector.onerror = () => reject(new Error('No se pudo leer una imagen del RAR.'));
  lector.readAsDataURL(blob);
});

// ── Agrupación por número fijo de hojas ────────────────────────────────────
/**
 * Cuando el docente sabe cuántas hojas tiene cada examen, esto es más fiable
 * que adivinar por el nombre del archivo: se corta la lista en bloques de N,
 * en orden. Es también lo que permite la ráfaga de fotos con la cámara.
 *
 * Si el total no es múltiplo de N, el último grupo queda incompleto y se avisa
 * en pantalla: casi siempre significa que falta o sobra una foto.
 */
export function agruparPorCantidad(imagenes, hojasPorEstudiante) {
  const n = Math.max(1, Math.floor(hojasPorEstudiante));
  const ordenadas = [...imagenes].sort((a, b) =>
    a.ruta.localeCompare(b.ruta, 'es', { numeric: true }));

  const grupos = [];
  for (let i = 0; i < ordenadas.length; i += n) {
    const hojas = ordenadas.slice(i, i + n).map((img, j) => ({ ...img, pagina: j + 1 }));
    grupos.push({ clave: `Estudiante ${grupos.length + 1}`, hojas });
  }
  return grupos;
}
