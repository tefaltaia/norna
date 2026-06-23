import express from 'express';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { readRunJson, runDir } from '../utils/runs_storage.js';

const router = express.Router();

router.get('/runs/:id/status', async (req, res) => {
  try {
    const meta = await readRunJson(req.params.id, 'metadata.json');
    res.json(meta);
  } catch {
    res.status(404).json({ error: 'Run no encontrado' });
  }
});

router.get('/runs/:id/phenology', async (req, res) => {
  try {
    const data = await readRunJson(req.params.id, 'step2_phenology.json');
    res.json(data);
  } catch {
    res.status(404).json({ error: 'Fenología no disponible aún' });
  }
});

router.get('/runs/:id/genome', async (req, res) => {
  try {
    const data = await readRunJson(req.params.id, 'step1_genome.json');
    res.json(data);
  } catch {
    res.status(404).json({ error: 'Genoma no disponible aún' });
  }
});

router.get('/runs/:id/fiware', async (req, res) => {
  try {
    const data = await readRunJson(req.params.id, 'step5_fiware.jsonld');
    res.json(data);
  } catch {
    res.status(404).json({ error: 'FIWARE payload no disponible aún' });
  }
});

router.get('/runs/:id/glb/:week', async (req, res) => {
  const p = path.join(runDir(req.params.id), `week_${req.params.week}.glb`);
  try {
    await access(p);
    res.setHeader('Content-Type', 'model/gltf-binary');
    createReadStream(p).pipe(res);
  } catch {
    res.status(404).json({ error: 'GLB no disponible' });
  }
});

router.get('/runs/:id/image/:week', async (req, res) => {
  const p = path.join(runDir(req.params.id), `week_${req.params.week}.png`);
  try {
    await access(p);
    res.setHeader('Content-Type', 'image/png');
    createReadStream(p).pipe(res);
  } catch {
    res.status(404).json({ error: 'Imagen no disponible' });
  }
});

export default router;
