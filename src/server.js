import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import analyzeRouter from './routes/analyze.js';
import streamRouter from './routes/stream.js';
import runsRouter from './routes/runs.js';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api', analyzeRouter);
app.use('/api', streamRouter);
app.use('/api', runsRouter);

app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.listen(config.port, () => {
  console.log(`🍅 Gemelo Digital servidor en http://localhost:${config.port}`);
  console.log(`   Anthropic API: ${config.anthropicApiKey ? '✓' : '✗ MISSING'}`);
  console.log(`   FAL API: ${config.falKey ? '✓' : '✗ MISSING'}`);
});
