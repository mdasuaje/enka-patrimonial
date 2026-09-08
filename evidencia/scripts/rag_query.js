/**
 * RAG Civil Query API — Cloud Run Service (Node.js 20)
 *
 * Endpoint: HTTP POST /query
 * Auth: OIDC token (IAP protected)
 * Función: Retrieval + Generation para consultas en lenguaje natural sobre dominio CIVIL_Y_ARQUITECTONICO
 *
 * DEPLOY:
 * gcloud run deploy rag-civil-query --source=. --region=us-central1 \
 *   --service-account=rag-civil-ingest-sa@enka-patrimonial-rag.iam.gserviceaccount.com \
 *   --set-env-vars="VECTOR_INDEX_ENDPOINT=https://...,VECTOR_DEPLOYED_INDEX_ID=rag_civil_deployed,GCP_PROJECT=enka-patrimonial-rag"
 */

const { GoogleAuth } = require("google-auth-library");
const { VertexAI } = require("@google-cloud/vertexai");
const express = require("express");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ============================================================
// CONFIG
// ============================================================

const CONFIG = {
  // Domain Guard
  ALLOWED_FOLDER_ID:
    process.env.DRIVE_FOLDER_ID || "1GPRxyz1k4tpY83RbJj7peFq7gdPHge3F",
  ALLOWED_DRIVE_ID:
    process.env.DRIVE_ROOT_ID || "1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY",

  // Vector Search
  VECTOR_ENDPOINT: process.env.VECTOR_INDEX_ENDPOINT, // e.g. https://us-central1-aiplatform.googleapis.com/v1/projects/.../indexEndpoints/...
  VECTOR_DEPLOYED_INDEX_ID:
    process.env.VECTOR_DEPLOYED_INDEX_ID || "rag_civil_deployed",

  // Embedding
  EMBEDDING_MODEL: "text-embedding-004",

  // Generation
  GENERATION_MODEL: "gemini-1.5-flash-001",
  MAX_CONTEXT_CHUNKS: 5,
  MAX_CONTEXT_TOKENS: 4000,

  // RLS
  REQUIRE_CORREO_PROPIETARIO_FOR_NON_ADMIN: true,
};

let vertexAI = null;

async function initClients() {
  if (vertexAI) return;

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const projectId = process.env.GCP_PROJECT || (await auth.getProjectId());
  const region = process.env.GCP_REGION || "us-central1";

  vertexAI = new VertexAI({ project: projectId, location: region });
}

function getVertexAI() {
  if (!vertexAI) throw new Error("Not initialized");
  return vertexAI;
}

// ============================================================
// AUTH & RLS HELPERS
// ============================================================

async function getCallerIdentity(req) {
  // En Cloud Run con IAP, la identidad viene en headers
  // x-goog-authenticated-user-email, x-goog-authenticated-user-id
  const email = req.headers["x-goog-authenticated-user-email"]?.replace(
    "accounts/",
    "",
  );
  const userId = req.headers["x-goog-authenticated-user-id"];

  return { email, userId, isAdmin: false }; // isAdmin se determina por IAM policy
}

function isAdminCaller(email) {
  // En producción: verificar contra lista en Secret Manager o Firestore
  // Por ahora: cualquier caller autenticado via IAP con rol específico
  // Los admins del proyecto ENKA tendrán rol personalizado
  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase());
  return email && adminEmails.includes(email.toLowerCase());
}

// ============================================================
// VECTOR SEARCH
// ============================================================

async function generateQueryEmbedding(query) {
  const vertex = getVertexAI();
  const model = vertex.preview.getGenerativeModel({
    model: CONFIG.EMBEDDING_MODEL,
  });

  const result = await model.embedContent({
    model: CONFIG.EMBEDDING_MODEL,
    content: { parts: [{ text: query }] },
    taskType: "RETRIEVAL_QUERY",
  });

  return result.embedding.values;
}

async function vectorSearch(
  queryEmbedding,
  filters = {},
  topK = CONFIG.MAX_CONTEXT_CHUNKS,
) {
  if (!CONFIG.VECTOR_ENDPOINT) {
    throw new Error("VECTOR_INDEX_ENDPOINT not configured");
  }

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const token = await auth.getAccessToken();

  // Construir restricts para RLS
  const restricts = [
    { namespace: "folderId", allowList: [CONFIG.ALLOWED_FOLDER_ID] },
    { namespace: "driveId", allowList: [CONFIG.ALLOWED_DRIVE_ID] },
  ];

  // Filtros adicionales del request
  if (filters.folderId) {
    restricts.push({ namespace: "folderId", allowList: [filters.folderId] });
  }
  if (filters.mimeType) {
    restricts.push({ namespace: "mimeType", allowList: [filters.mimeType] });
  }
  // Nota: RLS por correo_propietario se hace en post-filter ya que no está en vector metadata
  // (solo folderId, driveId, fileId, mimeType están en restricts)

  const requestBody = {
    deployedIndexId: CONFIG.VECTOR_DEPLOYED_INDEX_ID,
    queries: [
      {
        datapoint: { featureVector: queryEmbedding },
        neighborCount: topK * 2, // Traer más para post-filter RLS
        restricts,
      },
    ],
    returnFullDatapoint: true,
  };

  const response = await fetch(`${CONFIG.VECTOR_ENDPOINT}:findNeighbors`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Vector search failed: ${response.status} ${err}`);
  }

  const result = await response.json();
  const neighbors = result.nearestNeighbors?.[0]?.neighbors || [];

  return neighbors.map((n) => ({
    id: n.datapoint.datapointId,
    score: n.distance, // Cosine distance (menor = más similar)
    content: "", // Vertex AI no retorna content en neighbors, solo metadata
    metadata:
      n.datapoint.restricts?.reduce((acc, r) => {
        acc[r.namespace] = r.allowList;
        return acc;
      }, {}) || {},
  }));
}

// ============================================================
// FETCH CHUNK CONTENT (desde metadata o store auxiliar)
// ============================================================

async function fetchChunkContent(chunkIds) {
  // En producción: almacenar chunks en Firestore / Cloud SQL / GCS
  // keyed by datapointId para retrieval rápido
  // Por ahora: retornar placeholder
  return chunkIds.map((id) => ({
    id,
    content: `[Chunk content for ${id} - almacenar en Firestore/GCS en producción]`,
  }));
}

// ============================================================
// RLS POST-FILTER
// ============================================================

function applyRLSFilter(results, callerEmail, isAdmin) {
  if (isAdmin) return results; // Admin ve todo

  // Filtrar por correo_propietario en metadata
  // Requiere que el chunk tenga metadata.correo_propietario
  return results.filter((r) => {
    const propietario = r.metadata?.correo_propietario?.[0];
    return (
      propietario && propietario.toLowerCase() === callerEmail.toLowerCase()
    );
  });
}

// ============================================================
// GENERATION (RAG)
// ============================================================

async function generateAnswer(query, contextChunks) {
  const vertex = getVertexAI();
  const model = vertex.preview.getGenerativeModel({
    model: CONFIG.GENERATION_MODEL,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
    },
  });

  const context = contextChunks
    .map((c, i) => `[Fuente ${i + 1}] ${c.content}`)
    .join("\n\n");

  const prompt = `Eres un asistente técnico especializado en el expediente patrimonial del Edificio ENKA (Bien de Interés Cultural, G.O. 39.272, Caracas, Venezuela).

CONTEXTO RECUPERADO:
${context}

PREGUNTA: ${query}

INSTRUCCIONES:
- Responde SOLO basándote en el contexto proporcionado.
- Si la información no está en el contexto, di "No tengo información suficiente en los documentos disponibles".
- Cita las fuentes usando [Fuente X].
- Sé preciso, técnico y conciso.
- Idioma: español (variante venezolana/rioplatense).

RESPUESTA:`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ============================================================
// ROUTES
// ============================================================

// Health check
app.get("/health", async (_req, res) => {
  try {
    await initClients();
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      config: {
        allowedFolder: CONFIG.ALLOWED_FOLDER_ID,
        embeddingModel: CONFIG.EMBEDDING_MODEL,
        generationModel: CONFIG.GENERATION_MODEL,
      },
    });
  } catch (err) {
    res.status(503).json({ status: "unhealthy", error: err.message });
  }
});

// Main query endpoint
app.post("/query", async (req, res) => {
  const startTime = Date.now();

  try {
    await initClients();

    // Auth & Identity
    const { email } = await getCallerIdentity(req);
    const callerIsAdmin = isAdminCaller(email);

    if (!email) {
      return res.status(401).json({ error: "Unauthenticated: IAP required" });
    }

    // Request validation
    const { query, topK = 5, filters = {}, generate = true } = req.body;

    if (!query || typeof query !== "string" || query.trim().length < 3) {
      return res.status(400).json({ error: "Query requerida (mín 3 chars)" });
    }

    // RLS: Non-admin debe proporcionar correo_propietario en filters
    if (!callerIsAdmin && CONFIG.REQUIRE_CORREO_PROPIETARIO_FOR_NON_ADMIN) {
      if (!filters.correo_propietario || filters.correo_propietario !== email) {
        return res.status(403).json({
          error:
            "RLS: Non-admin callers must provide filters.correo_propietario matching their identity",
        });
      }
    }

    // Generate query embedding
    const queryEmbedding = await generateQueryEmbedding(query);

    // Vector search
    let results = await vectorSearch(queryEmbedding, filters, topK);

    // Fetch chunk contents (from auxiliary store)
    const chunkIds = results.map((r) => r.id);
    const chunkContents = await fetchChunkContent(chunkIds);

    // Merge content into results
    const contentMap = Object.fromEntries(
      chunkContents.map((c) => [c.id, c.content]),
    );
    results = results.map((r) => ({ ...r, content: contentMap[r.id] || "" }));

    // Apply RLS post-filter (by correo_propietario in metadata)
    results = applyRLSFilter(results, email, callerIsAdmin);

    // Limit to topK after RLS
    results = results.slice(0, topK);

    // Generate answer if requested
    let answer = null;
    if (generate && results.length > 0) {
      answer = await generateAnswer(query, results);
    }

    const latencyMs = Date.now() - startTime;

    res.json({
      query,
      results: results.map((r) => ({
        id: r.id,
        score: r.score,
        content: r.content,
        metadata: r.metadata,
      })),
      answer,
      metadata: {
        latencyMs,
        totalResults: results.length,
        caller: email,
        isAdmin: callerIsAdmin,
        rlsApplied: !callerIsAdmin,
      },
    });
  } catch (err) {
    console.error("Query error:", err);
    res.status(500).json({
      error: "Internal server error",
      details: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

// Admin-only: list all chunks for a file (debug)
app.get("/admin/chunks/:fileId", async (req, res) => {
  const { email } = await getCallerIdentity(req);
  if (!isAdminCaller(email)) {
    return res.status(403).json({ error: "Admin only" });
  }

  // Implementar: buscar en vector store por fileId namespace
  res.json({ message: "Implementar búsqueda por fileId en Vector Search" });
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`RAG Civil Query API listening on port ${PORT}`);
  initClients().catch(console.error);
});

module.exports = app;
