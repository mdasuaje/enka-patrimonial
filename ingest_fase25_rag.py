#!/usr/bin/env python3
"""
FASE 25 — RAG PATRIMONIAL ENKA (Zero-Copy, Cloud-Native)
==========================================================

Ejecución: Google Cloud Shell, Vertex AI Workbench, o AI Studio
Requisitos: gcloud auth application-default login
Proyecto: enka-patrimonial-rag

Ingesta Zero-Copy de 4 documentos civiles desde Drive → Firestore Vector Store
Documentos autorizados (carpeta 'enka' ID: 1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY):
  - Gaceta Oficial G.O. 39.272 (Marco Legal)
  - Dossier Fotografico (Informes Técnicos)
  - ANEXO TECNICO (Estatus Obras)
  - Carta Solicitud Apoyo (Correspondencia)
"""

import asyncio
import hashlib
import os
import sys
from datetime import datetime

# -----------------------------------------------------------------------------
# CONFIGURACIÓN
# -----------------------------------------------------------------------------
PROJECT_ID = os.getenv("GCP_PROJECT", "enka-patrimonial-rag")
REGION = os.getenv("GCP_REGION", "us-central1")
DRIVE_ROOT_FOLDER = "1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY"  # Carpeta 'enka' pública

AUTHORIZED_DOCS = {
    "GACETA": "Gaceta Oficial G.O. 39.272",
    "DOSSIER": "Dossier Fotografico",
    "ANEXO": "ANEXO TECNICO",
    "CARTA": "Carta Solicitud Apoyo",
}

# -----------------------------------------------------------------------------
# IMPORTACIONES (validar dependencias)
# -----------------------------------------------------------------------------
try:
    from google.auth import default
    from google.cloud import aiplatform, firestore
    from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
    from google.cloud.firestore_v1.vector import Vector
    from googleapiclient.discovery import build
    from langchain.text_splitter import RecursiveCharacterTextSplitter
    from langchain_google_vertexai import ChatVertexAI, VertexAIEmbeddings
except ImportError as e:
    print(f"❌ Dependencia faltante: {e}")
    print(
        "Instalar: pip install -U langchain-google-vertexai langchain-community google-cloud-firestore google-cloud-aiplatform google-api-python-client google-auth pymupdf"
    )
    sys.exit(1)

# -----------------------------------------------------------------------------
# INICIALIZACIÓN CLIENTES
# -----------------------------------------------------------------------------
print(f"🔧 Inicializando clientes para proyecto: {PROJECT_ID} (región: {REGION})")

aiplatform.init(project=PROJECT_ID, location=REGION)
credentials, _ = default()
drive_service = build("drive", "v3", credentials=credentials)
db = firestore.Client(project=PROJECT_ID, database="(default)")

embeddings = VertexAIEmbeddings(model_name="text-embedding-004", project=PROJECT_ID)
llm = ChatVertexAI(
    model_name="gemini-1.5-flash-001", project=PROJECT_ID, temperature=0.1
)

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=512,
    chunk_overlap=50,
    separators=["\n\n", "\n", ". ", " ", ""],
    length_function=len,
)


# -----------------------------------------------------------------------------
# FUNCIONES: DRIVE ZERO-COPY READ
# -----------------------------------------------------------------------------
def list_authorized_files() -> list[dict]:
    """Lista archivos en carpeta 'enka' que coinciden con documentos autorizados."""
    results = []
    page_token = None

    while True:
        response = (
            drive_service.files()
            .list(
                q=f"'{DRIVE_ROOT_FOLDER}' in parents and trashed=false",
                fields="nextPageToken, files(id, name, mimeType, parents, modifiedTime)",
                pageToken=page_token,
                pageSize=100,
            )
            .execute()
        )

        for file in response.get("files", []):
            for doc_type, expected_name in AUTHORIZED_DOCS.items():
                if expected_name.lower() in file["name"].lower():
                    results.append(
                        {
                            "drive_file_id": file["id"],
                            "name": file["name"],
                            "mime_type": file["mimeType"],
                            "doc_type": doc_type,
                            "modified_time": file["modifiedTime"],
                        }
                    )
                    break

        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return results


def download_file_content(file_id: str, mime_type: str) -> str:
    """Descarga contenido en streaming (Zero-Copy)."""
    if mime_type == "application/vnd.google-apps.document":
        content = (
            drive_service.files()
            .export(fileId=file_id, mimeType="text/plain")
            .execute()
        )
        return content.decode("utf-8") if isinstance(content, bytes) else content

    elif mime_type == "application/pdf":
        import fitz  # PyMuPDF

        content_bytes = drive_service.files().get_media(fileId=file_id).execute()
        doc = fitz.open(stream=content_bytes, filetype="pdf")
        text_parts = []
        for page_num, page in enumerate(doc):
            text_parts.append(f"--- PAGE {page_num + 1} ---\n{page.get_text()}")
        doc.close()
        return "\n\n".join(text_parts)

    else:
        try:
            content = drive_service.files().get_media(fileId=file_id).execute()
            return (
                content.decode("utf-8") if isinstance(content, bytes) else str(content)
            )
        except Exception:
            return f"[Contenido no extraíble: {mime_type}]"


# -----------------------------------------------------------------------------
# CHUNKING Y METADATA
# -----------------------------------------------------------------------------
def create_chunks(doc: dict, content: str) -> list[dict]:
    """Crea chunks con metadata enriquecida."""
    chunks = text_splitter.split_text(content)
    result = []

    for i, chunk in enumerate(chunks):
        if len(chunk.strip()) < 50:
            continue

        chunk_id = hashlib.sha256(f"{doc['drive_file_id']}_{i}".encode()).hexdigest()[
            :16
        ]

        result.append(
            {
                "chunk_id": chunk_id,
                "content": chunk.strip(),
                "metadata": {
                    "doc_id": doc["drive_file_id"],
                    "source": doc["doc_type"],
                    "drive_file_id": doc["drive_file_id"],
                    "original_name": doc["name"],
                    "mime_type": doc["mime_type"],
                    "chunk_index": i,
                    "total_chunks": len(chunks),
                    "ingested_at": datetime.utcnow().isoformat() + "Z",
                },
            }
        )

    return result


# -----------------------------------------------------------------------------
# EMBEDDING Y UPSERT A FIRESTORE
# -----------------------------------------------------------------------------
async def upsert_chunks_to_firestore(chunks: list[dict], batch_size: int = 100):
    """Batch upsert a Firestore con embeddings."""
    collection = db.collection("rag_patrimonial_chunks")
    batch = db.batch()
    count = 0

    for chunk in chunks:
        embedding = await embeddings.aembed_query(chunk["content"])

        doc_data = {
            "content": chunk["content"],
            "embedding": Vector(embedding),
            **chunk["metadata"],
        }

        doc_ref = collection.document(chunk["chunk_id"])
        batch.set(doc_ref, doc_data)
        count += 1

        if count % batch_size == 0:
            await batch.commit()
            batch = db.batch()
            print(f"  📦 Committed {count} chunks...")

    if count % batch_size != 0:
        await batch.commit()

    print(f"✅ Total upserted: {count} chunks")
    return count


# -----------------------------------------------------------------------------
# PIPELINE COMPLETO DE INGESTA
# -----------------------------------------------------------------------------
async def run_ingestion_pipeline() -> int:
    print("🔍 Listando archivos autorizados en Drive...")
    files = list_authorized_files()
    print(f"   Encontrados: {len(files)} documentos")
    for f in files:
        print(f"   - [{f['doc_type']}] {f['name']} ({f['mime_type']})")

    if not files:
        print(
            "⚠️  No se encontraron documentos autorizados. Verificar nombres en Drive."
        )
        return 0

    all_chunks = []

    for doc in files:
        print(f"\n📄 Procesando: {doc['name']} ({doc['doc_type']})")
        content = download_file_content(doc["drive_file_id"], doc["mime_type"])
        print(f"   Caracteres extraídos: {len(content)}")

        chunks = create_chunks(doc, content)
        print(f"   Chunks generados: {len(chunks)}")
        all_chunks.extend(chunks)

    print(
        f"\n🧠 Generando embeddings y almacenando en Firestore ({len(all_chunks)} chunks)..."
    )
    await upsert_chunks_to_firestore(all_chunks)

    print("\n✅ INGESTA COMPLETADA")
    return len(all_chunks)


# -----------------------------------------------------------------------------
# QUERY INTERFACE (RAG RETRIEVAL + GENERATION)
# -----------------------------------------------------------------------------
async def rag_query(question: str, top_k: int = 5, filter_source: str = None) -> dict:
    """Consulta RAG: retrieval + generation."""

    query_embedding = await embeddings.aembed_query(question)

    collection = db.collection("rag_patrimonial_chunks")

    query = collection.find_nearest(
        vector_field="embedding",
        query_vector=Vector(query_embedding),
        distance_measure=DistanceMeasure.COSINE,
        limit=top_k * 2,
    )

    if filter_source:
        query = query.where("source", "==", filter_source)

    docs = query.stream()

    context_chunks = []
    for doc in docs:
        data = doc.to_dict()
        context_chunks.append(
            {
                "content": data["content"],
                "source": data.get("source", "UNKNOWN"),
                "page": data.get("page", "N/A"),
                "score": 1 - doc.distance if hasattr(doc, "distance") else 0,
            }
        )

    context_chunks = context_chunks[:top_k]

    context_text = "\n\n".join(
        [
            f"[Fuente: {c['source']}, Pág: {c['page']}]\n{c['content']}"
            for c in context_chunks
        ]
    )

    prompt = f"""Eres un asistente especializado en el expediente patrimonial del Edificio ENKA (Bien de Interés Cultural, G.O. 39.272, Caracas, Venezuela).

CONTEXTO RECUPERADO:
{context_text}

PREGUNTA: {question}

INSTRUCCIONES:
- Responde SOLO basándote en el contexto proporcionado.
- Si la información no está en el contexto, di: "No tengo información suficiente en los documentos patrimoniales disponibles".
- Cita las fuentes usando [Fuente: TIPO, Pág: X].
- Sé preciso, técnico y conciso.
- Idioma: español (variante venezolana).

RESPUESTA:"""

    response = await llm.ainvoke(prompt)

    return {
        "question": question,
        "answer": response.content,
        "sources": context_chunks,
        "retrieved_count": len(context_chunks),
    }


# -----------------------------------------------------------------------------
# MAIN
# -----------------------------------------------------------------------------
async def main():
    import argparse

    parser = argparse.ArgumentParser(description="FASE 25 - RAG Patrimonial ENKA")
    parser.add_argument(
        "--ingest", action="store_true", help="Ejecutar pipeline de ingesta completa"
    )
    parser.add_argument("--query", type=str, help="Ejecutar consulta RAG")
    parser.add_argument(
        "--top-k", type=int, default=5, help="Número de chunks a recuperar"
    )
    parser.add_argument(
        "--filter-source", type=str, help="Filtrar por tipo: GACETA|DOSSIER|ANEXO|CARTA"
    )

    args = parser.parse_args()

    if args.ingest:
        count = await run_ingestion_pipeline()
        print(
            f"\n🎯 Resultado: {count} chunks vectorizados en 'rag_patrimonial_chunks'"
        )

    elif args.query:
        result = await rag_query(args.query, args.top_k, args.filter_source)
        print(f"\n❓ Pregunta: {result['question']}")
        print(f"💬 Respuesta: {result['answer']}")
        print(f"📚 Fuentes ({result['retrieved_count']}):")
        for s in result["sources"]:
            print(f"   - [{s['source']}, Pág: {s['page']}] Score: {s['score']:.4f}")

    else:
        parser.print_help()


if __name__ == "__main__":
    asyncio.run(main())
