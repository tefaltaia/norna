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


def split_markdown_by_headers(md_text, source_path, tipo):
    chunks = []
    sections = re.split(r"\n(?=#{1,3} )", md_text)
    for sec in sections:
        if not sec.strip():
            continue
        if len(sec) / 4 <= CHUNK_TARGET_TOKENS:
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
    client = chromadb.PersistentClient(
        path=str(CHROMA_PATH),
        settings=Settings(anonymized_telemetry=False)
    )
    try:
        client.delete_collection(COLLECTION_NAME)
    except Exception:
        pass
    collection = client.create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"}
    )

    vo = voyageai.Client(api_key=os.getenv("VOYAGE_API_KEY"))

    all_chunks = []
    for md_path in SOURCES_DIR.rglob("*.md"):
        tipo = md_path.parent.name
        text = md_path.read_text(encoding="utf-8", errors="ignore")
        chunks = split_markdown_by_headers(text, str(md_path.relative_to(SOURCES_DIR)), tipo)
        all_chunks.extend(chunks)
        print(f"  · {md_path.name}: {len(chunks)} chunks")

    print(f"\nTotal chunks: {len(all_chunks)}")

    BATCH = 128
    for i in range(0, len(all_chunks), BATCH):
        batch = all_chunks[i:i + BATCH]
        texts = [c["text"] for c in batch]
        result = vo.embed(texts, model="voyage-3-large", input_type="document")

        collection.add(
            ids=[f"chunk_{i + j}" for j in range(len(batch))],
            embeddings=result.embeddings,
            documents=texts,
            metadatas=[c["metadata"] for c in batch]
        )
        print(f"  · Batch {i // BATCH + 1} subido")

    print(f"\n✓ Colección '{COLLECTION_NAME}' lista con {collection.count()} chunks.")


if __name__ == "__main__":
    main()
