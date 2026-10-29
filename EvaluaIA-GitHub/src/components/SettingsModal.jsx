import { useState, useEffect } from 'react';
import { Settings, X, ShieldCheck, AlertTriangle, Cpu } from 'lucide-react';
import { getServerConfig } from '../services/openRouterApi';

export const SettingsModal = ({ isOpen, onClose }) => {
  const [serverConfig, setServerConfig] = useState({
    hasServerKey: false,
    provider: 'OpenRouter',
    model: 'openai/gpt-6-luna',
  });
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    getServerConfig()
      .then((config) => {
        if (!cancelled) setServerConfig(config);
      });

    return () => { cancelled = true; };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md glass p-8 rounded-3xl shadow-2xl animate-in zoom-in duration-300">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Settings className="w-5 h-5 text-academic-teal" /> Configuración de IA
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-5">
          {serverConfig.hasServerKey ? (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-2.5">
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-emerald-300">OpenRouter configurado</h4>
                <p className="text-xs text-emerald-300/80 mt-1">
                  La clave está protegida en el servidor y nunca se envía al navegador.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-amber-300">Falta configurar OpenRouter</h4>
                <p className="text-xs text-amber-300/80 mt-1">
                  Define OPENROUTER_API_KEY en el servidor y reinicia o vuelve a desplegar la aplicación.
                </p>
              </div>
            </div>
          )}

          <div className="p-4 bg-white/5 border border-white/10 rounded-xl flex items-center gap-3">
            <Cpu className="w-5 h-5 text-academic-teal" />
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400">Modelo principal</p>
              <p className="text-sm font-semibold text-white">
                {serverConfig.model || 'openai/gpt-6-luna'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full py-4 rounded-xl font-bold bg-academic-teal text-white shadow-lg shadow-academic-teal/20"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
