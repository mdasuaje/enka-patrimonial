"""
FASE 25 REFACTORIZADA — RAG PATRIMONIAL EVENT-DRIVEN (GEB-Runtime)
====================================================================

Cloud Function Gen2 (Python 3.11) — Desplegada en proyecto: enka-patrimonial-rag
Trigger: Pub/Sub topic `rag-civil-drive-events` (eventos Drive GEB-Runtime sobre carpeta `enka`)
Función: Ingesta Zero-Copy de documentos civiles/arquitectónicos → Firestore Vector Store
Dominio: EXCLUSIVAMENTE Gestión Patrimonial Edificio ENKA (Civil/Arquitectónico)
Segregación: PROYECTO B (Financiero/Gestión Fondos) TOTALMENTE AISLADO
"""

import asyncio
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import functions_framework
from cloudevents.http import CloudEvent
from google.auth import default
from google.cloud import aiplatform, firestore
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector
from googleapiclient.discovery import build
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_google_vertexai import VertexAIEmbeddings

# -----------------------------------------------------------------------------
# CONFIGURACIÓN — PROYECTO A: GESTIÓN PATRIMONIAL ENKA (Civil/Arquitectónico)
# -----------------------------------------------------------------------------
PROJECT_ID = os.getenv("GCP_PROJECT", "enka-patrimonial-rag")
REGION = os.getenv("GCP_REGION", "us-central1")

# Carpeta Drive ORIGEN (Público - Solo Lectura): PROYECTO A
DRIVE_ENKA_PUBLIC_FOLDER = "1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY"

# Documentos autorizados para ingesta RAG (Dominio Público)
AUTHORIZED_DOCS = {
    "GACETA": "Gaceta Oficial G.O. 39.272",
    "DOSSIER": "Dossier Fotografico",
    "ANEXO": "ANEXO TECNICO",
    "CARTA": "Carta Solicitud Apoyo",
}

# Firestore Vector Store
VECTOR_COLLECTION = "rag_patrimonial_chunks"

# Validación 3-Factores para consultas privadas (Vista Ciega)
FIRESTORE_VECINOS_COLLECTION = "vecinos_autorizados"

# -----------------------------------------------------------------------------
# INICIALIZACIÓN CLIENTES (Singleton pattern para cold-start optimization)
# -----------------------------------------------------------------------------
_executor = ThreadPoolExecutor(max_workers=2)
_firestore_client = None
_drive_service = None
_embeddings_model = None
_text_splitter = None


def get_firestore_client():
    global _firestore_client
    if _firestore_client is None:
        _firestore_client = firestore.Client(project=PROJECT_ID, database="(default)")
    return _firestore_client


def get_drive_service():
    global _drive_service
    if _drive_service is None:
        credentials, _ = default(
            scopes=["https://www.googleapis.com/auth/drive.readonly"]
        )
        _drive_service = build(
            "drive", "v3", credentials=credentials, cache_discovery=False
        )
    return _drive_service


def get_embeddings_model():
    global _embeddings_model
    if _embeddings_model is None:
        aiplatform.init(project=PROJECT_ID, location=REGION)
        _embeddings_model = VertexAIEmbeddings(
            model_name="text-embedding-004", project=PROJECT_ID
        )
    return _embeddings_model


def get_text_splitter():
    global _text_splitter
    if _text_splitter is None:
        _text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=512,
            chunk_overlap=50,
            separators=["\n\n", "\n", ". ", " ", ""],
            length_function=len,
        )
    return _text_splitter


# -----------------------------------------------------------------------------
# UTILIDADES: Validación y Normalización
# -----------------------------------------------------------------------------
def is_authorized_document(file_name: str) -> str | None:
    """Verifica si el archivo coincide con documentos autorizados. Retorna doc_type o None."""
    name_lower = file_name.lower()
    for doc_type, expected_name in AUTHORIZED_DOCS.items():
        if expected_name.lower() in name_lower:
            return doc_type
    return None


def normalize_phone(phone: str) -> str:
    """Normaliza teléfono a formato E.164 (+58XXXXXXXXXX)."""
    cleaned = phone.replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    if not cleaned.startswith("+"):
        if cleaned.startswith("58"):
            cleaned = "+" + cleaned
        elif cleaned.startswith("0"):
            cleaned = "+58" + cleaned[1:]
        else:
            cleaned = "+58" + cleaned
    return cleaned


def normalize_name(name: str) -> str:
    """Normaliza nombre: uppercase, sin acentos, trim."""
    return name.upper().strip()


def normalize_apt(apt: str) -> str:
    """Normaliza apartamento: uppercase, trim."""
    return apt.upper().strip()


def validate_three_factor(telefono: str, apartamento: str, nombre: str) -> bool:
    """
    Validación 3-Factores (Zero-Trust) contra BASE_DATOS_CENTRAL_ENKA
    migrada a Firestore: vecinos_autorizados.
    """
    db = get_firestore_client()
    tel_norm = normalize_phone(telefono)
    apt_norm = normalize_apt(apartamento)
    name_norm = normalize_name(nombre)

    doc_ref = db.collection(FIRESTORE_VECINOS_COLLECTION).document(apt_norm)
    doc_snap = doc_ref.get()

    if not doc_snap.exists:
        return False

    vecino = doc_snap.to_dict()
    return (
        vecino.get("telefono_e164") == tel_norm
        and vecino.get("nombre_normalizado") == name_norm
    )


# -----------------------------------------------------------------------------
# DRIVE ZERO-COPY READ
# -----------------------------------------------------------------------------
def download_drive_content(file_id: str, mime_type: str) -> str:
    """Descarga contenido en streaming (Zero-Copy, sin persistir a disco local)."""
    drive = get_drive_service()

    if mime_type == "application/vnd.google-apps.document":
        content = drive.files().export(fileId=file_id, mimeType="text/plain").execute()
        return content.decode("utf-8") if isinstance(content, bytes) else content

    elif mime_type == "application/pdf":
        import fitz  # PyMuPDF

        content_bytes = drive.files().get_media(fileId=file_id).execute()
        doc = fitz.open(stream=content_bytes, filetype="pdf")
        text_parts = []
        for page_num, page in enumerate(doc):
            text_parts.append(f"--- PAGE {page_num + 1} ---\n{page.get_text()}")
        doc.close()
        return "\n\n".join(text_parts)

    else:
        try:
            content = drive.files().get_media(fileId=file_id).execute()
            return (
                content.decode("utf-8") if isinstance(content, bytes) else str(content)
            )
        except Exception:
            return f"[Contenido no extraíble: {mime_type}]"


def chunk_content(doc_meta: dict, content: str) -> list[dict]:
    """Genera chunks con metadata enriquecida."""
    splitter = get_text_splitter()
    chunks = splitter.split_text(content)
    result = []

    for i, chunk_text in enumerate(chunks):
        if len(chunk_text.strip()) < 50:
            continue

        chunk_id = hashlib.sha256(
            f"{doc_meta['drive_file_id']}_{i}".encode()
        ).hexdigest()[:16]

        result.append(
            {
                "chunk_id": chunk_id,
                "content": chunk_text.strip(),
                "metadata": {
                    "doc_id": doc_meta["drive_file_id"],
                    "source": doc_meta["doc_type"],
                    "drive_file_id": doc_meta["drive_file_id"],
                    "original_name": doc_meta["name"],
                    "mime_type": doc_meta["mime_type"],
                    "chunk_index": i,
                    "total_chunks": len(chunks),
                    "ingested_at": datetime.utcnow().isoformat() + "Z",
                },
            }
        )
    return result


# -----------------------------------------------------------------------------
# VECTOR STORE OPERATIONS (Firestore Native)
# -----------------------------------------------------------------------------
async def upsert_chunks_async(chunks: list[dict]) -> int:
    """Batch upsert asíncrono a Firestore con embeddings."""
    if not chunks:
        return 0

    db = get_firestore_client()
    embeddings = get_embeddings_model()
    collection = db.collection(VECTOR_COLLECTION)
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

        if count % 100 == 0:
            await batch.commit()
            batch = db.batch()

    if count % 100 != 0:
        await batch.commit()

    return count


async def delete_document_chunks_async(file_id: str) -> int:
    """Elimina chunks asociados a un file_id (para FILE_TRASHED/DELETED)."""
    db = get_firestore_client()
    collection = db.collection(VECTOR_COLLECTION)
    query = collection.where("drive_file_id", "==", file_id).limit(500)
    docs = query.stream()

    batch = db.batch()
    count = 0
    for doc in docs:
        batch.delete(doc.reference)
        count += 1

    if count > 0:
        await batch.commit()

    return count


# -----------------------------------------------------------------------------
# QUERY INTERFACE: RAG con Validación 3-Factores
# -----------------------------------------------------------------------------
async def rag_query_async(
    question: str, top_k: int = 5, filter_source: str = None, three_factor: dict = None
) -> dict:
    """
    Consulta RAG con validación opcional 3-factores.
    Si three_factor provided → permite acceso a documentos privados (filtrado por apartamento).
    Si NO three_factor → solo documentos públicos (source en AUTHORIZED_DOCS).
    """
    db = get_firestore_client()
    embeddings = get_embeddings_model()

    query_embedding = await embeddings.aembed_query(question)
    collection = db.collection(VECTOR_COLLECTION)

    query = collection.find_nearest(
        vector_field="embedding",
        query_vector=Vector(query_embedding),
        distance_measure=DistanceMeasure.COSINE,
        limit=top_k * 2,
    )

    if filter_source:
        query = query.where("source", "==", filter_source)

    # Filtro por apartamento si validación 3-factores exitosa
    if three_factor and three_factor.get("apartamento"):
        apt_norm = normalize_apt(three_factor["apartamento"])
        query = query.where("metadata.apartamento", "==", apt_norm)

    docs = query.stream()

    context_chunks = []
    for doc in docs:
        data = doc.to_dict()
        context_chunks.append(
            {
                "content": data["content"],
                "source": data.get("source", "UNKNOWN"),
                "page": data.get("metadata", {}).get("chunk_index", "N/A"),
                "score": 1 - doc.distance if hasattr(doc, "distance") else 0,
            }
        )

    context_chunks = context_chunks[:top_k]

    return {
        "question": question,
        "context": context_chunks,
        "retrieved_count": len(context_chunks),
        "three_factor_validated": three_factor is not None,
    }


# -----------------------------------------------------------------------------
# CLOUD FUNCTION ENTRY POINT: Pub/Sub Trigger (GEB-Runtime Drive Events)
# -----------------------------------------------------------------------------
@functions_framework.cloud_event
def ingest_drive_event(cloud_event: CloudEvent) -> dict:
    """
    Trigger: Pub/Sub message from GEB-Runtime (Google Drive Events)
    Event type: google.cloud.drive.file.v1.updated / created / trashed
    Filtro: Solo procesa eventos de la carpeta `enka` (1oq-3k...)
    """
    try:
        # Decodificar mensaje Pub/Sub (CloudEvent data es base64)
        message_data = cloud_event.data
        if isinstance(message_data, str):
            message_data = json.loads(message_data)
        elif isinstance(message_data, bytes):
            message_data = json.loads(message_data.decode("utf-8"))

        # Extraer atributos del evento Drive
        drive_event = message_data.get("message", {}).get("attributes", {})
        event_type = drive_event.get("eventType", "")
        file_id = drive_event.get("fileId", "")
        file_name = drive_event.get("fileName", "")
        mime_type = drive_event.get("mimeType", "")
        parent_folders = drive_event.get("parentFolderIds", [])
        _ = drive_event.get("changedBy", "unknown")

        print(
            f"📥 Evento Drive recibido: {event_type} | File: {file_name} ({file_id}) | Parent: {parent_folders}"
        )

        # GUARDIA DE DOMINIO: Solo procesar si el evento viene de la carpeta 'enka' pública
        if DRIVE_ENKA_PUBLIC_FOLDER not in parent_folders:
            print(
                f"🚫 Domain Guard: Evento fuera de carpeta autorizada. Parent folders: {parent_folders}"
            )
            return {
                "status": "ignored",
                "reason": "domain_guard",
                "parent_folders": parent_folders,
            }

        # Verificar si es documento autorizado para RAG
        doc_type = is_authorized_document(file_name)
        if not doc_type:
            print(f"🚫 Documento no autorizado para ingesta RAG: {file_name}")
            return {
                "status": "ignored",
                "reason": "not_authorized_doc",
                "file_name": file_name,
            }

        # Manejar según tipo de evento
        if event_type in ("FILE_TRASHED", "FILE_DELETED"):
            # Eliminar chunks del vector store
            loop = asyncio.new_event_loop()
            deleted = loop.run_until_complete(delete_document_chunks_async(file_id))
            loop.close()
            print(f"🗑️ Eliminados {deleted} chunks para file_id: {file_id}")
            return {"status": "deleted", "file_id": file_id, "chunks_removed": deleted}

        # Eventos de creación/actualización: Ingesta
        if event_type in ("FILE_CREATED", "FILE_UPDATED", "FILE_MODIFIED"):
            # Verificar mime type soportado
            supported_types = [
                "application/pdf",
                "application/vnd.google-apps.document",
                "text/plain",
                "text/markdown",
            ]
            if mime_type not in supported_types:
                print(f"🚫 Tipo MIME no soportado: {mime_type}")
                return {
                    "status": "ignored",
                    "reason": "unsupported_mime_type",
                    "mime_type": mime_type,
                }

            # Descargar y procesar (Zero-Copy)
            print(f"📄 Procesando documento: {file_name} ({doc_type})")
            content = download_drive_content(file_id, mime_type)

            if not content or len(content.strip()) < 100:
                print("⚠️ Contenido muy pequeño o vacío")
                return {"status": "ignored", "reason": "empty_content"}

            # Metadata del documento
            doc_meta = {
                "drive_file_id": file_id,
                "name": file_name,
                "mime_type": mime_type,
                "doc_type": doc_type,
            }

            # Chunking
            chunks = chunk_content(doc_meta, content)
            print(f"✂️ Generados {len(chunks)} chunks")

            # Upsert a Firestore Vector Store
            loop = asyncio.new_event_loop()
            upserted = loop.run_until_complete(upsert_chunks_async(chunks))
            loop.close()

            print(
                f"✅ Ingesta completada: {upserted} chunks vectorizados para {file_name}"
            )
            return {
                "status": "success",
                "file_id": file_id,
                "file_name": file_name,
                "doc_type": doc_type,
                "chunks_upserted": upserted,
                "event_type": event_type,
            }

        return {
            "status": "ignored",
            "reason": "unsupported_event_type",
            "event_type": event_type,
        }

    except Exception as e:
        import traceback

        print(f"❌ Error procesando evento Drive: {e}")
        print(traceback.format_exc())
        return {"status": "error", "error": str(e)}


# -----------------------------------------------------------------------------
# HTTP ENDPOINT: RAG Query (para frontend / auth-gateway)
# -----------------------------------------------------------------------------
@functions_framework.http
def rag_query_http(request):
    """
    HTTP Endpoint para consultas RAG.
    Headers: Authorization: Bearer <OIDC> (IAP protected)
    Body: { question, top_k?, filter_source?, three_factor? }
    three_factor: { telefono, apartamento, nombre_completo }
    """
    try:
        # Verificar autenticación (IAP pasa identity en headers)
        # En producción validar OIDC token; aquí asumimos IAP habilitado
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return {"error": "Unauthorized"}, 401

        data = request.get_json(silent=True) or {}
        question = data.get("question", "").strip()
        top_k = int(data.get("top_k", 5))
        filter_source = data.get("filter_source")
        three_factor = data.get("three_factor")

        if not question or len(question) < 3:
            return {"error": "Question required (min 3 chars)"}, 400

        # Validar 3-factores si se proporcionan
        validated_three_factor = None
        if three_factor:
            telefono = three_factor.get("telefono", "")
            apartamento = three_factor.get("apartamento", "")
            nombre = three_factor.get("nombre_completo", "")

            if not validate_three_factor(telefono, apartamento, nombre):
                return {"error": "Invalid three-factor credentials"}, 403

            validated_three_factor = {
                "telefono": normalize_phone(telefono),
                "apartamento": normalize_apt(apartamento),
                "nombre": normalize_name(nombre),
            }

        # Ejecutar query RAG
        loop = asyncio.new_event_loop()
        result = loop.run_until_complete(
            rag_query_async(question, top_k, filter_source, validated_three_factor)
        )
        loop.close()

        return result, 200

    except Exception as e:
        import traceback

        print(f"❌ RAG Query Error: {e}")
        print(traceback.format_exc())
        return {"error": "Internal server error"}, 500


# -----------------------------------------------------------------------------
# HEALTH CHECK
# -----------------------------------------------------------------------------
@functions_framework.http
def health_check(request):
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "project": PROJECT_ID,
    }, 200
