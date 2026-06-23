import express from 'express';
import { getEmitter } from '../services/logger.js';

const router = express.Router();

router.get('/runs/:id/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();

  const emitter = getEmitter(req.params.id);

  const onLog = (payload) => res.write(`event: log\ndata: ${JSON.stringify(payload)}\n\n`);
  const onDone = (payload) => {
    res.write(`event: done\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  const onError = (payload) => {
    res.write(`event: error\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  emitter.on('log', onLog);
  emitter.on('DONE', onDone);
  emitter.on('ERROR', onError);

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    emitter.off('log', onLog);
    emitter.off('DONE', onDone);
    emitter.off('ERROR', onError);
  });
});

export default router;
