# norna — Gemelo Digital de Tomate (Hackathon La Vega Innova)

Aplicación que, a partir de un archivo VCF (variantes genómicas) de tomate, genera una
simulación semana a semana del crecimiento de la planta: detecta QTLs conocidos, infiere
fenología con Claude, genera imágenes (fal.ai FLUX) y modelos 3D (fal.ai Tripo), y publica
los resultados como entidades NGSI-LD (FIWARE Smart Data Models).

## Stack técnico

- Node.js, ESM (`"type": "module"` en `package.json`), entry point `src/server.js`
- `express@^4.19.0` — servidor HTTP
- `@anthropic-ai/sdk@^0.30.0` — cliente Claude
- `@fal-ai/client@^1.2.0` — cliente fal.ai (imágenes y 3D)
- `chromadb@^1.9.0` — vector DB (solo usada por el script de ingesta, no en runtime)
- `dotenv@^16.4.0`, `uuid@^10.0.0`, `cors@^2.8.5`, `node-fetch@^3.3.0`, `multer@^1.4.5-lts.1` (multer no usado actualmente)
- Scripts: `npm start` (`node src/server.js`), `npm run dev` (`node --watch src/server.js`)
- Frontend: HTML/JS vanilla servido como estático, Leaflet (mapas), Three.js (visor 3D)

## Flujo end-to-end

1. Usuario sube un `.vcf` + ubicación + fecha de siembra + nº de semanas → `POST /api/analyze`
2. `runPipeline` (fire-and-forget) ejecuta 5 pasos secuenciales y emite logs por SSE
3. Frontend escucha `/api/runs/:id/stream` y muestra el progreso/resultado en tiempo real

## Backend — `src/`

- `server.js` — Express app: `dotenv/config`, `cors()`, `express.json({limit:'50mb'})`,
  estáticos de `public/`, monta `/api` → `analyzeRouter`, `streamRouter`, `runsRouter`,
  y `GET /health`. Puerto vía `config.port`.
- `config.js` — lee `.env`: `PORT` (default 3000, en `.env` actual = 3001), `ANTHROPIC_API_KEY`,
  `VOYAGE_API_KEY`, `FAL_KEY`, `CHROMA_PATH` (default `./data/chroma`), `RUNS_DIR` (default `./runs`),
  y resuelve `qtlCatalogPath` a `./data/qtl_catalog.json`.
- `pipeline/orchestrator.js` — orquesta los 5 pasos secuenciales, con logging por paso
  (`[1/5]`...`[5/5]`) vía EventEmitter por `runId`. Escribe en `runs/<runId>/`:
  `input.vcf`, `metadata.json` (`{runId, location, sowingDate, weeks, startedAt}`),
  `step1_genome.json`, `step2_phenology.json`, `week_N.png`, `week_N.glb`, `step5_fiware.jsonld`.

### Pipeline — `src/pipeline/`

- **`step1_vcf.js`** — parsea líneas no-comentario del VCF (`chrom, pos, ref, alt`), cruza
  posiciones contra `data/qtl_catalog.json` con tolerancia de **50 kb** (`Math.abs(qtl.pos - pos) < 50000`).
  Agrupa QTLs encontrados por categoría (`produccion`, `calidad_visual`, `resistencia`) en
  `geneticAnalysis`, e infiere el cultivar (`inferCultivar`): beef/Heinz si hay `fw2.2`+peso_fruto,
  cherry si hay licopeno sin peso_fruto, rústico si hay tolerancia_sequia, si no estándar.
- **`step2_rag.js`** — modelo Claude exacto: **`claude-sonnet-4-6`**, `max_tokens: 4000`,
  con `system` = prompt de agrónomo experto que exige salida JSON estricta (incluye
  `visual_prompt` en inglés 60-100 palabras, `scale_factor` 0.1-1.0). El conocimiento
  agronómico NO se consulta vía ChromaDB en runtime: está embebido directamente en el código
  como `TOMATO_KNOWLEDGE` (etapas BBCH 0-3, QTLs principales: fw2.2, lcy-b, Mi-1.2, Tm-2a, etc.)
  — decisión explícita del hackathon para no depender de ChromaDB en producción. El prompt de
  usuario incluye el genoma (step1), clima sintético (`weather.js`) y el knowledge embebido.
  Fallback a `buildDemoPhenology()` (4 semanas hardcoded) si falta `ANTHROPIC_API_KEY`, contiene
  `REPLACE_ME`, está vacía, o falla la llamada. Adjunta también `environmentalAnalysis` y
  `combinedAnalysis.pest_risk` (cruce resistencia genética × riesgo climático).
- **`step3_images.js`** — semana 0: `fal-ai/flux/dev` (text-to-image, `image_size: 'square_hd'`,
  28 steps, `guidance_scale: 3.5`, `enable_safety_checker: false`). Semanas siguientes:
  `fal-ai/flux/dev/image-to-image` encadenando desde la imagen previa (`strength: 0.65`, mismos
  steps/guidance), para mantener coherencia visual planta-a-planta. Sufijo de estilo fijo:
  "botanical scientific illustration style, single tomato plant centered, plain neutral white
  background, soft diffuse lighting, no shadows, three-quarter front view...". Sin `FAL_KEY`
  válida, salta generación y deja `{week, path: null, url: null}` (modo demo).
- **`step4_models3d.js`** — modelo exacto: **`tripo3d/tripo/v3.1/image-to-3d`** (fal.ai),
  parámetros `texture: 'standard'`, `pbr: true`, `face_limit: 50000`. Ejecuta todas las semanas
  en paralelo con `Promise.all()` (sin límite de concurrencia explícito). Sin `FAL_KEY`, salta.
- **`step5_fiware.js`** — construye entidades NGSI-LD usando el contexto
  `https://smart-data-models.github.io/dataModel.Agrifood/context.jsonld`:
  - `AgriParcel` (`urn:ngsi-ld:AgriParcel:{runId}`) con `location` GeoProperty y `hasAgriCrop`
  - `AgriCrop` (`urn:ngsi-ld:AgriCrop:{runId}`) con `genomeVariants`, `agroVocConcept` (FAO Agrovoc c_7715)
  - `DigitalTwinSimulation` × N semanas (`urn:ngsi-ld:DigitalTwinSimulation:{runId}:w{N}`) con
    `bbchStage`, `estimatedHeight`, `modelAsset` → `/api/runs/{runId}/glb/{week}`, `imageAsset` →
    `/api/runs/{runId}/image/{week}`

### Rutas — `src/routes/`

- **`analyze.js`** — `POST /api/analyze`: valida `vcf_content`, `location.lat/lon` (requeridos),
  `weeks` (default 4); lanza `runPipeline()` fire-and-forget; responde `{run_id, stream_url}`.
- **`stream.js`** — `GET /api/runs/:id/stream`: SSE (`text/event-stream`, sin caché, keep-alive,
  `X-Accel-Buffering: no`), eventos `log`/`done`/`error`, heartbeat cada 15s, limpia al `close`.
- **`runs.js`** — `GET /api/runs/:id/status` (metadata.json), `/phenology` (step2 json),
  `/genome` (step1 json), `/fiware` (step5 jsonld), `/glb/:week` (binario `model/gltf-binary`),
  `/image/:week` (`image/png`).

### Servicios — `src/services/`

- **`anthropic.js`** — singleton `new Anthropic({apiKey: config.anthropicApiKey})`.
- **`voyage.js`** — `embedQuery(text)` llama a `https://api.voyageai.com/v1/embeddings`,
  modelo `voyage-3-large`, `input_type: 'query'`. Solo se usa desde el script de ingesta, no en runtime.
- **`weather.js`** — clima 100% sintético, sin llamadas externas: tabla de medias mensuales de
  España + ajuste por latitud (`(40 - lat) * 0.5`). `fetchWeatherForLocation()` da temp/humedad
  por semana; `assessEnvironmentalRisk()` calcula necesidad de riego (ET simplificada) y riesgo
  climático (helada si ≤8°C, golpe de calor si ≥28°C, hongos si humedad ≥75%).
- **`logger.js`** — `Map` global de `EventEmitter` por `runId`; `createLogger(runId)` expone
  `info/debug/error/event`, cada log emite `{ts, level, msg, ...data}` consumido por el SSE de `stream.js`.

### Utils — `src/utils/`

- `runs_storage.js` — `runDir(runId)`, `readRunFile()`, `readRunJson()` resueltos contra `config.runsDir`.

## RAG / ingesta — `ingest/`

- `ingest_rag.py` — script **one-shot** (no se ejecuta en el flujo normal de la app, manual:
  `python ingest/ingest_rag.py`). Usa `chromadb` + `voyageai` + `dotenv`. Crea/recrea colección
  `tomato_agronomy` en ChromaDB persistente (`CHROMA_PATH`, `hnsw:space: cosine`). Trocea cada
  `.md` de `ingest/sources/**` por headers (regex `\n(?=#{1,3} )`); si un chunk supera ~700 tokens
  lo subdivide por párrafos; extrae metadata `fuente`, `tipo` (carpeta padre), `semanas_relevantes`
  (regex "semana N"). Embeddings en batches de 128 vía `voyageai.Client.embed(model='voyage-3-large',
  input_type='document')`.
- `ingest/sources/` — base de conocimiento agronómico en Markdown (7 archivos), organizada por tema:
  `clima_espana/` (ventana de siembra por región), `fenologia/` (ciclo semanal), `fisiologia/`
  (estrés térmico), `genetica/` (variedades, QTLs principales), `morfologia/` (descripción visual
  por semana), `suelo_riego/` (Kc por etapa).
- **Importante**: en producción/demo, `step2_rag.js` NO consulta ChromaDB — usa la copia curada y
  embebida (`TOMATO_KNOWLEDGE`) directamente en el código, para evitar la dependencia de ChromaDB
  en tiempo de ejecución (decisión explícita para el hackathon).

## Datos — `data/`

- `qtl_catalog.json` — catálogo de 9 QTLs conocidos del tomate. Estructura por entrada:
  `{chrom, pos, name, trait, effect, category}` (ej. `{"chrom":"SL5.0ch02","pos":24500000,
  "name":"fw2.2","trait":"peso_fruto","effect":"+30%","category":"produccion"}`).
- `genomes/tomato_sample.vcf` — VCF de ejemplo para pruebas.
- `tomate_cepa_lavega_2026.vcf` — VCF de demo adicional (untracked en git).

## Datos geoespaciales — `geo/` (sin uso actual en el pipeline)

Capas crudas no ingestionadas todavía, pensadas para enriquecer el análisis ambiental a futuro:
`hidrologia/`, `humedad_suelo/{mes}/`, `litologia/`, `suelo_propiedades/`, `temperatura/`,
`uso_suelo_corine/`. Hoy `weather.js` usa clima sintético, no estas capas.

## Resultados de ejecuciones — `runs/r_*/`

Cada subcarpeta es una ejecución del pipeline (`runId`), con: `input.vcf`, `metadata.json`,
`step1_genome.json`, `step2_phenology.json`, `step5_fiware.jsonld`, y opcionalmente
`week_N.png` / `week_N.glb` si las APIs de fal.ai estaban activas.

## Frontend — `public/`

- `index.html` + `style.css` — UI estática servida por Express. CSS con variables de diseño
  (`--void`, `--forest`, `--lime`, `--cream`, `--sage`, `--earth`), fuente monoespaciada.
  Importa Leaflet 1.9.4 y Three.js desde CDN.
- `app.js` — estado global (`vcfContent`, `location`, `weeks`, `runId`, `phenology`, `playing`...).
  Maneja: botón demo (carga run `r_demo_backup` sin llamadas API), input de VCF, botón analizar
  (`POST /api/analyze` + apertura de SSE), tabs/slider de semana, autoplay, toggle de mapa de terreno.
- `viewer.js` — visor 3D real (Three.js + GLTFLoader + OrbitControls): carga los `.glb` de cada
  semana en paralelo desde `/api/runs/:id/glb/:week`, normaliza escala/centro, y hace crossfade de
  opacidad entre el modelo de la semana anterior y la siguiente (`setWeek(weekFloat, phenology)`).
- `wheat3d.js` — **prototipo previo de un visualizador de trigo** (7 etapas: germinación →
  maduración), no se usa en el flujo actual de tomate; queda como código heredado en el repo.
- `map.js` — selector de ubicación con Leaflet (`initMap(onSelect)`), centrado en España
  (40.4168, -3.7038), click coloca marcador y devuelve lat/lon.
- `assets/logo.png` — logo de La Vega Innova.

## Documentación — `docs/`

Toda la documentación del proyecto vive en `docs/`:
- `plan_01_arquitectura_requerimientos.md`
- `plan_02_rag_ingesta.md`
- `plan_03_backend_orquestacion.md`
- `plan_04_frontend_demo.md`

Son documentos de diseño previos a la implementación, no se mantienen sincronizados
automáticamente con el código. **Antes de modificar la parte del proyecto correspondiente
(arquitectura, RAG/ingesta, backend/orquestación o frontend/demo), lee primero el
documento relevante en `docs/` si no se ha leído ya en la conversación actual**, para
mantener coherencia con las decisiones de diseño documentadas.

## Servicios externos — resumen de modelos/endpoints exactos

| Servicio | Modelo/Endpoint exacto | Paso | Fallback sin credencial |
|---|---|---|---|
| Anthropic | `claude-sonnet-4-6` | step2 (fenología) | `buildDemoPhenology()` hardcoded |
| fal.ai FLUX | `fal-ai/flux/dev` (semana 0, text-to-image) | step3 | `url: null` |
| fal.ai FLUX | `fal-ai/flux/dev/image-to-image` (semanas 1+) | step3 | `url: null` |
| fal.ai Tripo | `tripo3d/tripo/v3.1/image-to-3d` | step4 | `path: null` |
| Voyage AI | `voyage-3-large` vía `https://api.voyageai.com/v1/embeddings` | solo `ingest_rag.py` | n/a (no se usa en runtime) |
| ChromaDB | `PersistentClient` en `./data/chroma`, colección `tomato_agronomy` | solo `ingest_rag.py` | n/a (step2 usa knowledge embebido) |

## Otros

- `click_demo.mjs` — script Puppeteer de verificación E2E: conecta a Chrome en modo remoto
  (`localhost:9222`), click en `#demo-btn`, espera 4s, captura `screenshot_demo.png`, y extrae
  textos de `#week-title`, `#week-bbch`, `#genome-badge` para validar la demo visualmente.
- `.env` — credenciales reales (`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `FAL_KEY`, `PORT=3001`,
  `CHROMA_PATH`, `RUNS_DIR`, `LOG_LEVEL`). Sin estas keys (o con valor `REPLACE_ME`), el pipeline
  cae automáticamente en modo demo. No existe `.env.example` en el repo.
- `README.md` — actualmente con encoding corrupto/vacío, pendiente de rehacer.
