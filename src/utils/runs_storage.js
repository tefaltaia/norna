import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

export function runDir(runId) {
  return path.join(config.runsDir, runId);
}

export async function readRunFile(runId, filename) {
  const p = path.join(runDir(runId), filename);
  return readFile(p);
}

export async function readRunJson(runId, filename) {
  const buf = await readRunFile(runId, filename);
  return JSON.parse(buf.toString('utf-8'));
}
