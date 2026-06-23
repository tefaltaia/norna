# Plan 01 — Arquitectura, stack y requisitos

## Decisiones de arquitectura y stack

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
| Mapa interactivo | Leaflet + OpenStreetMap | Zero API key, suficiente para demo |
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

## Estructura del repositorio

```
gemelo-tomate/
├── .env                            ← variables de entorno
├── package.json
├── docker-compose.yml              (opcional, solo ChromaDB si se prefiere contenerizado)
├── data/
│   ├── genomes/
│   │   └── tomato_sample.vcf       ← archivo descargado
│   ├── chroma/                     ← persistencia de embeddings (creado por la ingesta)
│   ├── qtl_catalog.json            ← catálogo de variantes/QTLs (ver §7)
│   └── fiware_contexts/
│       └── agrifood.jsonld         ← @context NGSI-LD descargado de Smart Data Models
├── ingest/                         ← scripts Python one-shot, no se ejecutan en runtime
│   ├── requirements.txt
│   ├── ingest_rag.py
│   └── sources/                    ← markdowns de la base de conocimiento (ver plan 02)
├── src/
│   ├── server.js
│   ├── config.js
│   ├── routes/
│   │   ├── analyze.js
│   │   ├── stream.js
│   │   └── runs.js
│   ├── pipeline/
│   │   ├── orchestrator.js         ← coordina los 4 pasos
│   │   ├── step1_vcf.js            ← parseo VCF + extracción variantes clave
│   │   ├── step2_rag.js            ← consulta a ChromaDB + Claude
│   │   ├── step3_images.js         ← fal.ai FLUX 4 imágenes
│   │   ├── step4_models3d.js       ← fal.ai Tripo 4 GLBs
│   │   └── step5_fiware.js         ← genera payloads NGSI-LD
│   ├── services/
│   │   ├── anthropic.js
│   │   ├── chroma.js
│   │   ├── voyage.js               ← embeddings runtime
│   │   ├── fal.js
│   │   └── logger.js               ← logger con SSE broadcast
│   └── utils/
│       ├── vcf_parser.js
│       └── runs_storage.js
├── public/
│   ├── index.html
│   ├── app.js
│   ├── viewer.js                   ← Three.js viewer
│   ├── map.js                      ← Leaflet
│   └── style.css
└── runs/                           ← se crea en runtime, una carpeta por análisis
```

---

## Dependencias `package.json` clave

```json
{
  "type": "module",
  "dependencies": {
    "express": "^4.19.0",
    "@anthropic-ai/sdk": "^0.30.0",
    "@fal-ai/client": "^1.2.0",
    "chromadb": "^1.9.0",
    "dotenv": "^16.4.0",
    "uuid": "^10.0.0",
    "cors": "^2.8.5",
    "node-fetch": "^3.3.0"
  }
}
```

---

## Pre-requisitos: descarga del VCF

### Descarga del archivo VCF de tomate

**Decisión:** trabajamos con un VCF real del proyecto Varitome del Sol Genomics Network. Concretamente, una variedad cherry contrastante con la referencia Heinz 1706.

Ejecutar **antes** de empezar el hackathon:

```bash
mkdir -p data/genomes
cd data/genomes

# Opción A — Variantes Heinz 1706 vs SL5.0 (recomendada, archivo manejable)
wget "https://solgenomics.net/ftp/tomato_genome/variants/SL5/sl5.0_variants_filtered.vcf.gz"

# Opción B (fallback) — variantes de un cultivar contrastante
wget "https://solgenomics.net/ftp/tomato_genome/variants/360_genomes/tomato360_variants.vcf.gz"

# Opción C (fallback de fallback) — desde Ensembl Plants
wget "https://ftp.ensemblgenomes.ebi.ac.uk/pub/plants/release-59/variation/vcf/solanum_lycopersicum/solanum_lycopersicum.vcf.gz"

gunzip *.vcf.gz
ls -lh
```

**Si el archivo es > 200 MB**, recórtalo a cromosoma 2:

```bash
head -n 100 sl5.0_variants_filtered.vcf | grep "^#" > tomato_sample.vcf
grep -E "^SL5.0ch02\b|^chr02\b|^2\b" sl5.0_variants_filtered.vcf | head -n 5000 >> tomato_sample.vcf
wc -l tomato_sample.vcf
```

---

## Catálogo de QTLs `data/qtl_catalog.json`

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
