import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload, Users, Play, RotateCw, Trash2, FileSpreadsheet, AlertTriangle,
  CheckCircle2, Clock, Loader2, XCircle, Camera, BookOpen,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { CamaraRafaga } from './CamaraRafaga';
import { leerZip, leerRar, agruparHojas, agruparPorCantidad, explicarAgrupacion } from '../services/loteArchivos';
import { procesarLote, reintentarUno } from '../services/motorLote';
import { descargarExcel } from '../services/exportarExcel';
import { MAX_HOJAS_POR_ESTUDIANTE } from '../services/payloadBudget';
import { validateImageFile } from '../services/security';
import { temasDelCurso } from '../services/nota';

const leerComoDataUrl = (file) => new Promise((resolve, reject) => {
  const lector = new FileReader();
  lector.onloadend = () => resolve(lector.result);
  lector.onerror = () => reject(new Error(`No se pudo leer "${file.name}".`));
  lector.readAsDataURL(file);
});

const ICONO_ESTADO = {
  pendiente: <Clock className="w-4 h-4 text-gray-500" />,
  calificando: <Loader2 className="w-4 h-4 text-academic-teal animate-spin" />,
  listo: <CheckCircle2 className="w-4 h-4 text-academic-emerald" />,
  error: <XCircle className="w-4 h-4 text-red-400" />,
};

export const BatchGrader = ({ onVolver }) => {
  const [estudiantes, setEstudiantes] = useState([]);
  const [fase, setFase] = useState('cargar'); // cargar · revisar · procesando · listo
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [leyendo, setLeyendo] = useState(false);
  // 'auto' = deducir por carpetas y nombres de archivo. Un número = todos los
  // exámenes tienen esa cantidad de hojas y se corta la lista en bloques.
  const [hojasPorExamen, setHojasPorExamen] = useState('auto');
  const [camaraAbierta, setCamaraAbierta] = useState(false);
  const inputRef = useRef(null);
  const canceladoRef = useRef(false);

  const actualizar = useCallback((indice, parcial) => {
    setEstudiantes((prev) => prev.map((e, i) => (i === indice ? { ...e, ...parcial } : e)));
  }, []);

  // ── Carga ───────────────────────────────────────────────────────────────
  // Convierte lo que entre (ZIP, RAR, imágenes sueltas o fotos de la cámara) en
  // grupos de hojas por estudiante, y deja al docente revisarlos antes de gastar
  // un solo crédito.
  const armarGrupos = (imagenes) => {
    const grupos = hojasPorExamen === 'auto'
      ? agruparHojas(imagenes)
      : agruparPorCantidad(imagenes, Number(hojasPorExamen));

    if (hojasPorExamen !== 'auto') {
      const n = Number(hojasPorExamen);
      const ultimo = grupos[grupos.length - 1];
      // Un último grupo incompleto casi siempre significa que falta o sobra una
      // foto: mejor avisarlo que calificar a medias en silencio.
      if (ultimo && ultimo.hojas.length !== n) {
        setAviso(
          `El último estudiante quedó con ${ultimo.hojas.length} hoja(s) en vez de ${n}. ` +
          'Revisa si falta o sobra alguna foto antes de calificar.'
        );
      }
    }

    const excedidos = grupos.filter((g) => g.hojas.length > MAX_HOJAS_POR_ESTUDIANTE);
    if (excedidos.length) {
      setAviso(
        `${excedidos.length} estudiante(s) traen más de ${MAX_HOJAS_POR_ESTUDIANTE} hojas. ` +
        `Solo se calificarán las primeras ${MAX_HOJAS_POR_ESTUDIANTE}.`
      );
    }

    setEstudiantes(grupos.map((g) => ({
      clave: g.clave,
      nombre: g.clave,
      hojas: g.hojas.slice(0, MAX_HOJAS_POR_ESTUDIANTE),
      estado: 'pendiente',
      resultado: null,
      resumen: null,
      error: null,
    })));
    setFase('revisar');
  };

  const cargarArchivos = async (archivos) => {
    setError(null);
    setAviso(null);
    setLeyendo(true);
    try {
      const lista = Array.from(archivos);
      const comprimido = lista.find((f) => /.(zip|rar)$/i.test(f.name));

      let imagenes;
      if (comprimido) {
        imagenes = /.rar$/i.test(comprimido.name)
          ? await leerRar(comprimido)   // carga el lector de RAR bajo demanda
          : await leerZip(comprimido);
      } else {
        imagenes = [];
        for (const file of lista) {
          const check = await validateImageFile(file);
          if (!check.valid) {
            setAviso(`Se omitió "${file.name}": ${check.error}`);
            continue;
          }
          imagenes.push({ ruta: file.name, src: await leerComoDataUrl(file) });
        }
        if (!imagenes.length) {
          setError('No se pudo leer ninguna imagen válida.');
          return;
        }
      }
      armarGrupos(imagenes);
    } catch (e) {
      setError(e.message);
    } finally {
      setLeyendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  // Las fotos de la ráfaga ya vienen en orden de captura.
  const usarFotos = (fotos) => {
    setCamaraAbierta(false);
    setError(null);
    setAviso(null);
    armarGrupos(fotos.map((src, i) => ({
      ruta: `foto-${String(i + 1).padStart(3, '0')}.jpg`,
      src,
    })));
  };

  // ── Calificación ────────────────────────────────────────────────────────
  const arrancar = async () => {
    canceladoRef.current = false;
    setFase('procesando');
    await procesarLote(estudiantes, {
      onCambio: (i, parcial) => {
        // El nombre que leyó la IA manda sobre la clave del archivo, si lo trae.
        if (parcial.resultado?.nombreEstudiante &&
            parcial.resultado.nombreEstudiante !== 'No especificado') {
          parcial.nombre = parcial.resultado.nombreEstudiante;
        }
        actualizar(i, parcial);
      },
      cancelado: () => canceladoRef.current,
    });
    setFase('listo');
  };

  // Las notas viven solo en memoria (ver motorLote.js). Para que no se pierdan
  // por un cierre accidental, el navegador pregunta antes de salir.
  useEffect(() => {
    const sinExportar = estudiantes.some((e) => e.estado === 'listo');
    if (!sinExportar) return;
    const avisar = (ev) => { ev.preventDefault(); ev.returnValue = ''; };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [estudiantes]);

  const reintentar = async (indice) => {
    await reintentarUno(estudiantes[indice], {
      onCambio: (parcial) => actualizar(indice, parcial),
    });
  };

  const exportar = () => {
    const filas = [
      ['Estudiante', 'Identificador', 'Aciertos', 'Incorrectas', 'Por revisar', 'Total', 'Nota'],
      // La nota que sale al Excel es SIEMPRE la que calculó el sistema a partir
      // de la lectura del modelo. No hay forma de escribirla a mano: la
      // calificación tiene que poder rastrearse hasta la hoja del examen.
      ...estudiantes.map((e) => {
        const r = e.resumen;
        const nota = r?.nota;
        return [
          e.nombre,
          e.clave,
          r?.correctas ?? '',
          r?.incorrectas ?? '',
          r?.porRevisar ?? '',
          r?.total ?? '',
          nota == null ? 'Sin calificar' : Number(nota.toFixed(1)),
        ];
      }),
    ];
    descargarExcel(filas, `notas-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const descartar = () => {
    canceladoRef.current = true;
    setEstudiantes([]);
    setFase('cargar');
    setError(null);
    setAviso(null);
  };

  const hechos = estudiantes.filter((e) => e.estado === 'listo').length;
  const fallidos = estudiantes.filter((e) => e.estado === 'error').length;

  return (
    <div className="space-y-5 text-left">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-academic-light" />
          <div>
            <h3 className="font-bold text-white">Carga masiva</h3>
            <p className="text-xs text-gray-400">
              {estudiantes.length
                ? `${estudiantes.length} estudiantes · ${hechos} calificados${fallidos ? ` · ${fallidos} con error` : ''}`
                : 'Todo el curso de una vez'}
            </p>
          </div>
        </div>
        <button onClick={onVolver} className="text-sm text-gray-400 hover:text-white transition-colors">
          ← Cambiar modo
        </button>
      </div>

      {/* ── Paso 1: cargar ── */}
      {fase === 'cargar' && !camaraAbierta && (
        <div className="space-y-4">
          {/* Cuántas hojas trae cada examen. Es lo que permite cortar bien un
              ZIP sin carpetas y, sobre todo, la ráfaga de fotos con la cámara. */}
          <div className="glass p-4 rounded-2xl">
            <p className="text-sm font-semibold text-white">¿Cuántas hojas tiene cada examen?</p>
            <p className="text-xs text-gray-400 mt-1">
              Si todos los exámenes tienen el mismo número de hojas, indícalo y el reparto es exacto.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              {['auto', 1, 2, 3, 4, 5, 6].map((op) => (
                <button
                  key={op}
                  onClick={() => setHojasPorExamen(op)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all border ${
                    hojasPorExamen === op
                      ? 'bg-academic-teal text-white border-academic-teal'
                      : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
                  }`}
                >
                  {op === 'auto' ? 'Detectar solo' : op}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-3">
              {hojasPorExamen === 'auto'
                ? 'Se agrupará por las carpetas del comprimido o por los nombres de archivo (1001_p1, 1001_p2…).'
                : `Las imágenes se cortarán en grupos de ${hojasPorExamen}, en orden.`}
            </p>
          </div>

          {/* Vía 1 y 2: comprimido o imágenes sueltas */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) cargarArchivos(e.dataTransfer.files); }}
            onClick={() => inputRef.current?.click()}
            className="glass p-8 rounded-3xl border-dashed border-2 border-white/20 hover:bg-white/5 transition-all cursor-pointer text-center"
          >
            {leyendo ? (
              <Loader2 className="w-9 h-9 text-academic-light mx-auto mb-3 animate-spin" />
            ) : (
              <Upload className="w-9 h-9 text-academic-light mx-auto mb-3" />
            )}
            <p className="font-semibold text-white">
              {leyendo ? 'Abriendo el archivo…' : 'Arrastra el ZIP o RAR del curso, o todas las imágenes'}
            </p>
            <p className="text-sm text-gray-400 mt-2 max-w-md mx-auto">
              El comprimido se abre aquí en tu computador y nunca se sube: solo viajan
              las hojas de un estudiante a la vez.
            </p>
            <input
              type="file"
              ref={inputRef}
              className="hidden"
              multiple
              accept=".zip,.rar,image/jpeg,image/png,image/webp"
              onChange={(e) => cargarArchivos(e.target.files)}
            />
          </div>

          {/* Vía 3: cámara en ráfaga */}
          <button
            onClick={() => { setError(null); setAviso(null); setCamaraAbierta(true); }}
            className="w-full glass p-6 rounded-3xl border-dashed border-2 border-white/20 hover:bg-white/5 transition-all flex items-center justify-center gap-4"
          >
            <div className="p-3 bg-academic-light/20 rounded-2xl">
              <Camera className="w-7 h-7 text-academic-light" />
            </div>
            <div className="text-left">
              <span className="block font-bold text-white">Fotografiar con la cámara</span>
              <span className="text-sm text-gray-400">
                Un examen tras otro sin cerrar la cámara
              </span>
            </div>
          </button>
        </div>
      )}

      {/* Ráfaga de fotos */}
      {fase === 'cargar' && camaraAbierta && (
        <CamaraRafaga
          hojasPorExamen={hojasPorExamen}
          onListo={usarFotos}
          onCancelar={() => setCamaraAbierta(false)}
        />
      )}

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 text-red-400">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}
      {aviso && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-3 text-amber-400">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">{aviso}</p>
        </div>
      )}

      {/* ── Paso 2: revisar los grupos antes de gastar créditos ── */}
      {fase === 'revisar' && (
        <div className="space-y-4">
          <div className="glass p-4 rounded-2xl">
            <p className="text-sm text-white font-semibold">Revisa cómo quedaron agrupadas las hojas</p>
            <p className="text-xs text-gray-400 mt-1">
              {explicarAgrupacion(estudiantes.map((e) => ({ hojas: e.hojas })))} Si algo quedó mal,
              descarta y renombra los archivos antes de calificar — así no gastas créditos de más.
            </p>
          </div>
          <ListaEstudiantes estudiantes={estudiantes} onQuitar={(i) =>
            setEstudiantes((prev) => prev.filter((_, j) => j !== i))} />
          <div className="flex gap-3">
            <button
              onClick={arrancar}
              disabled={!estudiantes.length}
              className="flex-1 py-4 bg-gradient-to-r from-academic-light to-academic-teal text-white font-bold rounded-2xl hover:shadow-academic-teal/40 shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <Play className="w-5 h-5" />
              Calificar {estudiantes.length} estudiante{estudiantes.length === 1 ? '' : 's'}
            </button>
            <button onClick={descartar} className="px-5 py-4 glass rounded-2xl text-gray-300 hover:text-white transition-all">
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 3 y 4: progreso y planilla ── */}
      {(fase === 'procesando' || fase === 'listo') && (
        <div className="space-y-4">
          {fase === 'procesando' && (
            <div className="glass p-4 rounded-2xl">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-white font-semibold">Calificando el curso…</span>
                <span className="text-gray-400 tabular-nums">{hechos} de {estudiantes.length}</span>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-academic-light to-academic-teal"
                  animate={{ width: `${estudiantes.length ? (hechos / estudiantes.length) * 100 : 0}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
              <button
                onClick={() => { canceladoRef.current = true; }}
                className="text-xs text-gray-400 hover:text-white mt-3"
              >
                Detener (conserva lo ya calificado)
              </button>
            </div>
          )}

          <ListaEstudiantes
            estudiantes={estudiantes}
            conNotas
            onReintentar={reintentar}
          />

          {fase === 'listo' && <TemasDelCurso estudiantes={estudiantes} />}

          {fase === 'listo' && (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={exportar}
                className="flex-1 py-4 bg-gradient-to-r from-academic-light to-academic-teal text-white font-bold rounded-2xl shadow-xl transition-all flex items-center justify-center gap-2"
              >
                <FileSpreadsheet className="w-5 h-5" />
                Exportar a Excel
              </button>
              <button
                onClick={descartar}
                className="px-5 py-4 glass rounded-2xl text-gray-300 hover:text-red-400 transition-all flex items-center justify-center gap-2"
              >
                <Trash2 className="w-5 h-5" />
                <span className="sm:hidden">Descartar lote</span>
              </button>
            </div>
          )}
          {fase === 'listo' && (
            <p className="text-xs text-gray-500">
              Nada de esto se guarda: ni las fotos ni las notas salen de esta pestaña.
              Exporta el Excel antes de cerrarla.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

// ── Temas a reforzar de todo el curso ───────────────────────────────────────
// Lo que el docente necesita cuando termina de calificar no es repasar alumno
// por alumno, sino saber qué tiene que volver a explicar en clase: las
// preguntas que falló buena parte del grupo.
const TemasDelCurso = ({ estudiantes }) => {
  const { temas, umbral, total } = temasDelCurso(
    estudiantes.filter((e) => e.estado === 'listo').map((e) => e.resultado)
  );

  if (!total) return null;

  return (
    <div className="glass rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-academic-light shrink-0" />
        <h4 className="font-bold text-white">Temas a reforzar del curso</h4>
      </div>

      {temas.length === 0 ? (
        <p className="text-sm text-gray-400">
          Ninguna pregunta la falló {umbral} estudiante{umbral === 1 ? '' : 's'} o más.
          Los fallos quedaron repartidos, así que no hay un tema del grupo que reexplicar.
        </p>
      ) : (
        <>
          <p className="text-xs text-gray-500">
            Preguntas que fallaron {umbral} estudiantes o más, de {total}.
          </p>
          <ul className="space-y-2">
            {temas.map((t) => (
              <li key={t.id} className="flex items-start gap-3">
                <span className="shrink-0 mt-0.5 px-2 py-0.5 bg-academic-light/10 border border-academic-light/20 text-academic-light rounded-lg text-xs font-bold tabular-nums">
                  {t.fallaron}/{t.total}
                </span>
                <p className="text-sm text-gray-300 min-w-0">
                  <b className="text-white">Pregunta {t.id}</b>
                  {t.consejo ? <> · {t.consejo}</> : null}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

// ── Lista de estudiantes ────────────────────────────────────────────────────
const ListaEstudiantes = ({ estudiantes, conNotas, onQuitar, onReintentar }) => (
  <div className="glass rounded-2xl divide-y divide-white/5 max-h-[420px] overflow-y-auto">
    {estudiantes.map((e, i) => (
      <div key={`${e.clave}-${i}`} className="flex items-center gap-3 p-3">
        {conNotas && <span className="shrink-0">{ICONO_ESTADO[e.estado]}</span>}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{e.nombre}</p>
          <p className="text-xs text-gray-500 truncate">
            {e.estado === 'error'
              ? e.error
              : e.resumen
                ? `${e.resumen.correctas}/${e.resumen.total} correctas` +
                  (e.resumen.porRevisar ? ` · ${e.resumen.porRevisar} por revisar` : '')
                : `${e.hojas.length} hoja${e.hojas.length === 1 ? '' : 's'}`}
          </p>
        </div>

        {/* La nota se muestra, NO se edita. Antes había aquí una casilla para
            corregirla a mano; se quitó a propósito: si alguien puede escribir
            encima de la nota, deja de ser rastreable hasta la hoja del examen. */}
        {conNotas && e.estado === 'listo' && (
          <span
            title="Nota calculada a partir de la lectura del examen"
            className="shrink-0 w-16 px-2 py-1 bg-white/5 border border-white/10 rounded-lg text-white text-sm text-right tabular-nums font-semibold"
          >
            {e.resumen?.notaTexto ?? '—'}
          </span>
        )}

        {conNotas && e.estado === 'error' && (
          <button
            onClick={() => onReintentar?.(i)}
            title="Reintentar este estudiante"
            className="p-2 text-gray-400 hover:text-white transition-colors shrink-0"
          >
            <RotateCw className="w-4 h-4" />
          </button>
        )}

        {onQuitar && (
          <button
            onClick={() => onQuitar(i)}
            title="Quitar del lote"
            className="p-2 text-gray-500 hover:text-red-400 transition-colors shrink-0"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    ))}
  </div>
);
