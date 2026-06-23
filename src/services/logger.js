import { EventEmitter } from 'node:events';

const emitters = new Map();

export function getEmitter(runId) {
  if (!emitters.has(runId)) {
    const ee = new EventEmitter();
    ee.setMaxListeners(20);
    emitters.set(runId, ee);
  }
  return emitters.get(runId);
}

export function createLogger(runId) {
  const emitter = getEmitter(runId);
  const send = (level, msg, data = {}) => {
    const payload = { ts: new Date().toISOString(), level, msg, ...data };
    console.log(`[${runId}] [${level}] ${msg}`);
    emitter.emit('log', payload);
  };
  return {
    info: (msg, data) => send('info', msg, data),
    debug: (msg, data) => send('debug', msg, data),
    error: (msg, data) => send('error', msg, data),
    event: (type, data) => emitter.emit(type, data)
  };
}
