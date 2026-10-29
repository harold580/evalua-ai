import { useEffect, useRef, useState } from 'react';
import { analyzeCameraFrame, createCaptureGate, pageGuide, SAMPLE_SIZE, SAMPLE_INTERVAL, MAX_FRAME_AGE } from '../services/cameraQuality';

const WAITING = { ready: false, code: 'waiting', message: 'Esperando imagen de la cámara…' };

/** Ambas cámaras comparten el detector y la autorización del fotograma a guardar. */
export const CameraPageView = ({ videoRef, onReady, captureRef }) => {
  const [ratio, setRatio] = useState(4 / 3);
  const [horizontal, setHorizontal] = useState(false);
  const horizontalRef = useRef(false);
  const [status, setStatus] = useState(WAITING);
  const resetRef = useRef(null);
  const guide = pageGuide(ratio, 1, horizontal);

  useEffect(() => { horizontalRef.current = horizontal; }, [horizontal]);

  useEffect(() => {
    const gate = createCaptureGate();
    const sampleCanvas = document.createElement('canvas');
    const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
    let lastVideoTime = -1, lastFreshAt = -Infinity;
    let lastPublished = '', disposed = false;
    const publish = (next) => {
      if (disposed) return;
      const key = `${next.ready}:${next.code}:${next.message}`;
      if (lastPublished === key) return;
      lastPublished = key;
      setStatus(next);
      onReady(next.ready);
    };
    const block = (message, code = 'waiting') => {
      gate.reset();
      publish({ ready: false, code, message });
      return { error: message };
    };
    const available = () => {
      const video = videoRef.current;
      return !document.hidden && video && video.readyState >= 2 && !video.paused && !video.ended
        && video.videoWidth > 0 && video.videoHeight > 0
        && video.srcObject?.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted);
    };
    const sample = (source) => {
      if (!context) throw new Error('Canvas no disponible');
      const width = source.videoWidth || source.width, height = source.videoHeight || source.height;
      const scale = Math.min(1, SAMPLE_SIZE / Math.max(width, height));
      sampleCanvas.width = Math.round(width * scale);
      sampleCanvas.height = Math.round(height * scale);
      context.drawImage(source, 0, 0, sampleCanvas.width, sampleCanvas.height);
      return analyzeCameraFrame(context.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height), horizontalRef.current);
    };
    const tick = () => {
      if (!available()) { block('Esperando imagen de la cámara…'); return; }
      const now = performance.now(), video = videoRef.current;
      if (video.currentTime === lastVideoTime) {
        if (now - lastFreshAt > MAX_FRAME_AGE) block('La imagen se detuvo. Espera a que la cámara vuelva a transmitir.');
        return;
      }
      lastVideoTime = video.currentTime; lastFreshAt = now;
      try { publish(gate.observe(sample(video), now)); }
      catch { block('No se pudo comprobar la imagen. Cierra y vuelve a abrir la cámara.', 'error'); }
    };
    // Se valida el mismo canvas que el padre codificará, incluso después del verde.
    captureRef.current = () => {
      const now = performance.now();
      if (!available() || !gate.canCapture(now) || now - lastFreshAt > MAX_FRAME_AGE) {
        return block('Espera a que la cámara muestre suficiente detalle.');
      }
      try {
        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const captureContext = canvas.getContext('2d');
        if (!captureContext) throw new Error('Canvas no disponible');
        captureContext.drawImage(video, 0, 0);
        const current = gate.observe(sample(canvas), now);
        publish(current);
        if (!current.ready) return { error: current.message };
        return { canvas };
      } catch { return block('No se pudo verificar la foto. Intenta nuevamente.', 'error'); }
    };
    resetRef.current = () => block('Comprobando el detalle de la imagen…');
    const visibilityChanged = () => { lastFreshAt = -Infinity; block('Esperando imagen de la cámara…'); };
    document.addEventListener('visibilitychange', visibilityChanged);
    const timer = setInterval(tick, SAMPLE_INTERVAL);
    onReady(false);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibilityChanged);
      gate.reset(); captureRef.current = null; resetRef.current = null;
      onReady(false);
    };
  }, [videoRef, onReady, captureRef]);

  const color = status.ready ? status.recommendation ? 'border-amber-400' : 'border-emerald-400' : 'border-red-400';
  return (
    <div className="bg-black/60">
      <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-gray-300">
        <span>El marco es una guía: no necesitas encajar la hoja exactamente.</span>
        <button type="button" onClick={() => {
          setHorizontal((value) => !value);
        }} className="shrink-0 rounded-lg border border-white/30 px-2 py-1 text-white hover:bg-white/10"
          aria-label="Cambiar orientación de la guía">
          {horizontal ? 'Hoja horizontal' : 'Hoja vertical'}
        </button>
      </div>
      <div className="relative mx-auto overflow-hidden bg-black"
        style={{ width: `min(100%, ${62 * ratio}svh)`, aspectRatio: ratio }}>
        <video ref={videoRef} autoPlay playsInline muted className="block h-full w-full object-contain"
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            if (video.videoWidth && video.videoHeight) setRatio(video.videoWidth / video.videoHeight);
            resetRef.current?.();
          }}
          onEmptied={() => resetRef.current?.()}
          onError={() => resetRef.current?.()}
          onEnded={() => resetRef.current?.()}
          onPause={() => resetRef.current?.()}
        />
        <div aria-hidden="true" data-page-guide data-capture-ready={status.ready}
          className={`pointer-events-none absolute rounded-sm border-2 ${color}`}
          style={{ left: `${guide.x * 100}%`, top: `${guide.y * 100}%`, width: `${guide.width * 100}%`,
            height: `${guide.height * 100}%`, boxShadow: '0 0 0 9999px rgb(0 0 0 / 28%)' }}>
          {['-left-0.5 -top-0.5 border-l-4 border-t-4', '-right-0.5 -top-0.5 border-r-4 border-t-4',
            '-left-0.5 -bottom-0.5 border-l-4 border-b-4', '-right-0.5 -bottom-0.5 border-r-4 border-b-4'].map((corner) => (
            <span key={corner} className={`absolute h-7 w-7 ${color} ${corner}`} />
          ))}
        </div>
      </div>
      <p role="status" aria-live="polite" data-camera-status={status.code}
        className={`min-h-12 px-4 py-2 text-center text-xs ${status.ready ? 'text-emerald-300' : 'text-gray-200'}`}>
        {status.message}
      </p>
    </div>
  );
};
