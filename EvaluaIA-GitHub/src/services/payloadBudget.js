// ============================================================================
// Presupuesto de envío — reparte las hojas de un estudiante en tandas que
// quepan en una petición de Vercel.
//
// EL DATO QUE MANDA: Vercel corta el cuerpo de la petición en ~4.5 MB, y ese
// tope es de la PETICIÓN COMPLETA, no de cada imagen. Si van 6 hojas, se suman
// las 6. Además el base64 infla cada imagen un ~33% respecto al archivo real.
//
// LA REGLA QUE NO SE DEBE ROMPER: cuando no caben, se PARTE en tandas — NO se
// baja la calidad. Bajar la calidad no ahorra ni un token (los modelos cobran
// las imágenes por mosaicos de 512x512, no por peso del archivo) y sí empeora
// la detección de burbujas, que es justo lo que más falla. Reducir solo se
// justifica cuando UNA sola hoja no cabe ni ella sola.
// ============================================================================

import { compressImageForUpload } from './openRouterApi.js';

// 3.8 MB deja margen para el resto del JSON dentro del límite de 4.5 MB.
export const PRESUPUESTO_PETICION = 3_800_000;

// Tope acordado con el docente: 6 hojas por estudiante.
export const MAX_HOJAS_POR_ESTUDIANTE = 6;

/** Peso que ocupará la imagen dentro del JSON de la petición. */
export const pesoEnPeticion = (dataUrl) => (typeof dataUrl === 'string' ? dataUrl.length : 0);

/**
 * Reparte las hojas en tandas que quepan en el presupuesto, respetando el orden.
 * Con fotos de móvil (~500 KB) caben unas 5 por tanda, así que lo normal es que
 * un estudiante completo salga en un solo viaje.
 *
 * @param {string[]} hojas data URLs en el orden de las páginas
 * @returns {string[][]} tandas
 */
export function repartirEnTandas(hojas, presupuesto = PRESUPUESTO_PETICION) {
  const tandas = [];
  let actual = [];
  let acumulado = 0;

  for (const hoja of hojas) {
    const peso = pesoEnPeticion(hoja);
    // Una hoja que por sí sola no cabe se manda igual en su propia tanda: el
    // llamador ya debió reducirla con `asegurarQueQuepaSola`. Meterla con otras
    // solo garantizaría un 413.
    if (actual.length && acumulado + peso > presupuesto) {
      tandas.push(actual);
      actual = [];
      acumulado = 0;
    }
    actual.push(hoja);
    acumulado += peso;
  }
  if (actual.length) tandas.push(actual);
  return tandas;
}

/**
 * Último recurso: reduce UNA hoja que no cabe ni sola en una petición. Pasa con
 * escáneres y cámaras buenas (fotos de 5-8 MB), no con fotos de móvil. Se
 * reduce solo esa hoja, nunca las demás.
 */
export async function asegurarQueQuepaSola(hoja, presupuesto = PRESUPUESTO_PETICION) {
  if (pesoEnPeticion(hoja) <= presupuesto) return hoja;
  try {
    return await compressImageForUpload(hoja);
  } catch {
    return hoja; // que decida el servidor; el 413 se maneja arriba
  }
}

/** Prepara las hojas de un estudiante: reduce las que no quepan y reparte. */
export async function prepararEnvio(hojas, presupuesto = PRESUPUESTO_PETICION) {
  const limitadas = hojas.slice(0, MAX_HOJAS_POR_ESTUDIANTE);
  const ajustadas = [];
  for (const hoja of limitadas) {
    ajustadas.push(await asegurarQueQuepaSola(hoja, presupuesto));
  }
  return repartirEnTandas(ajustadas, presupuesto);
}
