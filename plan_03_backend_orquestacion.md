# Plan 03 — Backend: orquestación y los 5 pasos del pipeline

## Pipeline de 5 pasos: VCF → RAG/Claude → FLUX → Tripo → FIWARE

### 3.1 Endpoint principal `POST /api/analyze`

**Request:**
```json
{
  "vcf_filename": "tomato_sample.vcf",
  "vcf_content": "ATCG content as text",
  "location": { "lat": 40.4168, "lon": -3.7038, "label": "Madrid" },
  "sowing_date": "2026-03-15",
  "weeks": 4
}
```

**Response inmediata:**
```json
{ "run_id": "r_a1b2c3d4", "stream_url": "/api/runs/r_a1b2c3d4/stream" }
```

El cliente abre inmediatamente un `EventSource` contra `stream_url` para recibir logs en tiempo real.

---

## Orquestador `src/pipeline/orchestrator.js`

```js
import { v4 as uuidv4 } from 'uuid';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseVcf } from './step1_vcf.js';
import { generatePhenologyJson } from './step2_rag.js';
import { generateImages } from './step3_images.js';
import { generate3DModels } from './step4_models3d.js';
import { buildFiwarePayloads } from './step5_fiware.js';
import { createLogger } from '../services/logger.js';

export async function runPipeline({ vcfContent, location, sowingDate, weeks }) {
  const runId = `r_${uuidv4().slice(0, 8)}`;
  const runDir = path.join(process.env.RUNS_DIR, runId);
  await mkdir(runDir, { recursive: true });

  const logger = createLogger(runId);
  logger.info('🌱 Run iniciado', { runId, weeks, location });

  // Persistir input crudo
  await writeFile(path.join(runDir, 'input.vcf'), vcfContent);
  await writeFile(path.join(runDir, 'metadata.json'),
    JSON.stringify({ runId, location, sowingDate, weeks, startedAt: new Date().toISOString() }, null, 2));

  // Lanzar pipeline asincrónico (no await — devolvemos runId al cliente ya)
  (async () => {
    try {
      // PASO 1 — Parseo VCF
      logger.info('🧬 [1/5] Parseando archivo VCF...');
      const genomeSummary = await parseVcf(vcfContent, logger);
      await writeFile(path.join(runDir, 'step1_genome.json'),
        JSON.stringify(genomeSummary, null, 2));
      logger.info(`✓ VCF parseado: ${genomeSummary.totalVariants} variantes, ${genomeSummary.keyVariants.length} de interés`);

      // PASO 2 — RAG + Claude
      logger.info('📚 [2/5] Consultando base de conocimiento + Claude...');
      const phenologyJson = await generatePhenologyJson({
        genomeSummary, location, sowingDate, weeks
      }, logger);
      await writeFile(path.join(runDir, 'step2_phenology.json'),
        JSON.stringify(phenologyJson, null, 2));
      logger.info(`✓ Fenología generada para ${weeks} semanas`);

      // PASO 3 — Imágenes (FLUX image-to-image encadenado)
      logger.info('🎨 [3/5] Generando imágenes con fal.ai FLUX...');
      const imagePaths = await generateImages(phenologyJson, runDir, logger);
      logger.info(`✓ ${imagePaths.length} imágenes generadas`);

      // PASO 4 — Modelos 3D (Tripo en paralelo)
      logger.info('🧊 [4/5] Generando modelos 3D con fal.ai Tripo...');
      const glbPaths = await generate3DModels(imagePaths, runDir, logger);
      logger.info(`✓ ${glbPaths.length} modelos GLB generados`);

      // PASO 5 — Payloads FIWARE
      logger.info('📡 [5/5] Construyendo payloads NGSI-LD FIWARE...');
      const fiwareEntities = await buildFiwarePayloads({
        runId, location, sowingDate, phenologyJson, genomeSummary
      });
      await writeFile(path.join(runDir, 'step5_fiware.jsonld'),
        JSON.stringify(fiwareEntities, null, 2));
      logger.info(`✓ ${fiwareEntities.length} entidades NGSI-LD generadas`);

      logger.info('🎉 Pipeline completado. Visor listo.');
      logger.event('DONE', { runId });
    } catch (err) {
      logger.error('💥 Pipeline falló', { error: err.message, stack: err.stack });
      logger.event('ERROR', { error: err.message });
    }
  })();

  return { runId };
}
```

---

## Paso 1 — Parseo VCF `src/pipeline/step1_vcf.js`

**Objetivo:** del VCF crudo extraer un resumen útil. No queremos pasar 5000 variantes al LLM — queremos las que importan.

**Estrategia:** mantener un **catálogo curado de QTLs/variantes** en `data/qtl_catalog.json` y hacer match.

```js
import fs from 'node:fs';

const QTL_CATALOG = JSON.parse(fs.readFileSync('./data/qtl_catalog.json', 'utf-8'));

const TOLERANCE = 50000; // bp de tolerancia para matchear posición

export async function parseVcf(vcfContent, logger) {
  const lines = vcfContent.split(/\r?\n/);
  let totalVariants = 0;
  const keyVariants = [];

  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    totalVariants++;
    const [chrom, pos, _id, ref, alt] = line.split('\t');
    const position = parseInt(pos, 10);

    for (const qtl of QTL_CATALOG) {
      if (qtl.chrom === chrom && Math.abs(qtl.pos - position) < TOLERANCE) {
        keyVariants.push({
          chrom, position, ref, alt,
          qtl_match: qtl.name,
          trait: qtl.trait,
          effect: qtl.effect
        });
        logger.debug(`  · Match QTL: ${qtl.name} (${qtl.trait}) en ${chrom}:${position}`);
      }
    }
  }

  const inferredCultivar = inferCultivar(keyVariants);

  return {
    totalVariants,
    keyVariants,
    inferredCultivar,
    species: 'Solanum lycopersicum'
  };
}

function inferCultivar(keyVariants) {
  const traits = new Set(keyVariants.map(v => v.trait));
  if (traits.has('peso_fruto') && keyVariants.some(v => v.qtl_match === 'fw2.2')) {
    return 'Tipo beef/Heinz (fruto grande)';
  }
  if (traits.has('licopeno') && !traits.has('peso_fruto')) {
    return 'Tipo cherry (fruto pequeño, alto licopeno)';
  }
  if (traits.has('tolerancia_sequia')) {
    return 'Variedad rústica/silvestre tolerante a sequía';
  }
  return 'Variedad comercial estándar';
}
```

---

## Paso 2 — RAG + Claude `src/pipeline/step2_rag.js`

**Objetivo:** generar un JSON con la descripción detallada de las 4 semanas.

```js
import Anthropic from '@anthropic-ai/sdk';
import { ChromaClient } from 'chromadb';
import { embedQuery } from '../services/voyage.js';
import { fetchWeatherForLocation } from '../services/weather.js';

const anthropic = new Anthropic();
const chromaClient = new ChromaClient({ path: process.env.CHROMA_PATH });

export async function generatePhenologyJson({ genomeSummary, location, sowingDate, weeks }, logger) {
  // 1. Obtener condiciones ambientales
  const env = await fetchWeatherForLocation(location, sowingDate, weeks);
  logger.debug('Condiciones ambientales:', env);

  // 2. Construir queries para el RAG
  const collection = await chromaClient.getCollection({ name: 'tomato_agronomy' });

  const ragContext = [];
  
  // Query global de genética
  const genQuery = `Variedad ${genomeSummary.inferredCultivar} con QTLs ${genomeSummary.keyVariants.map(v => v.qtl_match).join(', ')}: morfología`;
  const genEmb = await embedQuery(genQuery);
  const genResults = await collection.query({
    queryEmbeddings: [genEmb],
    nResults: 4,
    where: { tipo: { $in: ['genetica', 'morfologia'] } }
  });
  ragContext.push(...genResults.documents[0].map((d, i) => ({
    semana: 'global',
    source: genResults.metadatas[0][i].fuente,
    text: d
  })));

  // Query por cada semana
  for (let w = 0; w < weeks; w++) {
    const query = `Tomate semana ${w} de cultivo: aspecto visual, altura, hojas, color. Temperatura ${env[w].temp_avg}°C`;
    const emb = await embedQuery(query);
    const results = await collection.query({
      queryEmbeddings: [emb],
      nResults: 3
    });
    ragContext.push(...results.documents[0].map((d, i) => ({
      semana: w,
      source: results.metadatas[0][i].fuente,
      text: d
    })));
  }

  logger.info(`  · RAG: ${ragContext.length} chunks recuperados`);

  // 3. Construir prompt para Claude
  const systemPrompt = `Eres un agrónomo experto en tomate. Predice cómo se verá una planta de tomate semana a semana.

Devuelve EXCLUSIVAMENTE un JSON válido, sin nada más:

{
  "cultivar_descripcion": "string",
  "weeks": [
    {
      "week": 0,
      "bbch_stage": "string",
      "title": "string",
      "visual_prompt": "string en INGLÉS, 80-120 palabras describiendo CÓMO SE VE",
      "biological_summary": "string en castellano, 1-2 frases",
      "estimated_height_cm": number,
      "scale_factor": number (0.1 a 1.0)
    }
  ]
}`;

  const ragText = ragContext.map(r => `[${r.source}]\n${r.text}`).join('\n\n---\n\n');

  const userPrompt = `# Genoma
${JSON.stringify(genomeSummary, null, 2)}

# Ubicación y condiciones
- Lugar: ${location.label}
- Siembra: ${sowingDate}
- Semanas: ${weeks}
- Clima: ${JSON.stringify(env, null, 2)}

# Contexto RAG
${ragText}

Genera el JSON para ${weeks} semanas (week 0 a ${weeks - 1}).`;

  // 4. Llamada a Claude
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const rawText = response.content[0].text.trim();
  const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(cleanJson);

  logger.info(`  · Claude devolvió ${parsed.weeks.length} semanas`);
  return parsed;
}
```

---

## Paso 3 — Imágenes con FLUX `src/pipeline/step3_images.js`

**Clave: image-to-image encadenado.** La imagen de la semana N usa la de la semana N-1 como referencia.

```js
import { fal } from '@fal-ai/client';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';

fal.config({ credentials: process.env.FAL_KEY });

const STYLE_SUFFIX = ", botanical scientific illustration style, single tomato plant centered, plain neutral grey-white background";

export async function generateImages(phenologyJson, runDir, logger) {
  const imagePaths = [];
  let previousImageUrl = null;

  for (const week of phenologyJson.weeks) {
    const fullPrompt = week.visual_prompt + STYLE_SUFFIX;
    logger.info(`  · Generando imagen semana ${week.week}...`);

    let result;
    if (previousImageUrl === null) {
      // Semana 0: text-to-image puro
      result = await fal.subscribe('fal-ai/flux/dev', {
        input: {
          prompt: fullPrompt,
          image_size: 'square_hd',
          num_inference_steps: 28,
          guidance_scale: 3.5,
          num_images: 1,
          enable_safety_checker: false
        },
        logs: false
      });
    } else {
      // Semanas siguientes: image-to-image
      result = await fal.subscribe('fal-ai/flux/dev/image-to-image', {
        input: {
          prompt: fullPrompt,
          image_url: previousImageUrl,
          strength: 0.65,
          num_inference_steps: 28,
          guidance_scale: 3.5,
          num_images: 1
        },
        logs: false
      });
    }

    const generatedUrl = result.data.images[0].url;
    previousImageUrl = generatedUrl;

    // Descargar y guardar localmente
    const imgRes = await fetch(generatedUrl);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const localPath = path.join(runDir, `week_${week.week}.png`);
    await writeFile(localPath, buffer);
    imagePaths.push({ week: week.week, path: localPath, url: generatedUrl });

    logger.info(`    ✓ week_${week.week}.png guardada`);
  }

  return imagePaths;
}
```

---

## Paso 4 — Modelos 3D con Tripo `src/pipeline/step4_models3d.js`

```js
import { fal } from '@fal-ai/client';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';

export async function generate3DModels(imagePaths, runDir, logger) {
  logger.info('  · Lanzando 4 tareas Tripo en paralelo...');

  const tasks = imagePaths.map(async ({ week, url }) => {
    try {
      const result = await fal.subscribe('tripo3d/tripo/v3.1/image-to-3d', {
        input: {
          image_url: url,
          texture: 'standard',
          pbr: true,
          face_limit: 50000
        },
        logs: false
      });

      const glbUrl = result.data.model_mesh.url;
      const glbRes = await fetch(glbUrl);
      const buffer = Buffer.from(await glbRes.arrayBuffer());
      const localPath = path.join(runDir, `week_${week}.glb`);
      await writeFile(localPath, buffer);

      logger.info(`    ✓ week_${week}.glb listo`);
      return { week, path: localPath };
    } catch (err) {
      logger.error(`    ✗ week_${week} falló: ${err.message}`);
      throw err;
    }
  });

  return await Promise.all(tasks);
}
```

---

## Paso 5 — Payloads FIWARE NGSI-LD `src/pipeline/step5_fiware.js`

```js
const SMART_DATA_MODELS_CTX = "https://smart-data-models.github.io/dataModel.Agrifood/context.jsonld";

export async function buildFiwarePayloads({ runId, location, sowingDate, phenologyJson, genomeSummary }) {
  const parcelId = `urn:ngsi-ld:AgriParcel:${runId}`;
  const cropId = `urn:ngsi-ld:AgriCrop:${runId}`;

  const entities = [];

  // ENTIDAD 1: AgriParcel
  entities.push({
    "@context": SMART_DATA_MODELS_CTX,
    "id": parcelId,
    "type": "AgriParcel",
    "location": {
      "type": "GeoProperty",
      "value": {
        "type": "Point",
        "coordinates": [location.lon, location.lat]
      }
    },
    "area": { "type": "Property", "value": 100, "unitCode": "MTK" },
    "hasAgriCrop": { "type": "Relationship", "object": cropId },
    "name": { "type": "Property", "value": location.label }
  });

  // ENTIDAD 2: AgriCrop
  entities.push({
    "@context": SMART_DATA_MODELS_CTX,
    "id": cropId,
    "type": "AgriCrop",
    "name": { "type": "Property", "value": phenologyJson.cultivar_descripcion },
    "alternateName": { "type": "Property", "value": "Solanum lycopersicum" },
    "plantingFrom": {
      "type": "Property",
      "value": [{ "@type": "DateTime", "@value": sowingDate }]
    },
    "genomeVariants": {
      "type": "Property",
      "value": genomeSummary.keyVariants.map(v => ({
        qtl: v.qtl_match,
        trait: v.trait,
        effect: v.effect
      }))
    }
  });

  // ENTIDADES 3-6: DigitalTwinSimulation (una por semana)
  for (const week of phenologyJson.weeks) {
    entities.push({
      "@context": SMART_DATA_MODELS_CTX,
      "id": `urn:ngsi-ld:DigitalTwinSimulation:${runId}:w${week.week}`,
      "type": "DigitalTwinSimulation",
      "refAgriCrop": { "type": "Relationship", "object": cropId },
      "weekNumber": { "type": "Property", "value": week.week },
      "bbchStage": { "type": "Property", "value": week.bbch_stage },
      "estimatedHeight": { "type": "Property", "value": week.estimated_height_cm, "unitCode": "CMT" },
      "modelAsset": {
        "type": "Property",
        "value": `/api/runs/${runId}/glb/${week.week}`
      }
    });
  }

  return entities;
}
```

---

## Servicio de logs con SSE `src/services/logger.js`

```js
import { EventEmitter } from 'node:events';

const emitters = new Map();

export function getEmitter(runId) {
  if (!emitters.has(runId)) emitters.set(runId, new EventEmitter());
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
```

---

## Endpoint SSE `src/routes/stream.js`

```js
import express from 'express';
import { getEmitter } from '../services/logger.js';

const router = express.Router();

router.get('/runs/:id/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();

  const emitter = getEmitter(req.params.id);

  const onLog = (payload) => res.write(`event: log\ndata: ${JSON.stringify(payload)}\n\n`);
  const onDone = (payload) => res.write(`event: done\ndata: ${JSON.stringify(payload)}\n\n`);
  const onError = (payload) => res.write(`event: error\ndata: ${JSON.stringify(payload)}\n\n`);

  emitter.on('log', onLog);
  emitter.on('DONE', onDone);
  emitter.on('ERROR', onError);

  req.on('close', () => {
    emitter.off('log', onLog);
    emitter.off('DONE', onDone);
    emitter.off('ERROR', onError);
  });
});

export default router;
```

---

## Servicio de clima `src/services/weather.js`

```js
const MONTHLY_AVERAGES_SPAIN = {
  1: { temp_avg: 7, humidity: 78 },   2: { temp_avg: 9, humidity: 74 },
  3: { temp_avg: 12, humidity: 68 },  4: { temp_avg: 14, humidity: 65 },
  5: { temp_avg: 18, humidity: 60 },  6: { temp_avg: 23, humidity: 55 },
  7: { temp_avg: 27, humidity: 50 },  8: { temp_avg: 27, humidity: 53 },
  9: { temp_avg: 22, humidity: 62 },  10: { temp_avg: 16, humidity: 70 },
  11: { temp_avg: 11, humidity: 75 }, 12: { temp_avg: 8, humidity: 78 }
};

export async function fetchWeatherForLocation(location, sowingDate, weeks) {
  const latAdj = (40 - location.lat) * 0.5;
  const start = new Date(sowingDate);
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const d = new Date(start);
    d.setDate(d.getDate() + w * 7);
    const month = d.getMonth() + 1;
    const base = MONTHLY_AVERAGES_SPAIN[month];
    out.push({
      week: w,
      date: d.toISOString().slice(0, 10),
      temp_avg: Math.round((base.temp_avg + latAdj) * 10) / 10,
      humidity: base.humidity
    });
  }
  return out;
}
```
