# PRD-004: Motor RAG Patrimonial — Dominio CIVIL_Y_ARQUITECTONICO

## Contexto y Segregación de Dominios (CRÍTICO)

| Dominio | Estado | Carpeta Drive ID | Uso RAG |
|---------|--------|------------------|---------|
| **FINANCIERO_Y_FONDOS** | `IMMUTABLE_PRODUCTION` | `1eGceRlB1-E2QF0iIl_aIp1DJs1TmzJwV` (01_COMPROBANTES_RECIBIDOS) | **PROHIBIDO** — Pipeline cerrado, solo comprobantes de depósitos |
| **CIVIL_Y_ARQUITECTONICO** | `ACTIVE_DEVELOPMENT` | `1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY` (raíz `enka`) → Sub: `1GPRxyz1k4tpY83RbJj7peFq7gdPHge3F` (ENKA SEPTIEMBRE 2026) | **EXCLUSIVO** — Motor RAG vía GEB-Runtime |

**Regla de Oro:** El RAG **NUNCA** toca el dominio financiero. El pipeline de eventos, embedding y retrieval se aprovisiona en proyecto GCP dedicado/aislado para data civil/arquitectónica/legal.

---

## Objetivo

Implementar un motor RAG (Retrieval-Augmented Generation) serverless sobre la carpeta `ENKA SEPTIEMBRE 2026` para habilitar consultas en lenguaje natural sobre:

- Patologías estructurales y reportes técnicos (Anexo Técnico)
- Documentos legales (Solicitud Alcaldía, Reglamento Interno, G.O. 39.272)
- Actas de asamblea, planificación de Fases II/III
- Correspondencia institucional (IPC, Alcaldía, Co-Custodia)

---

## Arquitectura de Eventos (Pub/Sub → Cloud Function → Vertex AI)

```
┌─────────────────────────────────────────────────────────────────┐
│                    DOMINIO: CIVIL_Y_ARQUITECTONICO              │
├─────────────────────────────────────────────────────────────────┤
│  Drive Folder: 1GPRxyz1k4tpY83RbJj7peFq7gdPHge3F                │
│    (ENKA SEPTIEMBRE 2026)                                       │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────┐    Pub/Sub Topic: rag-civil-events        │
│  │ Drive Watch     │ ──────────────────────────────────►       │
│  │ (Changes API)   │           │                               │
│  └─────────────────┘           ▼                               │
│                    ┌─────────────────────┐                     │
│                    │ Cloud Function      │                     │
│                    │ (Node.js 20 / Python)│                    │
│                    │ 1. Download doc     │                     │
│                    │ 2. Parse/Chunk      │                     │
│                    │ 3. Embed (Vertex AI)│                     │
│                    │ 4. Upsert Vector DB │                     │
│                    └──────────┬──────────┘                     │
│                               │                                │
│                    ┌──────────▼──────────┐                     │
│                    │ Vector Store        │                     │
│                    │ (Vertex AI Matching │                     │
│                    │  Engine / Pinecone) │                     │
│                    └─────────────────────┘                     │
│                               │                                │
│                    ┌──────────▼──────────┐                     │
│                    │ Retrieval API       │                     │
│                    │ (Cloud Run / CF)    │                     │
│                    │ → Frontend Chat     │                     │
│                    └─────────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Especificación Técnica

### RF-01: Pub/Sub Topic — `rag-civil-events`

- **Nombre:** `projects/{PROJECT_ID}/topics/rag-civil-events`
- **Mensaje schema (CloudEvent):**

```json
{
  "specversion": "1.0",
  "type": "google.cloud.drive.file.v1.updated",
  "source": "//drive.googleapis.com/projects/{PROJECT_ID}",
  "id": "{fileId}",
  "time": "2026-09-07T...Z",
  "datacontenttype": "application/json",
  "data": {
    "fileId": "{fileId}",
    "folderId": "1GPRxyz1k4tpY83RbJj7peFq7gdPHge3F",
    "mimeType": "application/pdf|application/vnd.google-apps.document|...",
    "name": "{filename}",
    "driveId": "1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY",
    "changedBy": "{userEmail}",
    "changeType": "FILE_CREATED|FILE_UPDATED|FILE_TRASHED"
  }
}
```

### RF-02: Cloud Function — `rag-civil-ingest`

- **Runtime:** Node.js 20 (o Python 3.11)
- **Trigger:** Pub/Sub push a `rag-civil-events`
- **IAM:** Service Account con roles:
  - `drive.readonly` (sobre carpeta `1GPRxyz...`)
  - `aiplatform.user` (Vertex AI Embeddings)
  - `datastore.documents.write` (Vertex AI Search / Matching Engine)
  - `pubsub.publisher` (para dead-letter / retry topic)
- **Lógica:**
  1. Validar `data.folderId === "1GPRxyz1k4tpY83RbJj7peFq7gdPHge3F"` (guardia de dominio)
  2. Si `changeType === FILE_TRASHED` → delete vectors by `fileId`
  3. Descargar contenido via Drive API (`files.get` + `files.export` para Docs)
  4. Chunking semántico: 512 tokens, overlap 50, respetando estructura (headings, tablas)
  5. Embedding: `text-embedding-004` (Vertex AI) / `textembedding-gecko@003`
  6. Upsert en Vector Store con metadata: `{fileId, folderId, name, mimeType, page/section, driveId}`
  7. Ack Pub/Sub; en error → retry con backoff exponencial (max 3) → dead-letter topic `rag-civil-dlq`

### RF-03: Vector Store — Vertex AI Matching Engine (o Pinecone)

- **Índice:** `rag-civil-index-{env}`
- **Dimensiones:** 768 (gecko) / 768 (text-embedding-004)
- **Metadata filterable:** `folderId`, `driveId`, `mimeType`, `section`
- **Namespace isolation:** `civil_patrimonial` (nunca `financiero`)

### RF-04: Retrieval API — `rag-civil-query`

- **Endpoint:** Cloud Run service o Cloud Function HTTP
- **Input:** `{ query: string, topK: 5, filters: { folderId?, mimeType? } }`
- **Output:** `{ results: [{ content, score, metadata }], generatedAnswer?: string }`
- **Auth:** OIDC token (IAP / Cloud Run invoker) — solo frontend autorizado

### RF-05: Drive Watch Setup (Inicialización)

- Canal de notificaciones Drive API v3 (`files.watch`)
- `address`: Pub/Sub push endpoint (`https://{region}-{project}.cloudfunctions.net/rag-civil-webhook`)
- `params.ttl`: 864000 (10 días, renovar via scheduler)
- `payload`: true

---

## Seguridad y Gobernanza

| Control | Implementación |
| --------- | ---------------- |
| **Domain Guard** | Cloud Function valida `folderId` === `1GPRxyz...` antes de procesar |
| **Network** | VPC-SC perimetrado; Cloud Function en VPC connector; Vertex AI private endpoint |
| **Encryption** | CMEK para Vector Store; TLS 1.3 en tránsito; PQC-ready (hybrid KEM en roadmap) |
| **Access** | Retrieval API tras IAP / Identity-Aware Proxy; solo `enka-frontend` service account |
| **Audit** | Cloud Audit Logs en `rag-civil-*` resources; Data Access logs enabled |
| **Retention** | Vectors TTL 365d; Drive watch renewal via Cloud Scheduler (diario) |

---

## Requisitos No Funcionales

- **Latencia ingestion:** < 30s p95 (file → vector upsert)
- **Latencia query:** < 2s p95 (retrieval + generation)
- **Throughput:** 100 docs/hora burst; 10 qps query
- **Disponibilidad:** 99.9% (Cloud Run + Vertex AI SLA)
- **Costo estimado:** < $50/mes (embedding + vector store + CF invocations)

---

## Criterios de Aceptación

- [ ] Topic `rag-civil-events` creado en proyecto GCP correcto
- [ ] Cloud Function `rag-civil-ingest` deployada y recibe push de Pub/Sub
- [ ] Drive Watch activo sobre `1GPRxyz1k4tpY83RbJj7peFq7gdPHge3F` → Pub/Sub
- [ ] Documento PDF/Doc subido a carpeta → vectors aparecidos en índice (< 60s)
- [ ] Query "¿Cuál es el estado de la Fase II?" retorna chunks relevantes del Anexo Técnico
- [ ] Query sobre data financiera retorna vacío (domain guard)
- [ ] Dead-letter topic captura fallos tras 3 retries
- [ ] Engram hito registrado
