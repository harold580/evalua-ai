// Precarga para todas las pruebas de Node: las únicas respuestas de IA son mocks.
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

for (const key of Object.keys(process.env)) {
  if (key.startsWith('OPENROUTER_') || key === 'DEBUG_GRADE') delete process.env[key];
}
process.env.NODE_ENV = 'test';
const blocked = () => { throw new Error('Prueba offline: conexión de red bloqueada.'); };
globalThis.fetch = blocked;
net.Socket.prototype.connect = blocked;
syncBuiltinESMExports();
