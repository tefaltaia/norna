# Plan 02 — RAG: ingesta de conocimiento agronómico

## Estrategia RAG

La ingesta se ejecuta **UNA VEZ antes del hackathon** (o las primeras 3 horas del día 1). No es realtime.

**Objetivo:** crear una base de conocimiento de 800-2.000 chunks de contexto agronómico curado, que Claude usará para generar descripciones fenológicas precisas y no alucinadas.

---

## Estructura de fuentes `ingest/sources/`

```
ingest/sources/
├── fenologia/
│   ├── bbch_tomate_completa.md           ← escala BBCH oficial traducida
│   ├── ciclo_tomate_semanal.md           ← compilado FAO Crop Calendar
│   ├── gdd_tomate_variedades.md          ← Growing Degree Days
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
│   ├── variedades_caracteristicas.md     ← Heinz, San Marzano, Cherry, Roma
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
│   └── descripcion_visual_por_semana.md  ← ⭐ CRÍTICO — ver sección 02.2
└── clima_espana/
    ├── climas_iberia_tomate.md
    ├── ventana_siembra_por_region.md
    └── riesgos_meteorologicos.md
```

**Meta:** 150-250 archivos `.md` en total. Si tienes menos de 50 archivos, el RAG será demasiado flojo.

---

## Archivo crítico: `morfologia/descripcion_visual_por_semana.md`

Este es el **archivo que más impacto tiene en la calidad de la imagen generada**. Structure:

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
  presentes pero menos prominentes. Pelos glandulares visibles al tacto.
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

---

## Cómo obtener el contenido (real, sin alucinaciones)

### Comando de descarga masiva:

```bash
mkdir -p ingest/sources/{fenologia,fisiologia,genetica,suelo_riego,morfologia,clima_espana}

# 1. FAO — Tomato crop information (PDF → MD)
pip install marker-pdf
wget -O /tmp/fao_tomato.pdf "https://www.fao.org/3/y4011e/y4011e0d.htm"
marker_single /tmp/fao_tomato.pdf ingest/sources/fenologia/

# 2. UC Davis Tomato Production Manual (PDF gratuito)
wget -O /tmp/uc_tomato.pdf "https://anrcatalog.ucanr.edu/pdf/3470.pdf"
marker_single /tmp/uc_tomato.pdf ingest/sources/fisiologia/

# 3. Ensembl Plants — info de QTLs tomate (REST API)
curl "https://rest.ensembl.org/overlap/region/solanum_lycopersicum/2:1-1000000?feature=gene;content-type=application/json" \
  | jq '.' > ingest/sources/genetica/genes_cromosoma_2.json

# 4. PubMed Central — papers open access sobre fenología
python ingest/pmc_downloader.py \
  --query "Solanum lycopersicum phenology growth model" \
  --max-papers 30 \
  --out ingest/sources/fenologia/papers/

# 5. DSSAT parámetros CROPGRO-Tomato
git clone https://github.com/DSSAT/dssat-csm-data /tmp/dssat
cp /tmp/dssat/Tomato/*.SPE /tmp/dssat/Tomato/*.ECO ingest/sources/genetica/dssat/
```

---

## Script de ingesta `ingest/ingest_rag.py`

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

---

## Dependencias Python `ingest/requirements.txt`

```
chromadb>=1.9.0
voyageai>=0.0.4
dotenv>=0.21.0
marker-pdf>=0.3.0
```

---

## Verificación post-ingesta

```bash
python -c "
import chromadb
c = chromadb.PersistentClient(path='./data/chroma')
col = c.get_collection('tomato_agronomy')
print(f'Total chunks: {col.count()}')
print('Sample:', col.peek(2))
"
```

**Esperar ver entre 800 y 2.000 chunks.** Si hay menos de 400, la base de conocimiento es insuficiente y el RAG será flojo.

---

## Checklist de ingesta

- [ ] Crear directorio `ingest/sources/` con subdirectorios temáticos
- [ ] Descargar o copiar markdowns de fuentes reales (FAO, UC Davis, papers, etc.)
- [ ] Redactar `morfologia/descripcion_visual_por_semana.md` con detalle (⭐ crítico)
- [ ] Verificar mínimo 50 archivos `.md` en `ingest/sources/`
- [ ] Crear `ingest/requirements.txt`
- [ ] Crear `ingest/ingest_rag.py`
- [ ] Ejecutar `python ingest/ingest_rag.py`
- [ ] Verificar conteo > 400 chunks
- [ ] Hacer spot-check: `python -c "chromadb.PersistentClient(...).get_collection(...).peek(3)"`
