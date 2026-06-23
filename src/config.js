import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  voyageApiKey: process.env.VOYAGE_API_KEY,
  falKey: process.env.FAL_KEY,
  chromaPath: path.resolve(ROOT, process.env.CHROMA_PATH || './data/chroma'),
  runsDir: path.resolve(ROOT, process.env.RUNS_DIR || './runs'),
  qtlCatalogPath: path.resolve(ROOT, './data/qtl_catalog.json'),
};
