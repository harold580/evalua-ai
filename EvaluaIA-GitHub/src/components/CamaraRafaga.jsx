import { useEffect, useRef, useState } from 'react';
import { Camera, Check, X, Undo2, AlertTriangle } from 'lucide-react';
import { compressImageForUpload } from '../services/openRouterApi';
import { CameraPageView } from './CameraPageView';

/**
 * Cámara en ráfaga para calificar un curso entero sin cerrarla entre foto y foto.
 *
 * El docente fotografía hoja tras hoja y la cámara SIGUE ABIERTA. Al terminar,
 * las fotos se entregan en el orden en que se tomaron y el lote las corta en
 * grupos según las hojas por examen que haya indicado.
 *
 * Capturar NO envía nada al modelo: eso ocurre después, ya con los grupos
 * revisados por el docente.
 */

// ═══════════════════════════════════════════════════════════════════════════
//  ⚠️  CÁMARA — MISMAS REGLAS QUE EN ImageUploader.jsx  ⚠️
//
//  Ese archivo tiene la historia completa de por qué se rompía. En corto:
//    · NO pongas un `await` entre activar la vista y usar `videoRef.current`.
//    · NO guardes el stream únicamente en `video.srcObject`.
//    · NO quites el cleanup del useEffect: deja la cámara prendida y ocupada,
//      y entonces el siguiente intento falla.
//  Si funciona, déjala quieta, y pruébala en móvil antes de dar por bueno
//  cualquier cambio.
// ═══════════════════════════════════════════════════════════════════════════

export const CamaraRafaga = ({ hojasPorExamen, onListo, onCancelar }) => {
  const [fotos, setFotos] = useState([]);
  const [error, setError] = useState(null);
  const [lista, setLista] = useState(false);
  const [capturando, setCapturando] = useState(false);
  const [videoListo, setVideoListo] = useState(false);
  const videoRef = useRef(null);
  const captureRef = useRef(null);
  const streamRef = useRef(null); // ⚠️ fuente de verdad del stream

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setLista(true);
      } catch (err) {
        setError(
          err?.name === 'NotAllowedError'
            ? 'Permiso de cámara denegado. Habilítalo en el navegador o sube las fotos como archivos.'
            : err?.name === 'NotFoundError'
              ? 'No se encontró ninguna cámara en este dispositivo.'
              : 'No se pudo abrir la cámara. Puedes subir las fotos como archivos.'
        );
      }
    })();
    return () => { cancelado = true; };
  }, []);

  // Engancha el stream al <video> solo cuando el elemento ya está montado.
  useEffect(() => {
    if (!lista) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play()?.catch(() => {});
  }, [lista]);

  // Apaga la cámara al desmontar, pase lo que pase.
  useEffect(() => () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const capturar = async () => {
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
      let src = dataUrl;
      try {
        src = await compressImageForUpload(dataUrl);
      } catch {
        // Si la compresión falla se usa la original: payloadBudget ya reparte
        // en tandas más adelante si hace falta.
      }
      setFotos((prev) => [...prev, src]);
      setError(null);
    } finally {
      setCapturando(false);
    }
  };

  const deshacer = () => setFotos((prev) => prev.slice(0, -1));

  const n = hojasPorExamen === 'auto' ? null : Number(hojasPorExamen);
  const estudiantes = n ? Math.floor(fotos.length / n) : fotos.length;
  const enCurso = n ? fotos.length % n : 0;

  return (
    <div className="space-y-4">
      {/* Misma distribución que en el modo de un estudiante: nada encima del
          video. El contador va en una franja arriba y los botones en una barra
          abajo, para que el docente vea la hoja que está encuadrando. */}
      <div className="rounded-3xl overflow-hidden glass shadow-2xl">
        <div className="border-b border-white/10 bg-black/40 px-4 py-2 text-center text-xs sm:text-sm">
          <span className="text-white font-bold tabular-nums">{fotos.length}</span>
          <span className="text-gray-400"> foto{fotos.length === 1 ? '' : 's'}</span>
          {n && (
            <span className="text-academic-teal ml-2">
              · {estudiantes} estudiante{estudiantes === 1 ? '' : 's'}
              {enCurso > 0 && ` (+${enCurso} hoja${enCurso === 1 ? '' : 's'})`}
            </span>
          )}
        </div>

        <CameraPageView videoRef={videoRef} onReady={setVideoListo} captureRef={captureRef} />

        <div className="flex items-center gap-2 border-t border-white/10 bg-black/40 p-3 sm:gap-3 sm:p-4">
          <button
            onClick={onCancelar}
            title="Cancelar"
            className="flex min-h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-red-500/20 text-red-400 transition-all hover:bg-red-500 hover:text-white"
          >
            <X className="w-6 h-6" />
          </button>

          <button
            onClick={capturar}
            disabled={capturando || !videoListo}
            className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-white px-3 py-3 text-sm font-bold text-academic-dark shadow-xl transition-all hover:bg-academic-teal hover:text-white disabled:opacity-60 sm:px-4 sm:text-base"
          >
            <Camera className="w-5 h-5" />
            Tomar foto
          </button>

          <button
            onClick={deshacer}
            disabled={!fotos.length}
            title="Deshacer la última"
            className="flex min-h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-black/50 text-white transition-all hover:bg-black/70 disabled:opacity-30"
          >
            <Undo2 className="w-6 h-6" />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-3 text-amber-400">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {fotos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {fotos.map((src, i) => (
            <div key={i} className="relative shrink-0">
              <img src={src} alt={`Foto ${i + 1}`} className="h-20 w-16 object-cover rounded-lg" />
              <span className="absolute bottom-1 left-1 px-1.5 bg-black/70 text-white text-[10px] font-bold rounded">
                {i + 1}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400">
        {n
          ? `Fotografía las ${n} hojas de un estudiante, sigue con el siguiente y así hasta terminar el curso. La cámara no se cierra.`
          : 'Cada foto se tomará como un estudiante distinto. Si cada examen tiene varias hojas, vuelve atrás e indica cuántas.'}
      </p>

      <button
        onClick={() => onListo(fotos)}
        disabled={!fotos.length || capturando}
        className="w-full py-4 bg-gradient-to-r from-academic-light to-academic-teal text-white font-bold rounded-2xl shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-40"
      >
        <Check className="w-5 h-5" />
        Terminar y revisar los grupos
      </button>
    </div>
  );
};
