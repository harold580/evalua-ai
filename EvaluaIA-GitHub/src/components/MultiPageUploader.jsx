import { useEffect, useRef, useState } from 'react';
import {
  Upload, X, RotateCw, ArrowLeft, ArrowRight, Sparkles, AlertTriangle, FileStack, Camera, Check,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { validateImageFile } from '../services/security';
import { rotateImage, compressImageForUpload } from '../services/openRouterApi';
import { MAX_HOJAS_POR_ESTUDIANTE } from '../services/payloadBudget';
import { CameraPageView } from './CameraPageView';

const leerComoDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result);
  reader.onerror = () => reject(new Error(`No se pudo leer "${file.name}".`));
  reader.readAsDataURL(file);
});

/**
 * Examen de UN estudiante repartido en varias hojas (hasta 6).
 * El orden de las hojas importa: es el orden en que la IA leerá el examen, así
 * que el docente puede reordenarlas antes de analizar.
 *
 * Las hojas entran por dos vías que alimentan la MISMA lista y se pueden
 * mezclar: archivos ya guardados en el dispositivo, o fotos tomadas una por una
 * con la cámara. 6 es el tope, no una cuota: se califica con las que haya.
 */
export const MultiPageUploader = ({ onAnalyze, onVolver }) => {
  const [hojas, setHojas] = useState([]); // [{ id, src }]
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [camaraActiva, setCamaraActiva] = useState(false);
  const [capturando, setCapturando] = useState(false);
  const [videoListo, setVideoListo] = useState(false);
  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const captureRef = useRef(null);
  const streamRef = useRef(null); // ⚠️ fuente de verdad del stream — ver abrirCamara
  const contador = useRef(0); // ids únicos sin depender del nombre del archivo

  const nuevoId = (etiqueta) => {
    contador.current += 1;
    return `${etiqueta}-${contador.current}`;
  };

  const agregarArchivos = async (archivos) => {
    setError(null);
    const libres = MAX_HOJAS_POR_ESTUDIANTE - hojas.length;
    if (libres <= 0) {
      setError(`Ya tienes el máximo de ${MAX_HOJAS_POR_ESTUDIANTE} hojas.`);
      return;
    }

    const seleccionados = Array.from(archivos);
    if (seleccionados.length > libres) {
      setError(`Solo caben ${libres} hoja(s) más. Se tomaron las primeras.`);
    }

    const nuevas = [];
    for (const file of seleccionados.slice(0, libres)) {
      const check = await validateImageFile(file);
      if (!check.valid) {
        setError(`"${file.name}": ${check.error}`);
        continue;
      }
      try {
        nuevas.push({ id: nuevoId('archivo'), src: await leerComoDataUrl(file) });
      } catch (e) {
        setError(e.message);
      }
    }
    if (nuevas.length) setHojas((prev) => [...prev, ...nuevas]);
    if (inputRef.current) inputRef.current.value = '';
  };

  // ═══════════════════════════════════════════════════════════════════════
  //  ⚠️  CÁMARA — MISMAS REGLAS QUE EN ImageUploader.jsx  ⚠️
  //
  //  Ese archivo tiene el comentario largo con la historia completa. Lo corto:
  //  NO pongas un `await` entre activar la vista y usar `videoRef.current`, NO
  //  guardes el stream solo en `video.srcObject`, y NO quites el cleanup del
  //  useEffect (deja la cámara prendida y el siguiente intento falla).
  //
  //  La diferencia con ImageUploader: allá una foto cierra la cámara, porque es
  //  un examen de una sola imagen. Aquí la cámara SIGUE ABIERTA tras capturar:
  //  el docente fotografía hoja por hoja y solo cierra cuando él quiere (o
  //  cuando se llega al tope de 6). Capturar NO envía nada al modelo.
  // ═══════════════════════════════════════════════════════════════════════

  const abrirCamara = async () => {
    setVideoListo(false);
    setError(null);
    if (hojas.length >= MAX_HOJAS_POR_ESTUDIANTE) {
      setError(`Ya tienes el máximo de ${MAX_HOJAS_POR_ESTUDIANTE} hojas.`);
      return;
    }
    if (streamRef.current) return; // ya hay una cámara abierta, no pidas otra
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      // El stream se guarda ANTES de renderizar la vista: el useEffect de abajo
      // lo engancha en cuanto el <video> exista. Nunca al revés.
      streamRef.current = stream;
      setCamaraActiva(true);
    } catch (err) {
      console.error('Error accessing camera:', err);
      setCamaraActiva(false);
      setError(
        err?.name === 'NotAllowedError'
          ? 'Permiso de cámara denegado. Habilítalo en el navegador o sube las hojas como archivos.'
          : err?.name === 'NotFoundError'
            ? 'No se encontró ninguna cámara en este dispositivo.'
            : 'No se pudo abrir la cámara. Puedes subir las hojas como archivos.'
      );
    }
  };

  // Apaga la cámara SIEMPRE desde streamRef: si dependes de
  // videoRef.current.srcObject y el <video> ya se desmontó, los tracks quedan
  // vivos y la cámara se queda prendida (y ocupada para el siguiente intento).
  const cerrarCamara = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamaraActiva(false);
  };

  // Engancha el stream al <video> SOLO cuando el elemento ya está montado. Este
  // efecto es el que evita la pantalla negra: no depende del timing de
  // getUserMedia, depende del ciclo de vida de React.
  useEffect(() => {
    if (!camaraActiva) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    // Safari/iOS a veces no arranca solo aunque el <video> tenga autoPlay.
    video.play()?.catch(() => {});
  }, [camaraActiva]);

  // Si el componente se desmonta con la cámara abierta, apágala igual. Va
  // directo contra streamRef (no llama a cerrarCamara) para no tocar el estado
  // de un componente ya desmontado.
  useEffect(() => () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const capturarHoja = async () => {
    if (capturando) return;
    const validated = captureRef.current?.();
    if (!validated?.canvas) {
      setError(validated?.error || 'Espera a que la cámara muestre suficiente detalle.');
      return;
    }
    setCapturando(true);
    try {
      const canvas = validated.canvas;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

      // Comprimir para respetar el límite de payload de Vercel (~4,5 MB del
      // request COMPLETO, con todas las hojas sumadas). Si falla, va la
      // original: payloadBudget vuelve a repartir en tandas más adelante.
      let src = dataUrl;
      try {
        src = await compressImageForUpload(dataUrl);
      } catch (err) {
        console.warn('Compresión falló, usando imagen original:', err);
      }

      const quedanLibres = MAX_HOJAS_POR_ESTUDIANTE - (hojas.length + 1);
      setHojas((prev) => [...prev, { id: nuevoId('camara'), src }]);
      setError(null);
      // La cámara se queda abierta para la siguiente hoja. Solo se cierra sola
      // al llegar al tope, porque ya no cabe ninguna más.
      if (quedanLibres <= 0) cerrarCamara();
    } finally {
      setCapturando(false);
    }
  };

  const quitar = (id) => setHojas((prev) => prev.filter((h) => h.id !== id));

  const mover = (indice, salto) => {
    const destino = indice + salto;
    if (destino < 0 || destino >= hojas.length) return;
    setHojas((prev) => {
      const copia = [...prev];
      [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
      return copia;
    });
  };

  // Misma razón que en la vista de una sola foto: una página de lado se lee
  // mucho peor, y aquí además arrastraría el error al resto del examen.
  const girar = async (id) => {
    if (ocupado) return;
    setOcupado(true);
    try {
      const hoja = hojas.find((h) => h.id === id);
      const girada = await rotateImage(hoja.src, 90);
      setHojas((prev) => prev.map((h) => (h.id === id ? { ...h, src: girada } : h)));
    } catch {
      setError('No se pudo girar la hoja.');
    } finally {
      setOcupado(false);
    }
  };

  const soltar = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) agregarArchivos(e.dataTransfer.files);
  };

  const lleno = hojas.length >= MAX_HOJAS_POR_ESTUDIANTE;

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <FileStack className="w-6 h-6 text-academic-teal" />
          <div className="text-left">
            <h3 className="font-bold text-white">Examen de un estudiante</h3>
            <p className="text-xs text-gray-400">
              {hojas.length} de {MAX_HOJAS_POR_ESTUDIANTE} hojas · una sola calificación
            </p>
          </div>
        </div>
        <button onClick={onVolver} className="self-end text-sm text-gray-400 hover:text-white transition-colors sm:self-auto">
          ← Cambiar modo
        </button>
      </div>

      {/* ── Cámara hoja por hoja: capturar NO envía nada, solo suma a la lista ── */}
      {camaraActiva ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass rounded-3xl shadow-2xl overflow-hidden"
        >
          {/* La imagen va limpia: encima solo queda el contador. Los botones
              estaban flotando sobre el video y tapaban justo la hoja que el
              docente está encuadrando, así que bajaron a su propia barra. */}
          {/* El contador va en su propia franja, no encima de la hoja. */}
          <div className="border-b border-white/10 bg-black/40 px-4 py-2 text-center text-xs font-bold text-white sm:text-sm">
            Vas por la hoja {hojas.length + 1} de {MAX_HOJAS_POR_ESTUDIANTE}
          </div>

          <CameraPageView videoRef={videoRef} onReady={setVideoListo} captureRef={captureRef} />

          {/* Barra de controles, debajo del video y no encima. */}
          <div className="flex items-center gap-2 border-t border-white/10 bg-black/40 p-3 sm:gap-3 sm:p-4">
            <button
              onClick={cerrarCamara}
              title="Cerrar la cámara"
              className="flex min-h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-red-500/20 text-red-400 transition-all hover:bg-red-500 hover:text-white"
            >
              <X className="w-6 h-6" />
            </button>

            <button
              onClick={capturarHoja}
              disabled={capturando || !videoListo}
              className="min-h-14 flex-1 rounded-2xl bg-white px-3 py-3 text-sm font-bold text-academic-dark sm:px-4 sm:text-base shadow-xl transition-all hover:bg-academic-teal hover:text-white disabled:opacity-60"
            >
              {capturando ? 'Guardando…' : `Tomar hoja ${hojas.length + 1}`}
            </button>

            <button
              onClick={cerrarCamara}
              title="Terminar de tomar fotos"
              className="flex min-h-14 shrink-0 items-center justify-center gap-2 rounded-2xl bg-academic-teal/40 px-4 py-3 font-bold text-white transition-all hover:bg-academic-teal sm:px-5"
            >
              <Check className="w-6 h-6" />
              <span>Listo</span>
            </button>
          </div>

          <p className="px-4 pb-3 text-center text-[11px] leading-4 text-gray-400">
            La cámara se queda abierta: toma una hoja tras otra y presiona «Listo» cuando termines.
          </p>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={soltar}
            onClick={() => inputRef.current?.click()}
            className="glass p-8 rounded-3xl border-dashed border-2 border-white/20 hover:bg-white/5 transition-all cursor-pointer text-center"
          >
            <Upload className="w-8 h-8 text-academic-teal mx-auto mb-3" />
            <p className="font-semibold text-white">Desde el dispositivo</p>
            <p className="text-sm text-gray-400 mt-1">
              Arrastra las hojas o haz clic · JPG, PNG o WebP · puedes seleccionarlas todas de una vez
            </p>
            <input
              type="file"
              ref={inputRef}
              className="hidden"
              multiple
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => agregarArchivos(e.target.files)}
            />
          </div>

          <button
            onClick={abrirCamara}
            disabled={lleno}
            className="glass p-8 rounded-3xl border-dashed border-2 border-white/20 hover:bg-white/5 transition-all text-center disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Camera className="w-8 h-8 text-academic-light mx-auto mb-3" />
            <p className="font-semibold text-white">
              {hojas.length > 0 ? 'Seguir con la cámara' : 'Tomar las fotos ahora'}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              {lleno
                ? `Ya tienes las ${MAX_HOJAS_POR_ESTUDIANTE} hojas`
                : 'Hoja por hoja, sin cerrar la cámara. Nada se envía hasta que tú lo decidas.'}
            </p>
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-3 text-amber-400">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium text-left">{error}</p>
        </div>
      )}

      <AnimatePresence>
        {hojas.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-2 md:grid-cols-3 gap-3"
          >
            {hojas.map((hoja, i) => (
              <motion.div
                key={hoja.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="relative glass rounded-2xl overflow-hidden group"
              >
                <img src={hoja.src} alt={`Hoja ${i + 1}`} className="w-full h-40 object-cover" />
                <span className="absolute top-2 left-2 px-2 py-0.5 bg-black/70 text-white text-xs font-bold rounded-lg">
                  Hoja {i + 1}
                </span>
                <button
                  onClick={() => quitar(hoja.id)}
                  title="Quitar hoja"
                  className="absolute top-2 right-2 p-1.5 bg-black/60 text-white rounded-lg hover:bg-red-500 transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="absolute bottom-2 left-2 right-2 flex justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => mover(i, -1)}
                    disabled={i === 0}
                    title="Mover antes"
                    className="p-1.5 bg-black/70 text-white rounded-lg hover:bg-black disabled:opacity-30"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => girar(hoja.id)}
                    disabled={ocupado}
                    title="Girar"
                    className="p-1.5 bg-black/70 text-white rounded-lg hover:bg-black disabled:opacity-30"
                  >
                    <RotateCw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => mover(i, 1)}
                    disabled={i === hojas.length - 1}
                    title="Mover después"
                    className="p-1.5 bg-black/70 text-white rounded-lg hover:bg-black disabled:opacity-30"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* El botón de calificar no aparece mientras la cámara está abierta: ahí el
          docente todavía está juntando hojas, no enviando. */}
      {hojas.length > 0 && !camaraActiva && (
        <>
          <p className="text-xs text-gray-400">
            Revisa que el orden sea el del examen: la IA las lee en este orden y numera las preguntas de corrido.
          </p>
          <button
            onClick={() => onAnalyze(hojas.map((h) => h.src))}
            className="w-full py-5 bg-gradient-to-r from-academic-light to-academic-teal text-white font-bold text-xl rounded-2xl shadow-xl hover:shadow-academic-teal/40 transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
          >
            <Sparkles className="w-6 h-6" />
            Calificar {hojas.length === 1 ? 'la hoja' : `las ${hojas.length} hojas`}
          </button>
        </>
      )}
    </div>
  );
};
