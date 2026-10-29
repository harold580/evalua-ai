import { useState } from 'react';
import { FileStack, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { MultiPageUploader } from './MultiPageUploader';
import { BatchGrader } from './BatchGrader';
import { MAX_HOJAS_POR_ESTUDIANTE } from '../services/payloadBudget';

/**
 * Pantalla principal: el docente elige QUÉ va a calificar.
 *
 * Antes esto tenía una pantalla previa con dos botones —"Usar Cámara" y "Subir
 * Archivos"— y el selector de modo vivía escondido detrás del segundo. Se quitó
 * esa capa: la decisión real del docente no es "cámara o archivo" sino
 * "un estudiante o el curso entero". El medio (cámara o archivos) se elige
 * DENTRO de cada modo, que es donde de verdad importa.
 *
 * La cámara no desapareció, cambió de sitio y ahora sirve para más:
 *   · un estudiante → MultiPageUploader, foto por hoja sin cerrar la cámara.
 *   · carga masiva  → CamaraRafaga, un examen tras otro.
 * La vista antigua de una sola foto se eliminó porque quedaba sin entrada y
 * duplicaba lo que ya hace el modo de un estudiante con una sola hoja.
 */
export const ImageUploader = ({ onAnalyzePages }) => {
  // 'elegir' = pantalla principal · 'individual' | 'lote'
  const [modo, setModo] = useState('elegir');

  return (
    <div className="w-full max-w-2xl mx-auto">
      <AnimatePresence mode="wait">
        {modo === 'elegir' && (
          <motion.div
            key="modo-elegir"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            <button
              onClick={() => setModo('individual')}
              className="group glass p-10 rounded-3xl flex flex-col items-center gap-4 hover:bg-white/10 transition-all border-dashed border-2 border-white/20"
            >
              <div className="p-4 bg-academic-teal/20 rounded-2xl group-hover:scale-110 transition-transform">
                <FileStack className="w-10 h-10 text-academic-teal" />
              </div>
              <div className="text-center">
                <span className="block text-xl font-bold text-white">Un estudiante</span>
                <span className="text-sm text-gray-400">
                  Su examen completo, hasta {MAX_HOJAS_POR_ESTUDIANTE} hojas → una sola nota
                </span>
              </div>
            </button>

            <button
              onClick={() => setModo('lote')}
              className="group glass p-10 rounded-3xl flex flex-col items-center gap-4 hover:bg-white/10 transition-all border-dashed border-2 border-white/20"
            >
              <div className="p-4 bg-academic-light/20 rounded-2xl group-hover:scale-110 transition-transform">
                <Users className="w-10 h-10 text-academic-light" />
              </div>
              <div className="text-center">
                <span className="block text-xl font-bold text-white">Carga masiva</span>
                <span className="text-sm text-gray-400">
                  Todo el curso de una vez → una nota por estudiante
                </span>
              </div>
            </button>
          </motion.div>
        )}

        {/* ── Un estudiante, varias hojas ── */}
        {modo === 'individual' && (
          <motion.div
            key="modo-individual"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
          >
            <MultiPageUploader onAnalyze={onAnalyzePages} onVolver={() => setModo('elegir')} />
          </motion.div>
        )}

        {/* ── Carga masiva ── */}
        {modo === 'lote' && (
          <motion.div
            key="modo-lote"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
          >
            <BatchGrader onVolver={() => setModo('elegir')} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
