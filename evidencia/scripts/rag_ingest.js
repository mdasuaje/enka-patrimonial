/**
 * RAG Civil Ingest — Cloud Function Gen 2 (Node.js 20)
 *
 * Trigger: Pub/Sub push desde topic `rag-civil-events`
 * Función: Procesa cambios en Drive (carpeta ENKA SEPTIEMBRE 2026) → Embeddings → Vertex AI Vector Search
 *
 * DEPLOY:
 * gcloud functions deploy rag-civil-ingest --gen2 --runtime=nodejs20 --region=us-central1 \
 *   --source=. --entry-point=ingestHandler --trigger-topic=rag-civil-events \
 *   --service-account=rag-civil-ingest-sa@enka-patrimonial-rag.iam.gserviceaccount.com \
 *   --set-env-vars="DRIVE_FOLDER_ID=1GPRxyz...,DRIVE_ROOT_ID=1oq-3k...,VECTOR_INDEX_ID=rag-civil-index-prod,GCP_PROJECT=enka-patrimonial-rag,GCP_REGION=us-central1"
 */

const { GoogleAuth } = require("google-auth-library");
const { VertexAI } = require("@google-cloud/vertexai");
const { google } = require("googleapis");
const { PubSub } = require("@google-cloud/pubsub");

// ============================================================
// CONFIG & CLIENTS (inicialización en cold start)
// ============================================================

const CONFIG = {
  // Validación estricta de dominio (GUARDIA CRÍTICA)
  ALLOWED_FOLDER_ID:
    process.env.DRIVE_FOLDER_ID || "1GPRxyz1k4tpY83RbJj7peFq7gdPHge3F",
  ALLOWED_DRIVE_ID:
    process.env.DRIVE_ROOT_ID || "1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY",

  // Vertex AI Vector Search
  VECTOR_INDEX_ID: process.env.VECTOR_INDEX_ID || "rag-civil-index-prod",
  VECTOR_ENDPOINT: process.env.VECTOR_ENDPOINT, // Opcional: si se usa public endpoint

  // Chunking
  CHUNK_SIZE: 512,
  CHUNK_OVERLAP: 50,

  // Embedding model
  EMBEDDING_MODEL: "text-embedding-004", // Vertex AI
  // Alternative: 'textembedding-gecko@003'

  // Retry/DLQ
  DLQ_TOPIC: "rag-civil-dlq",
  MAX_RETRIES: 3,
};

let vertexAI = null;
let driveClient = null;
let pubsub = null;
const indexClient = null;

async function initClients() {
  if (vertexAI) return; // Ya inicializado

  const auth = new GoogleAuth({
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });

  const projectId = process.env.GCP_PROJECT || (await auth.getProjectId());
  const region = process.env.GCP_REGION || "us-central1";

  // Vertex AI
  vertexAI = new VertexAI({ project: projectId, location: region });

  // Drive API
  const driveAuth = await auth.getClient();
  driveClient = google.drive({ version: "v3", auth: driveAuth });

  // Pub/Sub para DLQ
  pubsub = new PubSub({ projectId });

  // Vector Search (Matching Engine) - usar REST API directa
  // Nota: @google-cloud/vertexai no expone Matching Engine client completo
  // Usamos fetch contra el endpoint
}

function getVertexAI() {
  if (!vertexAI)
    throw new Error("Clients not initialized. Call initClients() first.");
  return vertexAI;
}

function getDriveClient() {
  if (!driveClient)
    throw new Error("Clients not initialized. Call initClients() first.");
  return driveClient;
}

function getPubSub() {
  if (!pubsub)
    throw new Error("Clients not initialized. Call initClients() first.");
  return pubsub;
}

// ============================================================
// UTILIDADES: Chunking, Embedding, Vector Upsert
// ============================================================

function chunkText(
  text,
  size = CONFIG.CHUNK_SIZE,
  overlap = CONFIG.CHUNK_OVERLAP,
) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    let chunk = text.slice(start, end);

    // Intentar cortar en límite de oración/párrafo
    if (end < text.length) {
      const lastPeriod = chunk.lastIndexOf(". ");
      const lastNewline = chunk.lastIndexOf("\n");
      const cutPoint = Math.max(lastPeriod, lastNewline);
      if (cutPoint > size * 0.5) {
        // Solo si no perdemos mucho
        chunk = chunk.slice(0, cutPoint + 1);
        start += cutPoint + 1;
      } else {
        start = end;
      }
    } else {
      start = end;
    }

    if (chunk.trim().length > 50) {
      // Filtrar chunks muy pequeños
      chunks.push(chunk.trim());
    }

    // Overlap
    start = Math.max(0, start - overlap);
  }

  return chunks;
}

async function generateEmbeddings(texts) {
  const vertex = getVertexAI();
  const model = vertex.preview.getGenerativeModel({
    model: CONFIG.EMBEDDING_MODEL,
  });

  // Vertex AI text-embedding-004 usa embedContent
  const requests = texts.map((text) => ({
    model: CONFIG.EMBEDDING_MODEL,
    content: { parts: [{ text }] },
    taskType: "RETRIEVAL_DOCUMENT",
  }));

  // Batch embedding (Vertex AI soporta batch en preview)
  const responses = await Promise.all(
    requests.map((req) =>
      vertex.preview.getGenerativeModel({ model: req.model }).embedContent(req),
    ),
  );

  return responses.map((r) => r.embedding.values);
}

async function downloadDriveFile(fileId, mimeType) {
  const drive = getDriveClient();

  if (mimeType === "application/vnd.google-apps.document") {
    // Google Doc → exportar como texto plano
    const res = await drive.files.export(
      {
        fileId,
        mimeType: "text/plain",
      },
      { responseType: "text" },
    );
    return res.data;
  } else if (mimeType === "application/vnd.google-apps.spreadsheet") {
    const res = await drive.files.export(
      {
        fileId,
        mimeType: "text/csv",
      },
      { responseType: "text" },
    );
    return res.data;
  } else if (mimeType === "application/pdf") {
    const res = await drive.files.get(
      {
        fileId,
        alt: "media",
      },
      { responseType: "arraybuffer" },
    );
    // Para PDFs, necesitaríamos pdf-parse o similar
    // Aquí simplificamos: retornar metadata y marcar para procesamiento async
    return `[PDF: ${fileId} - procesar con pdf-parse en worker separado]`;
  } else {
    // Intentar descargar como texto
    try {
      const res = await drive.files.get(
        {
          fileId,
          alt: "media",
        },
        { responseType: "text" },
      );
      return res.data;
    } catch (e) {
      return `[Binary file: ${mimeType} - ${fileId}]`;
    }
  }
}

async function upsertVectors(fileId, fileName, chunks, embeddings, metadata) {
  // Usar Vertex AI Vector Search REST API
  // Endpoint: https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/indexEndpoints/{endpoint}:upsertDatapoints

  const projectId = process.env.GCP_PROJECT;
  const region = process.env.GCP_REGION || "us-central1";
  const endpointId = process.env.VECTOR_ENDPOINT_ID; // Deployed index endpoint ID

  if (!endpointId) {
    console.warn("VECTOR_ENDPOINT_ID no configurado, saltando upsert");
    return { skipped: true };
  }

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const token = await auth.getAccessToken();

  const datapoints = chunks.map((chunk, i) => ({
    datapointId: `${fileId}_chunk_${i}`,
    featureVector: embeddings[i],
    restricts: [
      { namespace: "folderId", allowList: [CONFIG.ALLOWED_FOLDER_ID] },
      { namespace: "driveId", allowList: [CONFIG.ALLOWED_DRIVE_ID] },
      { namespace: "fileId", allowList: [fileId] },
      { namespace: "mimeType", allowList: [metadata.mimeType] },
    ],
  }));

  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/indexEndpoints/${endpointId}:upsertDatapoints`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ datapoints }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Vector upsert failed: ${response.status} ${err}`);
  }

  return response.json();
}

async function deleteVectorsByFileId(fileId) {
  const projectId = process.env.GCP_PROJECT;
  const region = process.env.GCP_REGION || "us-central1";
  const endpointId = process.env.VECTOR_ENDPOINT_ID;

  if (!endpointId) return { skipped: true };

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const token = await auth.getAccessToken();

  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/indexEndpoints/${endpointId}:removeDatapoints`;

  // Necesitamos los datapointIds exactos. Como no los tenemos, usamos filter por namespace
  // Vertex AI Matching Engine no soporta delete by filter directo en API pública
  // Workaround: marcar como deleted en metadata o usar batch delete con IDs conocidos
  console.warn(
    `Delete vectors for fileId ${fileId} - implementar según estrategia de índice`,
  );

  return { noted: true };
}

// ============================================================
// MAIN HANDLER: ingestHandler
// ============================================================

async function processEvent(message) {
  const data = message.json || {};

  // Validación de dominio (GUARDIA CRÍTICA)
  if (data.folderId !== CONFIG.ALLOWED_FOLDER_ID) {
    console.log(
      `Domain guard: rejecting event from folder ${data.folderId} (allowed: ${CONFIG.ALLOWED_FOLDER_ID})`,
    );
    return { status: "rejected", reason: "domain_guard" };
  }

  if (data.driveId !== CONFIG.ALLOWED_DRIVE_ID) {
    console.log(`Domain guard: rejecting event from drive ${data.driveId}`);
    return { status: "rejected", reason: "domain_guard_drive" };
  }

  const { fileId, name, mimeType, changeType } = data;

  console.log(`Processing ${changeType} for file ${fileId} (${name})`);

  // Handle deletion
  if (changeType === "FILE_TRASHED" || changeType === "FILE_DELETED") {
    await deleteVectorsByFileId(fileId);
    return { status: "deleted", fileId };
  }

  // Skip unsupported types
  const supportedTypes = [
    "application/pdf",
    "application/vnd.google-apps.document",
    "application/vnd.google-apps.spreadsheet",
    "text/plain",
    "text/markdown",
  ];

  if (!supportedTypes.includes(mimeType)) {
    console.log(`Unsupported mimeType: ${mimeType}`);
    return { status: "skipped", reason: "unsupported_type", mimeType };
  }

  // Download content
  let content;
  try {
    content = await downloadDriveFile(fileId, mimeType);
  } catch (err) {
    console.error(`Download failed for ${fileId}:`, err);
    throw err; // Re-lanzar para retry
  }

  if (!content || content.length < 100) {
    console.log(`Content too small or empty for ${fileId}`);
    return { status: "skipped", reason: "empty_content" };
  }

  // Chunking
  const chunks = chunkText(content);
  if (chunks.length === 0) {
    return { status: "skipped", reason: "no_chunks" };
  }

  // Embeddings
  let embeddings;
  try {
    embeddings = await generateEmbeddings(chunks);
  } catch (err) {
    console.error(`Embedding failed for ${fileId}:`, err);
    throw err; // Re-lanzar para retry
  }

  // Upsert vectors
  try {
    await upsertVectors(fileId, name, chunks, embeddings, { mimeType });
  } catch (err) {
    console.error(`Upsert failed for ${fileId}:`, err);
    throw err;
  }

  return {
    status: "success",
    fileId,
    name,
    chunks: chunks.length,
    mimeType,
  };
}

async function sendToDLQ(message, error) {
  const pubsub = getPubSub();
  const dlqTopic = pubsub.topic(CONFIG.DLQ_TOPIC);

  const dlqMessage = {
    originalMessage: message,
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    retryCount: (message.attributes?.retryCount || 0) + 1,
  };

  await dlqTopic.publishMessage({ json: dlqMessage });
  console.log(`Sent to DLQ: ${CONFIG.DLQ_TOPIC}`);
}

exports.ingestHandler = async (event) => {
  // Cloud Function Gen 2 Pub/Sub trigger recibe { message: {...} }
  const pubsubMessage = event.message;

  if (!pubsubMessage) {
    console.error("No message in event");
    return;
  }

  // Decodificar data (base64)
  let messageData;
  try {
    const decoded = Buffer.from(pubsubMessage.data, "base64").toString("utf-8");
    messageData = JSON.parse(decoded);
  } catch (err) {
    console.error("Failed to decode Pub/Sub message:", err);
    await sendToDLQ({ raw: pubsubMessage }, err);
    return;
  }

  const message = {
    ...pubsubMessage,
    json: messageData,
    attributes: pubsubMessage.attributes || {},
  };

  // Inicializar clientes
  await initClients();

  // Procesar con retry logic
  let lastError;
  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      const result = await processEvent(message);
      console.log(`Attempt ${attempt} result:`, result);
      return result;
    } catch (err) {
      lastError = err;
      console.error(`Attempt ${attempt} failed:`, err.message);
      if (attempt < CONFIG.MAX_RETRIES) {
        // Backoff exponencial
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      }
    }
  }

  // Todas las reintentos fallaron → DLQ
  console.error(`All ${CONFIG.MAX_RETRIES} attempts failed, sending to DLQ`);
  await sendToDLQ(message, lastError);
  throw lastError; // Para que Cloud Functions marque como fallido y no ack
};

// ============================================================
// HEALTH CHECK (para monitoring)
// ============================================================

exports.healthCheck = async (req, res) => {
  try {
    await initClients();
    res.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      config: {
        allowedFolder: CONFIG.ALLOWED_FOLDER_ID,
        embeddingModel: CONFIG.EMBEDDING_MODEL,
      },
    });
  } catch (err) {
    res.status(503).json({ status: "unhealthy", error: err.message });
  }
};

// ============================================================
// RENEW DRIVE WATCH (endpoint para Cloud Scheduler)
// ============================================================

exports.renewWatch = async (req, res) => {
  try {
    await initClients();

    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    const token = await auth.getAccessToken();

    const channelId = `rag-civil-watch-${Date.now()}`;
    const webhookUrl = `https://${process.env.GCP_REGION}-${process.env.GCP_PROJECT}.cloudfunctions.net/rag-civil-ingest`;

    const response = await fetch(
      "https://www.googleapis.com/drive/v3/files/watch",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          kind: "api#channel",
          id: channelId,
          type: "web_hook",
          address: webhookUrl,
          params: { ttl: "864000" },
          payload: true,
          resourceId: CONFIG.ALLOWED_DRIVE_ID,
          resourceUri: `https://www.googleapis.com/drive/v3/files?q='${CONFIG.ALLOWED_FOLDER_ID}'+in+parents&fields=files(id,name,mimeType,parents,modifiedTime)`,
        }),
      },
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(`Drive watch failed: ${JSON.stringify(result)}`);
    }

    res.json({ status: "renewed", channelId, expiration: result.expiration });
  } catch (err) {
    console.error("Renew watch failed:", err);
    res.status(500).json({ error: err.message });
  }
};
