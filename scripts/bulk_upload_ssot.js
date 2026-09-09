#!/usr/bin/env node
/**
 * FASE 36 — BULK UPLOAD SSoT (Zero-Copy, Async)
 * ==============================================
 *
 * Script de ingesta masiva asíncrona para procesar directorios locales
 * de imágenes y transmitirlas hacia la nube SSoT (Google Apps Script Web App).
 *
 * Arquitectura:
 * - Zero-Copy: Streaming directo sin buffers intermedios en disco
 * - Async/Pool: Concurrencia controlada con pool de workers
 * - Metadatos estandarizados: diagnostico_tecnico, fase_obra, ubicacion
 * - PQC-ready: Headers de integridad SHA-256 por objeto
 *
 * Uso:
 *   node scripts/bulk_upload_ssot.js --source ./evidencia/atlas --folder-id 1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY
 *   node scripts/bulk_upload_ssot.js --source ./evidencia --recursive --concurrency 4
 *
 * Variables de entorno:
 *   GAS_WEB_APP_URL    - URL del Web App GAS desplegado (requerido)
 *   GCP_PROJECT        - ID proyecto GCP (default: enka-patrimonial-rag)
 *   LOG_LEVEL          - DEBUG|INFO|WARN|ERROR (default: INFO)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { createReadStream } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -----------------------------------------------------------------------------
// CONFIGURACIÓN
// -----------------------------------------------------------------------------
const CONFIG = {
  // GAS Web App URL (inyectar via env o argumento)
  GAS_WEB_APP_URL: process.env.GAS_WEB_APP_URL || "",

  // Carpeta Drive raíz del Atlas Fotográfico (SSoT)
  DEFAULT_FOLDER_ID: "1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY",

  // Concurrencia máxima (respetar cuotas Drive API)
  DEFAULT_CONCURRENCY: 3,

  // Extensiones de imagen soportadas
  IMAGE_EXTENSIONS: [
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".heic",
    ".tiff",
    ".bmp",
  ],

  // Tamaño máximo por archivo (50MB)
  MAX_FILE_SIZE: 50 * 1024 * 1024,

  // Chunk size para streaming (1MB)
  STREAM_CHUNK_SIZE: 1024 * 1024,

  // Timeouts
  UPLOAD_TIMEOUT_MS: 120000,
  REQUEST_TIMEOUT_MS: 30000,

  // Reintentos
  MAX_RETRIES: 3,
  RETRY_BASE_DELAY_MS: 1000,
};

// -----------------------------------------------------------------------------
// LOGGING ESTRUCTURADO
// -----------------------------------------------------------------------------
const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const CURRENT_LOG_LEVEL =
  LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

function log(level, message, meta = {}) {
  if (LOG_LEVELS[level] >= CURRENT_LOG_LEVEL) {
    const timestamp = new Date().toISOString();
    const entry = { timestamp, level, message, ...meta };
    console.log(JSON.stringify(entry));
  }
}

function debug(msg, meta) {
  log("DEBUG", msg, meta);
}
function info(msg, meta) {
  log("INFO", msg, meta);
}
function warn(msg, meta) {
  log("WARN", msg, meta);
}
function error(msg, meta) {
  log("ERROR", msg, meta);
}

// -----------------------------------------------------------------------------
// UTILIDADES
// -----------------------------------------------------------------------------
function calculateSHA256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function getFileStats(filePath) {
  return new Promise((resolve, reject) => {
    fs.stat(filePath, (err, stats) => {
      if (err) reject(err);
      else resolve(stats);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------------
// PARSER DE METADATOS DESDE NOMBRE DE ARCHIVO / DIRECTORIO
// -----------------------------------------------------------------------------
/**
 * Extrae metadatos técnicos del path del archivo.
 * Convención esperada: [UBICACION]_[DIAGNOSTICO]_[FASE].[ext]
 * Ejemplo: "fachada_norte_grieta_horizontal_fase_1.jpg"
 * Directorio padre puede contener: "fachada_norte/", "cubierta/", "sotano/"
 */
function parseMetadataFromPath(filePath, baseDir) {
  const relativePath = path.relative(baseDir, filePath);
  const dirName = path.dirname(relativePath);
  const fileName = path.basename(filePath, path.extname(filePath));

  // Normalizar separadores
  const parts = fileName.split(/[_-]+/).filter(Boolean);

  // Heurísticas para extraer campos
  const ubicacion = inferUbicacion(dirName, parts);
  const diagnostico = inferDiagnostico(parts);
  const faseObra = inferFaseObra(parts);

  return {
    ubicacion,
    diagnostico_tecnico: diagnostico,
    fase_obra: faseObra,
    archivo_original: path.basename(filePath),
    ruta_relativa: relativePath,
  };
}

function inferUbicacion(dirName, parts) {
  // Prioridad 1: Directorio padre conocido
  const ubicacionesConocidas = [
    "fachada",
    "cubierta",
    "sotano",
    "sótano",
    "escalera",
    "ascensor",
    "vestibulo",
    "vestíbulo",
    "pasillo",
    "habitacion",
    "habitación",
    "bano",
    "baño",
    "cocina",
    "comedor",
    "sala",
    "balcon",
    "balcón",
    "techo",
    "muro",
    "columna",
    "viga",
    "losas",
    "cimiento",
    "cimentacion",
    "norte",
    "sur",
    "este",
    "oeste",
    "frontal",
    "posterior",
    "lateral",
  ];

  const dirLower = dirName.toLowerCase();
  for (const u of ubicacionesConocidas) {
    if (dirLower.includes(u)) {
      return capitalizeWords(u.replace(/_/g, " "));
    }
  }

  // Prioridad 2: Partes del nombre
  for (const part of parts) {
    if (ubicacionesConocidas.includes(part.toLowerCase())) {
      return capitalizeWords(part);
    }
  }

  return "Ubicación no especificada";
}

function inferDiagnostico(parts) {
  const diagnosticos = [
    "grieta",
    "fisura",
    "humedad",
    "filtracion",
    "filtración",
    "desprendimiento",
    "corrosion",
    "corrosión",
    "oxidacion",
    "oxidación",
    "alabeo",
    "hundimiento",
    "asentamiento",
    "falla",
    "deterioro",
    "mancha",
    "eflorescencia",
    "moho",
    "hongo",
    "placa",
    "revoque",
    "pintura",
    "revestimiento",
    "impermeabilizacion",
    "impermeabilización",
    "estructura",
    "armadura",
    "acero",
    "hormigon",
    "hormigón",
    "concreto",
  ];

  const diagnosticosEncontrados = parts.filter((p) =>
    diagnosticos.some((d) => p.toLowerCase().includes(d)),
  );

  if (diagnosticosEncontrados.length > 0) {
    return capitalizeWords(diagnosticosEncontrados.join(" "));
  }

  return "Pendiente de diagnóstico técnico";
}

function inferFaseObra(parts) {
  const fases = [
    "fase 1",
    "fase 2",
    "fase 3",
    "fase 4",
    "fase 5",
    "fase i",
    "fase ii",
    "fase iii",
    "fase iv",
    "fase v",
    "pendiente",
    "en progreso",
    "en_progreso",
    "completado",
    "finalizado",
    "planificacion",
    "planificación",
    "ejecucion",
    "ejecución",
    "cierre",
  ];

  const joined = parts.join(" ").toLowerCase();
  for (const fase of fases) {
    if (joined.includes(fase)) {
      return capitalizeWords(fase.replace(/_/g, " "));
    }
  }

  return "Fase pendiente";
}

function capitalizeWords(str) {
  return str
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// -----------------------------------------------------------------------------
// CLIENTE HTTP PARA GAS WEB APP
// -----------------------------------------------------------------------------
class GASClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async uploadFile(filePath, metadata, folderId, retries = CONFIG.MAX_RETRIES) {
    const stats = await getFileStats(filePath);

    if (stats.size > CONFIG.MAX_FILE_SIZE) {
      throw new Error(
        `Archivo excede tamaño máximo (${CONFIG.MAX_FILE_SIZE} bytes): ${stats.size}`,
      );
    }

    const sha256 = await calculateSHA256(filePath);
    const fileName = path.basename(filePath);
    const mimeType = this.getMimeType(fileName);

    // Preparar FormData para multipart upload
    const formData = new FormData();
    const fileStream = createReadStream(filePath, {
      highWaterMark: CONFIG.STREAM_CHUNK_SIZE,
    });
    formData.append("file", fileStream, fileName);
    formData.append("folderId", folderId);
    formData.append(
      "metadata",
      JSON.stringify({
        ...metadata,
        sha256,
        size: stats.size,
        mimeType,
        uploadedAt: new Date().toISOString(),
      }),
    );

    const url = `${this.baseUrl}?action=upload`;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        debug("Subiendo archivo", { file: fileName, attempt, folderId });

        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          CONFIG.UPLOAD_TIMEOUT_MS,
        );

        const response = await fetch(url, {
          method: "POST",
          body: formData,
          signal: controller.signal,
          headers: {
            "X-Client": "enka-bulk-upload/1.0",
            "X-SHA256": sha256,
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text().catch(() => "Sin respuesta");
          throw new Error(`HTTP ${response.status}: ${errText}`);
        }

        const result = await response.json();

        if (!result.success) {
          throw new Error(`GAS Error: ${result.error || "Error desconocido"}`);
        }

        info("Archivo subido exitosamente", {
          file: fileName,
          fileId: result.fileId,
          sha256: sha256.slice(0, 16) + "...",
        });

        return {
          success: true,
          fileId: result.fileId,
          name: fileName,
          thumbnailLink: result.thumbnailLink || "",
          sha256,
          metadata,
        };
      } catch (err) {
        const isLastAttempt = attempt === retries;
        const delay = CONFIG.RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);

        warn("Error subiendo archivo, reintentando", {
          file: fileName,
          attempt,
          maxRetries: retries,
          error: err.message,
          nextRetryInMs: isLastAttempt ? 0 : delay,
        });

        if (isLastAttempt) {
          throw err;
        }

        await sleep(delay);
      }
    }
  }

  getMimeType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".heic": "image/heic",
      ".tiff": "image/tiff",
      ".tif": "image/tiff",
      ".bmp": "image/bmp",
    };
    return mimeTypes[ext] || "application/octet-stream";
  }

  async healthCheck() {
    try {
      const response = await fetch(`${this.baseUrl}?action=health`, {
        method: "GET",
        signal: AbortSignal.timeout(CONFIG.REQUEST_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// -----------------------------------------------------------------------------
// POOL DE CONCURRENCIA
// -----------------------------------------------------------------------------
class ConcurrencyPool {
  constructor(maxConcurrency) {
    this.maxConcurrency = maxConcurrency;
    this.running = 0;
    this.queue = [];
  }

  async enqueue(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.process();
    });
  }

  async process() {
    while (this.running < this.maxConcurrency && this.queue.length > 0) {
      const { task, resolve, reject } = this.queue.shift();
      this.running++;

      try {
        const result = await task();
        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        this.running--;
        this.process();
      }
    }
  }
}

// -----------------------------------------------------------------------------
// PIPELINE PRINCIPAL
// -----------------------------------------------------------------------------
async function runBulkUpload(options) {
  const {
    sourceDir,
    folderId = CONFIG.DEFAULT_FOLDER_ID,
    concurrency = CONFIG.DEFAULT_CONCURRENCY,
    recursive = true,
    dryRun = false,
  } = options;

  info("Iniciando ingesta masiva SSoT", {
    sourceDir,
    folderId,
    concurrency,
    recursive,
    dryRun,
  });

  // Validar directorio origen
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Directorio origen no existe: ${sourceDir}`);
  }

  // Validar GAS URL
  if (!CONFIG.GAS_WEB_APP_URL && !dryRun) {
    throw new Error(
      "GAS_WEB_APP_URL no configurado. Definir variable de entorno o pasar --gas-url",
    );
  }

  // Descubrir archivos de imagen
  const imageFiles = discoverImageFiles(sourceDir, recursive);
  info(`Archivos de imagen descubiertos: ${imageFiles.length}`);

  if (imageFiles.length === 0) {
    warn("No se encontraron archivos de imagen para procesar");
    return { uploaded: 0, failed: 0, results: [] };
  }

  // Dry run: solo mostrar qué se haría
  if (dryRun) {
    info("DRY RUN - Archivos que se procesarían:");
    for (const file of imageFiles) {
      const meta = parseMetadataFromPath(file, sourceDir);
      console.log(
        `  - ${meta.ruta_relativa} | ${meta.ubicacion} | ${meta.diagnostico_tecnico} | ${meta.fase_obra}`,
      );
    }
    return { uploaded: 0, failed: 0, results: [], dryRun: true };
  }

  // Health check GAS
  const client = new GASClient(CONFIG.GAS_WEB_APP_URL);
  const healthy = await client.healthCheck();
  if (healthy) {
    info("GAS Web App health check: OK");
  } else {
    warn("Health check GAS falló, continuando de todas formas...");
  }

  // Procesar con pool de concurrencia
  const pool = new ConcurrencyPool(concurrency);
  const results = [];
  let uploaded = 0;
  let failed = 0;

  const tasks = imageFiles.map((filePath) => async () => {
    try {
      const metadata = parseMetadataFromPath(filePath, sourceDir);
      debug("Procesando archivo", { file: path.basename(filePath), metadata });

      const result = await client.uploadFile(filePath, metadata, folderId);
      results.push({ file: filePath, ...result, status: "success" });
      uploaded++;
    } catch (err) {
      error("Fallo subiendo archivo", { file: filePath, error: err.message });
      results.push({ file: filePath, error: err.message, status: "failed" });
      failed++;
    }
  });

  // Ejecutar todas las tareas
  await Promise.all(tasks.map((t) => pool.enqueue(t)));

  // Resumen final
  info("Ingesta masiva completada", {
    uploaded,
    failed,
    total: imageFiles.length,
  });

  return { uploaded, failed, results, total: imageFiles.length };
}

function discoverImageFiles(dir, recursive) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (recursive) {
        files.push(...discoverImageFiles(fullPath, true));
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (CONFIG.IMAGE_EXTENSIONS.includes(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    sourceDir: "",
    folderId: CONFIG.DEFAULT_FOLDER_ID,
    concurrency: CONFIG.DEFAULT_CONCURRENCY,
    recursive: true,
    dryRun: false,
    gasUrl: CONFIG.GAS_WEB_APP_URL,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--source":
      case "-s":
        options.sourceDir = next;
        i++;
        break;
      case "--folder-id":
      case "-f":
        options.folderId = next;
        i++;
        break;
      case "--concurrency":
      case "-c":
        options.concurrency = parseInt(next, 10);
        i++;
        break;
      case "--no-recursive":
        options.recursive = false;
        break;
      case "--dry-run":
      case "-d":
        options.dryRun = true;
        break;
      case "--gas-url":
        options.gasUrl = next;
        i++;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        if (!options.sourceDir && !arg.startsWith("-")) {
          options.sourceDir = arg;
        }
    }
  }

  if (options.gasUrl) {
    CONFIG.GAS_WEB_APP_URL = options.gasUrl;
  }

  return options;
}

function printHelp() {
  console.log(`
FASE 36 - Bulk Upload SSoT
==========================

Uso:
  node scripts/bulk_upload_ssot.js [opciones] <directorio_origen>

Opciones:
  -s, --source <dir>        Directorio origen con imágenes (requerido)
  -f, --folder-id <id>      ID carpeta Drive destino (default: ${CONFIG.DEFAULT_FOLDER_ID})
  -c, --concurrency <n>     Concurrencia máxima (default: ${CONFIG.DEFAULT_CONCURRENCY})
      --no-recursive        No procesar subdirectorios
  -d, --dry-run             Solo listar archivos sin subir
      --gas-url <url>       URL GAS Web App (override env GAS_WEB_APP_URL)
  -h, --help                Mostrar esta ayuda

Variables de entorno:
  GAS_WEB_APP_URL           URL del Web App GAS desplegado
  LOG_LEVEL                 DEBUG|INFO|WARN|ERROR (default: INFO)
  GCP_PROJECT               ID proyecto GCP

Ejemplos:
  node scripts/bulk_upload_ssot.js --source ./evidencia/atlas
  node scripts/bulk_upload_ssot.js -s ./evidencia -f 1abc123 -c 4
  node scripts/bulk_upload_ssot.js -s ./fotos --dry-run
`);
}

// -----------------------------------------------------------------------------
// MAIN
// -----------------------------------------------------------------------------
async function main() {
  try {
    const options = parseArgs();

    if (!options.sourceDir) {
      error(
        "Directorio origen requerido. Usa --source o pasa como argumento posicional.",
      );
      printHelp();
      process.exit(1);
    }

    const result = await runBulkUpload(options);

    // Exit code basado en resultado
    if (result.failed > 0 && result.uploaded === 0) {
      process.exit(1);
    } else if (result.failed > 0) {
      process.exit(2); // Parcial
    }
  } catch (err) {
    error("Error fatal en bulk upload", {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  }
}

main();
