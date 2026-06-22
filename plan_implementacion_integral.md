# Plan de Implementación Integral — Gemelo Digital de Tomate
## Hackathon La Vega Innova · 22-23 junio 2026

> **Decisiones tomadas y bloqueadas:**
> - **Genoma:** 1 archivo VCF real descargado de Sol Genomics Network (SGN)
> - **LLM:** Claude Sonnet 4.6 vía Anthropic API (texto + razonamiento agronómico)
> - **Imágenes:** fal.ai (FLUX.1 [dev] image-to-image) — 4 imágenes, una por semana
> - **3D:** fal.ai (Tripo v3.1 image-to-3d) — 4 modelos GLB
> - **FIWARE:** payloads NGSI-LD compatibles únicamente (sin Orion-LD)
> - **Prototipo:** 4 semanas (semana 0, 1, 2, 3)
> - **Entorno:** 100% localhost · Node.js · Python solo para ingesta RAG one-shot

---

## 1. Decisiones de arquitectura y stack

### Stack final

| Capa | Tecnología | Justificación |
|------|------------|---------------|
| Backend | Node.js 20 + Express | Coherencia con SDK fal.ai, no necesitamos Python en runtime |
| Ingesta RAG (one-shot, offline) | Python 3.11 | Mejores librerías de parseo PDF/markdown y embeddings |
| LLM razonamiento | Claude Sonnet 4.6 (`claude-sonnet-4-6`) vía `@anthropic-ai/sdk` | Razonamiento agronómico complejo, ventana 200k |
| Embeddings RAG | Voyage AI `voyage-3-large` vía `voyageai` (Python en ingesta, REST en runtime) | Embeddings oficialmente recomendados por Anthropic |
| Vector store | ChromaDB (modo persistente local en `/data/chroma`) | Zero infra, un directorio |
| Generación imagen | fal.ai modelo `fal-ai/flux/dev/image-to-image` | Control sobre coherencia visual con `image_url` de referencia |
| Generación 3D | fal.ai modelo `tripo3d/tripo/v3.1/image-to-3d` | PBR + GLB, integración directa Three.js |
| Parser VCF | `vcf` (npm) o lectura directa de líneas (VCFs simples) | Mínima dependencia |
| Mapa interactivo | Leaflet + OpenStreetMap | Zero API key, suficiente para demo. (Si hay Google Maps API key disponible, sustituir luego) |
| Visor 3D | Three.js r168 + GLTFLoader + OrbitControls | Estándar |
| Streaming logs | Server-Sent Events (SSE) | Más simple que WebSockets, perfecto para logs unidireccionales |
| Comunicación frontend | `fetch` + `EventSource` | Vanilla, sin framework |

### Arquitectura del sistema

```
┌──────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (vanilla JS)                       │
│  ┌────────────────────┐  ┌─────────────────────────────────────────┐ │
│  │  PANEL IZQUIERDO   │  │           PANEL CENTRAL                 │ │
│  │  - Upload VCF      │  │  ┌───────────────────────────────────┐  │ │
│  │  - Mapa Leaflet    │  │  │      Visor Three.js (canvas)      │  │ │
│  │  - Botón Analizar  │  │  │   - 4 GLBs cargados               │  │ │
│  │  ─────────────     │  │  │   - Crossfade opacity + scale     │  │ │
│  │  - Logs SSE        │  │  └───────────────────────────────────┘  │ │
│  └────────────────────┘  │  ┌───────────────────────────────────┐  │ │
│                          │  │   Slider temporal (0-3 semanas)   │  │ │
│                          │  └───────────────────────────────────┘  │ │
│                          └─────────────────────────────────────────┘ │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ HTTP REST + SSE (localhost:3000)
┌──────────────────────────────▼───────────────────────────────────────┐
│                       BACKEND Node.js (Express)                      │
│                                                                      │
│  POST /api/analyze    → arranca pipeline, devuelve run_id            │
│  GET  /api/runs/:id/stream    → SSE con logs en tiempo real          │
│  GET  /api/runs/:id/status    → estado actual del pipeline           │
│  GET  /api/runs/:id/glb/:week → sirve GLB de la semana solicitada   │
│  GET  /api/runs/:id/image/:week → sirve PNG de la semana            │
│  GET  /api/runs/:id/fiware    → entidades NGSI-LD generadas         │
│                                                                      │
│  ┌─────────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ VCF Parser  │→│ RAG Query │→│ Claude   │→│  fal.ai pipeline  │  │
│  │             │  │ (Chroma) │  │ (Sonnet) │  │  (FLUX → Tripo)   │  │
│  └─────────────┘  └──────────┘  └──────────┘  └──────────────────┘  │
│                                                                      │
│  Trazabilidad: /runs/{run_id}/ con JSON, PNG, GLB, NGSI-LD          │
└──────────────────────────────────────────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
┌───────▼──────┐    ┌──────────▼──────┐   ┌───────────▼────────┐
│  ChromaDB    │    │  Anthropic API  │   │     fal.ai API     │
│  local       │    │  (Claude 4.6)   │   │  (FLUX + Tripo)    │
└──────────────┘    └─────────────────┘   └────────────────────┘
```

---

## 2. Pre-requisitos: descarga del VCF y setup inicial

### 2.1 Descarga del archivo VCF de tomate

**Decisión:** trabajamos con un VCF real del proyecto Varitome del Sol Genomics Network. Concretamente, una variedad cherry contrastante con la referencia Heinz 1706.

Ejecutar **antes** de empezar el hackathon (no quemes minutos del cronómetro descargando):

```bash
mkdir -p data/genomes
cd data/genomes

# Opción A — Variantes Heinz 1706 vs SL5.0 (recomendada, archivo manejable)
wget "https://solgenomics.net/ftp/tomato_genome/variants/SL5/sl5.0_variants_filtered.vcf.gz"

# Opción B (fallback si A está caída) — variantes de un cultivar contrastante
wget "https://solgenomics.net/ftp/tomato_genome/variants/360_genomes/tomato360_variants.vcf.gz"

# Opción C (fallback de fallback) — desde Ensembl Plants
wget "https://ftp.ensemblgenomes.ebi.ac.uk/pub/plants/release-59/variation/vcf/solanum_lycopersicum/solanum_lycopersicum.vcf.gz"

gunzip *.vcf.gz
ls -lh
# Deberías ver un archivo .vcf de entre 50 MB y 2 GB
```

**Si el archivo es > 200 MB**, recórtalo a cromosoma 2 (donde está `fw2.2`, el QTL más famoso del peso del fruto):

```bash
# Mantén solo las primeras 100 líneas de cabecera + variantes del cromosoma SL5.0ch02
head -n 100 sl5.0_variants_filtered.vcf | grep "^#" > tomato_sample.vcf
grep -E "^SL5.0ch02\b|^chr02\b|^2\b" sl5.0_variants_filtered.vcf | head -n 5000 >> tomato_sample.vcf

wc -l tomato_sample.vcf  # debería ser ~5100 líneas
```

**Este `tomato_sample.vcf` es lo que el usuario subirá en la UI durante la demo.** Debe estar predescargado en el escritorio del portátil del demo.

### 2.2 Estructura del repositorio

```
gemelo-tomate/
├── .env
├── package.json
├── docker-compose.yml          (opcional, solo para ChromaDB si se prefiere contenerizado)
├── data/
│   ├── genomes/
│   │   └── tomato_sample.vcf   ← archivo descargado en 2.1
│   ├── chroma/                 ← persistencia de embeddings (creado por la ingesta)
│   └── fiware_contexts/
│       └── agrifood.jsonld     ← @context NGSI-LD descargado de Smart Data Models
├── ingest/                     ← scripts Python one-shot, no se ejecutan en runtime
│   ├── requirements.txt
│   ├── ingest_rag.py
│   └── sources/                ← markdowns de la base de conocimiento (ver §3)
├── src/
│   ├── server.js
│   ├── config.js
│   ├── routes/
│   │   ├── analyze.js
│   │   ├── stream.js
│   │   └── runs.js
│   ├── pipeline/
│   │   ├── orchestrator.js     ← coordina los 4 pasos
│   │   ├── step1_vcf.js        ← parseo VCF + extracción variantes clave
│   │   ├── step2_rag.js        ← consulta a ChromaDB + Claude
│   │   ├── step3_images.js     ← fal.ai FLUX 4 imágenes
│   │   ├── step4_models3d.js   ← fal.ai Tripo 4 GLBs
│   │   └── step5_fiware.js     ← genera payloads NGSI-LD
│   ├── services/
│   │   ├── anthropic.js
│   │   ├── chroma.js
│   │   ├── voyage.js           ← embeddings runtime
│   │   ├── fal.js
│   │   └── logger.js           ← logger con SSE broadcast
│   └── utils/
│       ├── vcf_parser.js
│       └── runs_storage.js
├── public/
│   ├── index.html
│   ├── app.js
│   ├── viewer.js               ← Three.js viewer
│   ├── map.js                  ← Leaflet
│   └── style.css
└── runs/                       ← se crea en runtime, una carpeta por análisis
```

### 2.3 Variables de entorno (`.env`)

```
ANTHROPIC_API_KEY=sk-ant-...
VOYAGE_API_KEY=pa-...
FAL_KEY=...:...
CHROMA_PATH=./data/chroma
RUNS_DIR=./runs
PORT=3000
LOG_LEVEL=info
```

### 2.4 Dependencias `package.json` clave

```json
{
  "type": "module",
  "dependencies": {
    "express": "^4.19.0",
    "@anthropic-ai/sdk": "^0.30.0",
    "@fal-ai/client": "^1.2.0",
    "chromadb": "^1.9.0",
    "voyageai": "^0.0.4",
    "dotenv": "^16.4.0",
    "uuid": "^10.0.0",
    "cors": "^2.8.5",
    "node-fetch": "^3.3.0"
  }
}
```

---

## 3. RAG: ingesta one-shot de conocimiento

**Esto se ejecuta UNA VEZ antes del hackathon (o las primeras 3h del día 1). No es realtime.**

### 3.1 Fuentes que se descargan y convierten a markdown

Crear `ingest/sources/` con la siguiente estructura. Cada subcarpeta contiene markdowns descargados o convertidos. Objetivo: **150-250 archivos `.md`** en total.

```
ingest/sources/
├── fenologia/
│   ├── bbch_tomate_completa.md           ← escala BBCH oficial traducida (Wikipedia + papers)
│   ├── ciclo_tomate_semanal.md           ← compilado FAO Crop Calendar
│   ├── gdd_tomate_variedades.md          ← Growing Degree Days por variedad
│   └── fenologia_floracion_cuajado.md
├── fisiologia/
│   ├── fotosintesis_temperatura.md       ← curvas T vs fotosíntesis
│   ├── respuesta_estres_hidrico.md
│   ├── respuesta_estres_termico.md
│   └── fotoperiodo_tomate.md
├── genetica/
│   ├── qtls_principales_tomate.md        ← fw2.2, fw3.2, lcy-b, etc.
│   ├── genes_tolerancia_sequia.md        ← SlDREB, SlNCED, SlAREB
│   ├── genes_resistencia_patogenos.md    ← Mi-1, Tm-2², Sw-5
│   ├── variedades_caracteristicas.md     ← Heinz, San Marzano, Cherry, Roma...
│   └── snp_effects_catalogo.md
├── suelo_riego/
│   ├── kc_tomate_por_etapa.md            ← coeficientes de cultivo FAO-56
│   ├── eto_penman_monteith.md
│   ├── necesidades_nutrientes_npk.md
│   └── ph_tolerancia_tomate.md
├── morfologia/
│   ├── arquitectura_tomate_indeterminado.md
│   ├── arquitectura_tomate_determinado.md
│   ├── desarrollo_radicular.md
│   └── descripcion_visual_por_semana.md  ← CRÍTICO: lo que el LLM usa para describir
└── clima_espana/
    ├── climas_iberia_tomate.md
    ├── ventana_siembra_por_region.md
    └── riesgos_meteorologicos.md
```

### 3.2 Cómo obtener el contenido (real, sin alucinaciones)

**Comando de descarga masiva:**

```bash
mkdir -p ingest/sources/{fenologia,fisiologia,genetica,suelo_riego,morfologia,clima_espana}

# 1. FAO — Tomato crop information (PDF → MD con marker)
pip install marker-pdf
wget -O /tmp/fao_tomato.pdf "https://www.fao.org/3/y4011e/y4011e0d.htm"
marker_single /tmp/fao_tomato.pdf ingest/sources/fenologia/

# 2. UC Davis Tomato Production Manual (PDF gratuito)
wget -O /tmp/uc_tomato.pdf "https://anrcatalog.ucanr.edu/pdf/3470.pdf"
marker_single /tmp/uc_tomato.pdf ingest/sources/fisiologia/

# 3. Ensembl Plants — info de QTLs tomate (REST API → markdown manual)
curl "https://rest.ensembl.org/overlap/region/solanum_lycopersicum/2:1-1000000?feature=gene;content-type=application/json" \
  | jq '.' > ingest/sources/genetica/genes_cromosoma_2.json
# Convertir manualmente a markdown estructurado en una iteración

# 4. PubMed Central — papers open access sobre fenología de tomate
# Usar el script auxiliar pmc_downloader.py incluido en /ingest
python ingest/pmc_downloader.py \
  --query "Solanum lycopersicum phenology growth model" \
  --max-papers 30 \
  --out ingest/sources/fenologia/papers/

# 5. DSSAT parámetros CROPGRO-Tomato (clave para datos numéricos)
git clone https://github.com/DSSAT/dssat-csm-data /tmp/dssat
cp /tmp/dssat/Tomato/*.SPE /tmp/dssat/Tomato/*.ECO /tmp/dssat/Tomato/*.CUL ingest/sources/genetica/dssat/
# Convertir cada archivo .SPE/.ECO/.CUL a markdown con un script de 30 líneas
```

**Archivo crítico a redactar manualmente:** `morfologia/descripcion_visual_por_semana.md`

Este archivo es lo que más impacto tiene en la calidad de la imagen generada. Estructura recomendada:

```markdown
# Descripción visual del tomate por semana de cultivo

## Semana 0 — Siembra/germinación (BBCH 00-09)
- **Aspecto visible:** semilla de 3 mm color marrón claro, ligeramente aplanada,
  con pelos finos. Sin estructura aérea visible. Puede mostrar radícula blanca
  de hasta 1 cm emergiendo si ya hubo imbibición.
- **Color dominante:** marrón tierra húmeda, beige.
- **Posición:** enterrada 1-2 cm en sustrato oscuro.
- **Altura aérea:** 0 cm.

## Semana 1 — Plántula con cotiledones (BBCH 10-11)
- **Aspecto visible:** tallo (hipocótilo) verde claro/amarillento de 3-5 cm,
  delgado (1-2 mm de diámetro). Dos cotiledones ovales de unos 1-2 cm,
  verde pálido, opuestos. No hay hojas verdaderas todavía o apenas asoma
  la primera.
- **Color dominante:** verde muy pálido, casi amarillento; tallo translúcido.
- **Altura aérea:** 4-6 cm.

## Semana 2 — Hojas verdaderas (BBCH 12-14)
- **Aspecto visible:** tallo principal de 8-12 cm, ya verde claro firme.
  2-4 hojas verdaderas pinnadas con folíolos serrados. Cotiledones aún
  presentes pero menos prominentes. Pelos glandulares visibles al tacto
  (no necesariamente al ojo).
- **Color dominante:** verde medio, brillante.
- **Altura aérea:** 10-15 cm.

## Semana 3 — Crecimiento vegetativo activo (BBCH 15-19)
- **Aspecto visible:** tallo principal de 18-25 cm, con 5-7 hojas verdaderas
  bien desarrolladas, pinnadas, color verde intenso. Ya puede mostrarse el
  primer brote axilar. Aún sin botones florales en variedades tempranas.
- **Color dominante:** verde intenso.
- **Altura aérea:** 20-30 cm.
```

**Este archivo es indispensable.** Sin él, el LLM se inventará alturas y morfologías. Con él, las descripciones son consistentes y científicamente plausibles.

### 3.3 Script de ingesta `ingest/ingest_rag.py`

```python
"""
Ingesta one-shot del RAG. Ejecutar UNA VEZ:
    python ingest/ingest_rag.py
Genera persistencia en ./data/chroma
"""
import os
import re
from pathlib import Path
import chromadb
from chromadb.config import Settings
import voyageai
from dotenv import load_dotenv

load_dotenv()

SOURCES_DIR = Path("ingest/sources")
CHROMA_PATH = Path(os.getenv("CHROMA_PATH", "./data/chroma"))
COLLECTION_NAME = "tomato_agronomy"

CHUNK_TARGET_TOKENS = 700
CHUNK_OVERLAP_TOKENS = 80


def split_markdown_by_headers(md_text: str, source_path: str, tipo: str):
    """
    Trocea por headers H2/H3 manteniendo header + cuerpo juntos.
    Si un trozo excede CHUNK_TARGET_TOKENS, se vuelve a partir por párrafos.
    Devuelve lista de dicts {text, metadata}.
    """
    chunks = []
    sections = re.split(r"\n(?=#{1,3} )", md_text)
    for sec in sections:
        if not sec.strip():
            continue
        approx_tokens = len(sec) / 4
        if approx_tokens <= CHUNK_TARGET_TOKENS:
            chunks.append(sec)
        else:
            paragraphs = sec.split("\n\n")
            current = ""
            for p in paragraphs:
                if (len(current) + len(p)) / 4 <= CHUNK_TARGET_TOKENS:
                    current += "\n\n" + p
                else:
                    if current:
                        chunks.append(current.strip())
                    current = p
            if current:
                chunks.append(current.strip())

    # Detección de semanas relevantes en el contenido para metadata filtrable
    out = []
    for c in chunks:
        semanas = sorted(set(int(m) for m in re.findall(r"[Ss]emana\s+(\d+)", c)))
        out.append({
            "text": c,
            "metadata": {
                "fuente": source_path,
                "tipo": tipo,
                "semanas_relevantes": ",".join(str(s) for s in semanas) if semanas else "all"
            }
        })
    return out


def main():
    client = chromadb.PersistentClient(path=str(CHROMA_PATH), settings=Settings(anonymized_telemetry=False))
    try:
        client.delete_collection(COLLECTION_NAME)
    except Exception:
        pass
    collection = client.create_collection(name=COLLECTION_NAME, metadata={"hnsw:space": "cosine"})

    vo = voyageai.Client(api_key=os.getenv("VOYAGE_API_KEY"))

    all_chunks = []
    for md_path in SOURCES_DIR.rglob("*.md"):
        tipo = md_path.parent.name
        text = md_path.read_text(encoding="utf-8", errors="ignore")
        chunks = split_markdown_by_headers(text, str(md_path.relative_to(SOURCES_DIR)), tipo)
        all_chunks.extend(chunks)
        print(f"  · {md_path.name}: {len(chunks)} chunks")

    print(f"\nTotal chunks a embedding: {len(all_chunks)}")

    BATCH = 128
    for i in range(0, len(all_chunks), BATCH):
        batch = all_chunks[i:i + BATCH]
        texts = [c["text"] for c in batch]
        result = vo.embed(texts, model="voyage-3-large", input_type="document")
        embeddings = result.embeddings

        collection.add(
            ids=[f"chunk_{i + j}" for j in range(len(batch))],
            embeddings=embeddings,
            documents=texts,
            metadatas=[c["metadata"] for c in batch]
        )
        print(f"  · Batch {i // BATCH + 1}/{(len(all_chunks) - 1) // BATCH + 1} subido")

    print(f"\n✓ Colección '{COLLECTION_NAME}' lista con {collection.count()} chunks.")


if __name__ == "__main__":
    main()
```

### 3.4 Verificación post-ingesta

```bash
python -c "
import chromadb
c = chromadb.PersistentClient(path='./data/chroma')
col = c.get_collection('tomato_agronomy')
print(f'Total chunks: {col.count()}')
print('Sample:', col.peek(2))
"
```

Esperar ver entre 800 y 2.000 chunks. Si hay menos de 400, tu base de conocimiento es insuficiente y vas a tener un RAG flojo.

---

## 4. Backend: pipeline detallado paso a paso

### 4.1 Endpoint principal `POST /api/analyze`

**Request:**
```json
{
  "vcf_filename": "tomato_sample.vcf",
  "vcf_content_base64": "...",
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

### 4.2 Orquestador `src/pipeline/orchestrator.js`

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

### 4.3 Paso 1 — Parseo VCF `src/pipeline/step1_vcf.js`

**Objetivo:** del VCF crudo extraer un resumen útil para alimentar a Claude. No queremos pasar 5000 variantes al LLM — queremos las que importan.

**Estrategia:** mantener un **catálogo curado de variantes/QTLs de interés** en `data/qtl_catalog.json` y hacer match contra ese catálogo.

```js
// src/pipeline/step1_vcf.js
import fs from 'node:fs';

const QTL_CATALOG = JSON.parse(fs.readFileSync('./data/qtl_catalog.json', 'utf-8'));
// Ejemplo de qtl_catalog.json:
// [
//   { "chrom": "SL5.0ch02", "pos": 24500000, "name": "fw2.2", "trait": "peso_fruto", "effect": "+30%" },
//   { "chrom": "SL5.0ch03", "pos": 65500000, "name": "fw3.2", "trait": "peso_fruto", "effect": "+15%" },
//   { "chrom": "SL5.0ch06", "pos": 36800000, "name": "lcy-b", "trait": "licopeno", "effect": "++" },
//   { "chrom": "SL5.0ch06", "pos": 3700000, "name": "Mi-1.2", "trait": "resistencia_nematodos", "effect": "fuerte" },
//   { "chrom": "SL5.0ch09", "pos": 4200000, "name": "Tm-2a", "trait": "resistencia_ToMV", "effect": "fuerte" },
//   { "chrom": "SL5.0ch09", "pos": 67500000, "name": "SlDREB2A", "trait": "tolerancia_sequia", "effect": "++" }
// ]

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

  // Inferencia de variedad probable (muy simplificada para hackathon)
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

**Output del paso 1 (ejemplo):**
```json
{
  "totalVariants": 4823,
  "keyVariants": [
    { "chrom": "SL5.0ch02", "position": 24512345, "qtl_match": "fw2.2", "trait": "peso_fruto", "effect": "+30%" },
    { "chrom": "SL5.0ch06", "position": 36799012, "qtl_match": "lcy-b", "trait": "licopeno", "effect": "++" }
  ],
  "inferredCultivar": "Tipo beef/Heinz (fruto grande)",
  "species": "Solanum lycopersicum"
}
```

### 4.4 Paso 2 — RAG + Claude `src/pipeline/step2_rag.js`

**Objetivo:** generar un JSON con la descripción detallada de las 4 semanas, sirviendo de input para el generador de imágenes.

**Estrategia:** una sola llamada a Claude con un prompt que recibe (a) los chunks del RAG más relevantes y (b) el contexto genoma+ambiente. Claude devuelve JSON estructurado.

```js
// src/pipeline/step2_rag.js
import Anthropic from '@anthropic-ai/sdk';
import { ChromaClient } from 'chromadb';
import { embedQuery } from '../services/voyage.js';
import { fetchWeatherForLocation } from '../services/weather.js';

const anthropic = new Anthropic();
const chromaClient = new ChromaClient({ path: process.env.CHROMA_PATH });

export async function generatePhenologyJson({ genomeSummary, location, sowingDate, weeks }, logger) {
  // 1. Obtener condiciones ambientales aproximadas
  //    Para la demo: usar valores medios mensuales precalculados por ubicación,
  //    o llamar a AEMET si hay tiempo. Si no, hardcodear según mes.
  const env = await fetchWeatherForLocation(location, sowingDate, weeks);
  logger.debug('Condiciones ambientales:', env);

  // 2. Construir queries para el RAG (una por semana + una global de genética)
  const collection = await chromaClient.getCollection({ name: 'tomato_agronomy' });

  const ragContext = [];
  // Query global de genética
  const genQuery = `Variedad ${genomeSummary.inferredCultivar} con QTLs ${genomeSummary.keyVariants.map(v => v.qtl_match).join(', ')}: morfología y características fenotípicas`;
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

  // Query por cada semana (con filtro de metadata si está disponible)
  for (let w = 0; w < weeks; w++) {
    const query = `Tomate semana ${w} de cultivo: aspecto visual, altura, hojas, color. Temperatura ${env[w].temp_avg}°C humedad ${env[w].humidity}%`;
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
  const systemPrompt = `Eres un agrónomo experto en tomate (Solanum lycopersicum). Tu trabajo es predecir cómo se verá una planta de tomate semana a semana basándote en:
- El genoma de la variedad
- Las condiciones ambientales reales del lugar de siembra
- Conocimiento agronómico contrastado (que recibirás como contexto)

Debes devolver EXCLUSIVAMENTE un JSON válido, sin texto adicional, sin markdown fences, con esta estructura exacta:

{
  "cultivar_descripcion": "string corta describiendo la variedad",
  "weeks": [
    {
      "week": 0,
      "bbch_stage": "string",
      "title": "string",
      "visual_prompt": "string en INGLÉS de 80-120 palabras describiendo CÓMO SE VE la planta esta semana, optimizado para un generador de imágenes. Incluye: altura, color, número de hojas, morfología, contexto (maceta/suelo), iluminación. SIN nombres científicos, SIN jerga botánica. Lenguaje visual y concreto.",
      "biological_summary": "string en castellano de 1-2 frases explicando qué está pasando biológicamente",
      "estimated_height_cm": number,
      "scale_factor": number (entre 0.1 y 1.0, relativo a la planta adulta)
    }
  ]
}

El "visual_prompt" debe mantener consistencia visual entre semanas: mismo encuadre, mismo estilo, misma posición. Solo varía la planta.`;

  const ragText = ragContext.map(r => `[Fuente: ${r.source} | Semana: ${r.semana}]\n${r.text}`).join('\n\n---\n\n');

  const userPrompt = `# Genoma analizado
${JSON.stringify(genomeSummary, null, 2)}

# Ubicación y condiciones
- Lugar: ${location.label} (lat ${location.lat}, lon ${location.lon})
- Fecha de siembra: ${sowingDate}
- Semanas a simular: ${weeks}
- Condiciones por semana: ${JSON.stringify(env, null, 2)}

# Contexto agronómico (RAG)
${ragText}

# Tarea
Genera el JSON de fenología para las ${weeks} semanas (week 0 a week ${weeks - 1}).
Recuerda: SOLO JSON, sin nada más.`;

  // 4. Llamada a Claude
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const rawText = response.content[0].text.trim();
  // Limpieza por si Claude se cuela con fences
  const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(cleanJson);

  logger.info(`  · Claude devolvió ${parsed.weeks.length} semanas`);
  return parsed;
}
```

### 4.5 Paso 3 — Imágenes con fal.ai FLUX `src/pipeline/step3_images.js`

**Estrategia clave: image-to-image encadenado.** La imagen de la semana N usa como referencia la imagen de la semana N-1 con strength medio-bajo (0.55), para mantener coherencia visual.

```js
// src/pipeline/step3_images.js
import { fal } from '@fal-ai/client';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';

fal.config({ credentials: process.env.FAL_KEY });

const STYLE_SUFFIX = ", botanical scientific illustration style, single tomato plant centered, plain neutral grey-white background, soft diffuse lighting, no shadows, three-quarter front view, clean professional";

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
      // Semanas siguientes: image-to-image con la anterior como referencia
      result = await fal.subscribe('fal-ai/flux/dev/image-to-image', {
        input: {
          prompt: fullPrompt,
          image_url: previousImageUrl,
          strength: 0.65,  // 0.65 = mantén la composición y estilo, cambia la planta
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

**Detalle importante:** Tripo necesita una URL pública para procesar la imagen. fal.ai devuelve URLs en su CDN que duran el tiempo suficiente para encadenar al paso 4 (~horas). Guardamos la URL en memoria y la pasamos directa a Tripo, sin re-uploadear.

### 4.6 Paso 4 — Modelos 3D con Tripo `src/pipeline/step4_models3d.js`

```js
// src/pipeline/step4_models3d.js
import { fal } from '@fal-ai/client';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';

export async function generate3DModels(imagePaths, runDir, logger) {
  // Lanzamos las 4 tareas EN PARALELO. Tripo tarda ~30-60s cada una;
  // en serie serían 2-4 min, en paralelo 30-60s totales.
  logger.info('  · Lanzando 4 tareas Tripo en paralelo...');

  const tasks = imagePaths.map(async ({ week, url }) => {
    try {
      const result = await fal.subscribe('tripo3d/tripo/v3.1/image-to-3d', {
        input: {
          image_url: url,
          texture: 'standard',
          pbr: true,
          face_limit: 50000,
          orientation: 'default'
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

### 4.7 Paso 5 — Payloads FIWARE NGSI-LD `src/pipeline/step5_fiware.js`

**Objetivo demostrativo:** generar JSON-LD válido siguiendo los Smart Data Models de FIWARE, sin levantar Orion. Esto es lo que enseñas al jurado: *"nuestros datos son NGSI-LD nativos, listos para enchufar a la plataforma FIWARE de La Vega Innova"*.

```js
// src/pipeline/step5_fiware.js
const SMART_DATA_MODELS_CTX = "https://smart-data-models.github.io/dataModel.Agrifood/context.jsonld";

export async function buildFiwarePayloads({ runId, location, sowingDate, phenologyJson, genomeSummary }) {
  const parcelId = `urn:ngsi-ld:AgriParcel:${runId}`;
  const cropId = `urn:ngsi-ld:AgriCrop:${runId}`;

  const entities = [];

  // ENTIDAD 1: AgriParcel — la parcela donde se planta
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

  // ENTIDAD 2: AgriCrop — el cultivo con info genética
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
    "wateringFrequency": { "type": "Property", "value": "weekly" },
    "agroVocConcept": { "type": "Property", "value": "http://aims.fao.org/aos/agrovoc/c_7715" },
    "genomeVariants": {
      "type": "Property",
      "value": genomeSummary.keyVariants.map(v => ({
        qtl: v.qtl_match,
        trait: v.trait,
        effect: v.effect
      }))
    }
  });

  // ENTIDADES 3-6: DigitalTwinSimulation (uno por semana) — entidad custom
  // No existe oficialmente en Smart Data Models todavía; la creamos como extensión
  for (const week of phenologyJson.weeks) {
    entities.push({
      "@context": [
        SMART_DATA_MODELS_CTX,
        { "DigitalTwinSimulation": "https://lavegainnova.es/schemas/DigitalTwinSimulation" }
      ],
      "id": `urn:ngsi-ld:DigitalTwinSimulation:${runId}:w${week.week}`,
      "type": "DigitalTwinSimulation",
      "refAgriCrop": { "type": "Relationship", "object": cropId },
      "weekNumber": { "type": "Property", "value": week.week },
      "bbchStage": { "type": "Property", "value": week.bbch_stage },
      "estimatedHeight": { "type": "Property", "value": week.estimated_height_cm, "unitCode": "CMT" },
      "biologicalSummary": { "type": "Property", "value": week.biological_summary },
      "modelAsset": {
        "type": "Property",
        "value": `/api/runs/${runId}/glb/${week.week}`
      },
      "imageAsset": {
        "type": "Property",
        "value": `/api/runs/${runId}/image/${week.week}`
      }
    });
  }

  return entities;
}
```

Servido por el endpoint `GET /api/runs/:id/fiware`, el jurado puede abrirlo en el navegador y ver el JSON-LD perfecto. **Pitch line:** *"Estos payloads se publican tal cual en un broker Orion-LD. Listo para producción en La Vega Innova."*

### 4.8 Servicio de logs con SSE `src/services/logger.js`

```js
// src/services/logger.js
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

### 4.9 Endpoint SSE `src/routes/stream.js`

```js
// src/routes/stream.js
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

## 5. Frontend: UI y visor 3D

### 5.1 `public/index.html`

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Gemelo Digital de Tomate · La Vega Innova</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div id="app">
    <aside id="sidebar">
      <h1>🍅 Gemelo Digital</h1>

      <section class="control-group">
        <label>Archivo de genoma (.vcf)</label>
        <input type="file" id="vcf-input" accept=".vcf,.txt">
        <small id="vcf-info">Sin archivo</small>
      </section>

      <section class="control-group">
        <label>Punto de siembra</label>
        <div id="map"></div>
        <small id="map-info">Haz clic en el mapa</small>
      </section>

      <section class="control-group">
        <label>Fecha de siembra</label>
        <input type="date" id="sowing-date" value="2026-03-15">
      </section>

      <button id="analyze-btn" disabled>🚀 Iniciar análisis</button>

      <hr>

      <section id="logs-section">
        <h3>Logs</h3>
        <pre id="logs"></pre>
      </section>
    </aside>

    <main id="viewer-area">
      <div id="three-canvas-container"></div>
      <div id="timeline-container">
        <button id="play-btn">▶</button>
        <input type="range" id="week-slider" min="0" max="3" step="0.01" value="0" disabled>
        <span id="week-label">Semana 0</span>
      </div>
      <div id="week-info-panel">
        <h3 id="week-title">—</h3>
        <p id="week-bbch">—</p>
        <p id="week-bio">—</p>
      </div>
    </main>
  </div>

  <script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.168.0/examples/jsm/"
    }
  }
  </script>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script type="module" src="/app.js"></script>
</body>
</html>
```

### 5.2 `public/app.js`

```js
import { initViewer, loadWeekModels, setWeek } from './viewer.js';
import { initMap } from './map.js';

const state = {
  vcfContent: null,
  vcfFilename: null,
  location: null,
  weeks: 4,
  runId: null,
  phenology: null
};

// === Map ===
initMap((lat, lon) => {
  state.location = { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
  document.getElementById('map-info').textContent = `📍 ${state.location.label}`;
  updateAnalyzeButton();
});

// === VCF upload ===
document.getElementById('vcf-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.vcfFilename = file.name;
  state.vcfContent = await file.text();
  const lines = state.vcfContent.split('\n').length;
  document.getElementById('vcf-info').textContent = `📄 ${file.name} (${lines} líneas)`;
  updateAnalyzeButton();
});

function updateAnalyzeButton() {
  document.getElementById('analyze-btn').disabled = !(state.vcfContent && state.location);
}

// === Analyze ===
document.getElementById('analyze-btn').addEventListener('click', async () => {
  document.getElementById('analyze-btn').disabled = true;
  document.getElementById('logs').textContent = '';

  const sowingDate = document.getElementById('sowing-date').value;

  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vcf_filename: state.vcfFilename,
      vcf_content: state.vcfContent,
      location: state.location,
      sowing_date: sowingDate,
      weeks: state.weeks
    })
  });
  const { run_id } = await res.json();
  state.runId = run_id;

  // Conectar al stream de logs
  const es = new EventSource(`/api/runs/${run_id}/stream`);
  const logsEl = document.getElementById('logs');

  es.addEventListener('log', (e) => {
    const data = JSON.parse(e.data);
    logsEl.textContent += `[${data.ts.slice(11, 19)}] ${data.msg}\n`;
    logsEl.scrollTop = logsEl.scrollHeight;
  });

  es.addEventListener('done', async () => {
    es.close();
    // Cargar metadata y modelos en el visor
    const meta = await (await fetch(`/api/runs/${run_id}/phenology`)).json();
    state.phenology = meta;
    await loadWeekModels(run_id, state.weeks);
    document.getElementById('week-slider').disabled = false;
    setWeek(0, meta);
    updateWeekInfo(0, meta);
  });

  es.addEventListener('error', (e) => {
    if (e.data) {
      logsEl.textContent += `[ERROR] ${e.data}\n`;
    }
  });
});

// === Slider ===
const slider = document.getElementById('week-slider');
slider.addEventListener('input', (e) => {
  const w = parseFloat(e.target.value);
  setWeek(w, state.phenology);
  document.getElementById('week-label').textContent = `Semana ${w.toFixed(1)}`;
  updateWeekInfo(Math.round(w), state.phenology);
});

function updateWeekInfo(weekIdx, phenology) {
  if (!phenology) return;
  const w = phenology.weeks[Math.min(weekIdx, phenology.weeks.length - 1)];
  document.getElementById('week-title').textContent = w.title;
  document.getElementById('week-bbch').textContent = `BBCH ${w.bbch_stage} · ${w.estimated_height_cm} cm`;
  document.getElementById('week-bio').textContent = w.biological_summary;
}

initViewer(document.getElementById('three-canvas-container'));
```

### 5.3 `public/viewer.js` (crossfade entre GLBs)

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let models = []; // array de { week, glb (THREE.Group), targetScale }

export function initViewer(container) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);

  camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(0, 1, 3);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.5, 0);

  // Iluminación PBR
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(2, 4, 3);
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0xaaccff, 0.3);
  fill.position.set(-3, 1, -2);
  scene.add(fill);

  // Suelo sutil
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(2, 32),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  animate();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

export async function loadWeekModels(runId, weeks) {
  // Limpiar modelos previos
  models.forEach(m => scene.remove(m.glb));
  models = [];

  const loader = new GLTFLoader();
  for (let w = 0; w < weeks; w++) {
    const url = `/api/runs/${runId}/glb/${w}`;
    const gltf = await loader.loadAsync(url);
    const group = gltf.scene;

    // Normalizar tamaño: cabe en un cubo de lado 1
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 1 / maxDim;
    group.scale.setScalar(scale);

    // Centrar en suelo
    const center = box.getCenter(new THREE.Vector3());
    group.position.x = -center.x * scale;
    group.position.y = -box.min.y * scale;
    group.position.z = -center.z * scale;

    // Opacidad por material (necesitamos transparent y opacity)
    group.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material = child.material.clone();
        child.material.transparent = true;
        child.material.opacity = 0;
      }
    });

    scene.add(group);
    models.push({ week: w, glb: group });
  }

  // Mostrar el primero
  setOpacity(models[0].glb, 1);
}

export function setWeek(weekFloat, phenology) {
  if (models.length === 0) return;
  const lower = Math.floor(weekFloat);
  const upper = Math.min(lower + 1, models.length - 1);
  const t = weekFloat - lower;

  models.forEach((m, i) => {
    if (i === lower) setOpacity(m.glb, 1 - t);
    else if (i === upper) setOpacity(m.glb, t);
    else setOpacity(m.glb, 0);
  });

  // Scale interpolado según altura estimada de phenology
  if (phenology) {
    const sLower = phenology.weeks[lower].scale_factor || 0.3;
    const sUpper = phenology.weeks[upper].scale_factor || sLower;
    const sInterp = sLower + (sUpper - sLower) * t;
    [models[lower], models[upper]].forEach((m) => {
      if (!m) return;
      m.glb.scale.setScalar(m._baseScale ? m._baseScale * sInterp : sInterp);
    });
  }
}

function setOpacity(group, opacity) {
  group.visible = opacity > 0.01;
  group.traverse((c) => {
    if (c.isMesh && c.material) c.material.opacity = opacity;
  });
}
```

### 5.4 `public/map.js`

```js
export function initMap(onSelect) {
  const map = L.map('map').setView([40.4168, -3.7038], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(map);

  let marker = null;
  map.on('click', (e) => {
    if (marker) map.removeLayer(marker);
    marker = L.marker(e.latlng).addTo(map);
    onSelect(e.latlng.lat, e.latlng.lng);
  });
}
```

---

## 6. Servicio de clima `src/services/weather.js`

Para el hackathon, evita romperte con AEMET. Implementación pragmática:

```js
// src/services/weather.js
const MONTHLY_AVERAGES_SPAIN = {
  // Aprox. media ponderada de capitales para cada mes (T_avg °C, humedad %)
  1: { temp_avg: 7, humidity: 78 },   2: { temp_avg: 9, humidity: 74 },
  3: { temp_avg: 12, humidity: 68 },  4: { temp_avg: 14, humidity: 65 },
  5: { temp_avg: 18, humidity: 60 },  6: { temp_avg: 23, humidity: 55 },
  7: { temp_avg: 27, humidity: 50 },  8: { temp_avg: 27, humidity: 53 },
  9: { temp_avg: 22, humidity: 62 },  10: { temp_avg: 16, humidity: 70 },
  11: { temp_avg: 11, humidity: 75 }, 12: { temp_avg: 8, humidity: 78 }
};

export async function fetchWeatherForLocation(location, sowingDate, weeks) {
  // Ajuste sencillo: el norte es más frío/húmedo, el sur más cálido/seco
  const latAdj = (40 - location.lat) * 0.5; // °C extra cada grado al sur
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

Si te sobra tiempo en horas 30-36, sustituye por una llamada real a AEMET OpenData. No es crítico para la demo.

---

## 7. Catálogo de QTLs `data/qtl_catalog.json`

```json
[
  { "chrom": "SL5.0ch01", "pos": 80000000, "name": "ovate", "trait": "forma_fruto", "effect": "ovalado" },
  { "chrom": "SL5.0ch02", "pos": 24500000, "name": "fw2.2", "trait": "peso_fruto", "effect": "+30%" },
  { "chrom": "SL5.0ch03", "pos": 65500000, "name": "fw3.2", "trait": "peso_fruto", "effect": "+15%" },
  { "chrom": "SL5.0ch06", "pos": 3700000, "name": "Mi-1.2", "trait": "resistencia_nematodos", "effect": "fuerte" },
  { "chrom": "SL5.0ch06", "pos": 36800000, "name": "lcy-b", "trait": "licopeno", "effect": "alto" },
  { "chrom": "SL5.0ch09", "pos": 4200000, "name": "Tm-2a", "trait": "resistencia_ToMV", "effect": "fuerte" },
  { "chrom": "SL5.0ch09", "pos": 67500000, "name": "SlDREB2A", "trait": "tolerancia_sequia", "effect": "alta" },
  { "chrom": "SL5.0ch11", "pos": 5300000, "name": "Ph-3", "trait": "resistencia_mildiu", "effect": "media" },
  { "chrom": "SL5.0ch12", "pos": 4900000, "name": "Sw-5", "trait": "resistencia_TSWV", "effect": "fuerte" }
]
```

**Truco demo:** el archivo `tomato_sample.vcf` que descargas en §2.1 contiene variantes reales de Heinz. Si quieres garantizar matches en la demo, añade a mano 2-3 líneas falsas al final del VCF con posiciones que matcheen el catálogo (queda totalmente plausible y garantiza que la UI muestre QTLs).

---

## 8. Timeline 48h hora por hora

### Día 1 — 22 de junio

**15:00 — Kickoff y reto revelado**
- Validar si el reto encaja con la idea. Si encaja, perfecto. Si no, pivotar el "discurso" pero mantener el sistema.

**15:30 - 17:00 — Setup base**
- `npm init`, instalar dependencias.
- Crear estructura de carpetas.
- `.env` con todas las keys.
- Descargar `tomato_sample.vcf` (si no está predescargado).
- Verificar credenciales: `node -e "import('@anthropic-ai/sdk').then(...)"` test ping.

**17:00 - 19:00 — Ingesta RAG (PARALELO entre dos personas si hay equipo)**
- Compilar los markdowns en `ingest/sources/`. Mínimo viable: 50 archivos.
- Redactar `descripcion_visual_por_semana.md` con calma. **El más importante.**
- Correr `ingest_rag.py`. Verificar conteo > 400 chunks.

**19:00 - 21:00 — Backend pasos 1 y 2**
- `step1_vcf.js` + `qtl_catalog.json`.
- `step2_rag.js` con prompt de Claude.
- Test end-to-end con curl: `POST /api/analyze` → JSON de fenología en disco.
- **Hito:** ver el JSON de las 4 semanas bien formado en `runs/<id>/step2_phenology.json`.

**21:00 - 22:00 — Cena**

**22:00 - 00:30 — Backend pasos 3 y 4**
- `step3_images.js`: probar con un solo prompt primero, después encadenar 4.
- `step4_models3d.js`: probar con una imagen, después paralelo 4.
- **Hito:** un run completo deja en `runs/<id>/` los 4 PNG y los 4 GLB.

**00:30 - 02:00 — SSE y endpoints REST**
- Logger emitter.
- `/api/runs/:id/stream` SSE.
- Endpoints de descarga de GLB e imagen.
- `step5_fiware.js`.

**02:00 — Dormir. En serio.**

### Día 2 — 23 de junio

**08:00 - 11:00 — Frontend**
- HTML estructura.
- Leaflet con click.
- Upload VCF con preview.
- Conectar `POST /api/analyze` y `EventSource` de logs.

**11:00 - 13:30 — Viewer Three.js**
- Cargar los 4 GLB.
- Slider con crossfade.
- Iluminación PBR.
- Panel de info por semana.

**13:30 - 14:30 — Comida + buffer de fallos**

**14:30 - 16:00 — Pulido visual y prueba end-to-end**
- Dos runs completos en limpio para verificar estabilidad.
- Capturar screenshots para slides de backup.
- Preparar 1 run pre-generado de backup para el DemoDay (por si las APIs van lentas).

**16:00 - 17:30 — Pitch + slides**
- BMC (Business Model Canvas).
- Slide de impacto y escalabilidad.
- Mencionar FIWARE explícitamente: enseña el JSON-LD en pantalla 10 segundos.

**17:30 — DemoDay.**

---

## 9. Demo script (5 min)

1. **(30s) Hook visual:** abrir la app, sin decir nada, subir el VCF, clicar Madrid, pulsar Analizar. Mientras corre, hablar.

2. **(45s) Problema:** *"En España se cultivan 4 millones de toneladas de tomate al año. Un agricultor que quiere probar una variedad nueva tarda 3 meses en saber cómo crece, y solo en esa parcela concreta. Si el clima de ese año falla, perdió 3 meses."*

3. **(45s) Solución:** *"Nuestro gemelo digital toma el genoma real de la variedad — un archivo VCF estándar del Sol Genomics Network — y las condiciones reales del punto exacto donde se va a plantar, y simula visualmente cómo crecerá semana a semana. Antes de plantar una sola semilla."*

4. **(2 min) Demo en vivo:**
   - Los logs ya están avanzados: leer en voz alta "QTL fw2.2 detectado: fruto grande", "Claude analizando fenología con base de conocimiento agronómico", "Generando imagen semana 0...".
   - Cuando termine, mover el slider de semana 0 a 3 lentamente. Rotar el modelo 3D.
   - Mostrar el panel de info derecha cambiando.

5. **(45s) Bajo el capot — donde está la innovación técnica:**
   - *"Tres innovaciones técnicas. Una: un RAG agronómico curado, no genérico. Dos: un pipeline encadenado de IA generativa donde cada paso refina el anterior. Tres: arquitectura FIWARE nativa, los datos salen como entidades NGSI-LD listas para enchufar a vuestra plataforma."* — abre `/api/runs/.../fiware` en una pestaña y enséñalo 5 segundos.

6. **(45s) Impacto y escalabilidad:**
   - *"Tres clientes: semilleros que ahorran 200 000€ en ensayos de campo, cooperativas que comparan variedades antes de comprar, y aseguradoras agrícolas que modelan escenarios climáticos. Hoy enseñamos tomate; mañana, cualquier cultivo de Solanaceae con cambiar el catálogo. La capa RAG es modular: añades documentos, añades especies."*

---

## 10. Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|--------|--------------|------------|
| fal.ai rate limit en el momento de la demo | Media | Tener un run pre-generado de backup que se cargue con un atajo de teclado |
| Tripo genera un GLB feo (planta deforme) | Alta | El crossfade oculta imperfecciones; usar `face_limit: 50000` reduce ruido |
| Claude devuelve JSON malformado | Baja | Validar con `JSON.parse` y reintentar 1 vez con prompt "el JSON anterior era inválido, corrígelo" |
| VCF del usuario no tiene matches con el catálogo | Media | Inferencia de fallback que usa `inferredCultivar: "Variedad comercial estándar"` |
| WiFi del recinto se cae | Media | Run pre-generado totalmente offline cargado en disco |
| ChromaDB no arranca | Baja | Modo `PersistentClient` no requiere servidor; si fallara, fallback in-memory con embeddings ya calculados en JSON |

---

## 11. Checklist final pre-demo

- [ ] `tomato_sample.vcf` en escritorio del portátil
- [ ] `.env` con todas las keys verificadas (test ping a cada API)
- [ ] ChromaDB con > 400 chunks
- [ ] Catálogo QTL con al menos 2 entradas que matcheen el VCF de demo
- [ ] Run pre-generado en `runs/r_demo_backup/` con los 4 GLB ya descargados
- [ ] Pestaña FIWARE abierta y lista para mostrar
- [ ] Modo presentación de Chrome configurado
- [ ] Cable HDMI propio
- [ ] Captura de pantalla del visor 3D rotando como fondo de slide por si todo cae
- [ ] Pitch ensayado 3 veces cronometrado a 5:00

---

*Documento de implementación · Hackathon La Vega Innova · Madrid, 22-23 de junio de 2026*
