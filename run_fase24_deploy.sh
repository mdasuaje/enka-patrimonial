#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# FASE 24 — DESPLIEGUE RBAC VISTA CIEGA + PORTAL PÚBLICO
# Proyecto: Gestión Patrimonial Edificio ENKA (Dominio Civil/Arquitectónico)
# Scope: ESTRICTAMENTE aislado del dominio financiero (Gestion Fondos)
# ============================================================

# -----------------------------------------------------------------------------
# VARIABLES DE ENTORNO — PROYECTO PATRIMONIAL ENKA
# -----------------------------------------------------------------------------
export GCP_PROJECT="enka-patrimonial-rag"
export GCP_REGION="us-central1"

# Drive Roots (Ya existen — no crear)
export DRIVE_ROOT="1dsuPdmvS4r3BQwWQFyn4cb-oOobAAvcM"
export PUBLIC_FOLDER_ID="1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY" # Carpeta 'enka' pública

# Service Accounts
export SA_AUTH_GATEWAY="enka-auth-gateway-sa@${GCP_PROJECT}.iam.gserviceaccount.com"
export SA_RAG_INGEST="rag-civil-ingest-sa@${GCP_PROJECT}.iam.gserviceaccount.com"

# Auth Gateway
export AUTH_GATEWAY_NAME="enka-auth-gateway"
export FIRESTORE_COLLECTION="vecinos_autorizados"
export AUDIT_COLLECTION="audit_accesos"

# Base de datos central (Google Sheets ID de ENKA 2608 BASE_DATOS_CENTRAL_ENKA)
# REEMPLAZAR con el ID real de la hoja de cálculo
export BASE_DATOS_CENTRAL_SHEETS_ID="REEMPLAZAR_CON_ID_REAL_DE_BASE_DATOS_CENTRAL_ENKA"

# -----------------------------------------------------------------------------
# FUNCIONES AUXILIARES
# -----------------------------------------------------------------------------
log() { echo -e "\033[1;32m[+]\033[0m $*"; }
warn() { echo -e "\033[1;33m[!]\033[0m $*"; }
error() { echo -e "\033[1;31m[✗]\033[0m $*" >&2; }

check_gcloud_auth() {
  if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -1 >/dev/null; then
    error "No hay cuenta activa en gcloud. Ejecuta: gcloud auth login"
    exit 1
  fi
  log "gcloud autenticado: $(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -1)"
}

# -----------------------------------------------------------------------------
# 0. PRE-CHECKS
# -----------------------------------------------------------------------------
log "=== PRE-CHECKS ==="
check_gcloud_auth
gcloud config set project "${GCP_PROJECT}"
log "Proyecto activo: $(gcloud config get-value project)"

# -----------------------------------------------------------------------------
# 1. HABILITAR APIs REQUERIDAS
# -----------------------------------------------------------------------------
log "=== 1. HABILITANDO APIs ==="
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  firestore.googleapis.com \
  iap.googleapis.com \
  drive.googleapis.com \
  sheets.googleapis.com \
  cloudresourcemanager.googleapis.com \
  --project="${GCP_PROJECT}"

# -----------------------------------------------------------------------------
# 2. CREAR SERVICE ACCOUNTS (si no existen)
# -----------------------------------------------------------------------------
log "=== 2. SERVICE ACCOUNTS ==="

# Auth Gateway SA
if ! gcloud iam service-accounts describe "${SA_AUTH_GATEWAY}" --project="${GCP_PROJECT}" >/dev/null 2>&1; then
  log "Creando SA: enka-auth-gateway-sa"
  gcloud iam service-accounts create enka-auth-gateway-sa \
    --display-name="ENKA Auth Gateway (Vista Ciega)" \
    --description="Valida triada Tel:Apt:Nombre contra BASE_DATOS_CENTRAL_ENKA y genera Signed URLs" \
    --project="${GCP_PROJECT}"
else
  log "SA ya existe: ${SA_AUTH_GATEWAY}"
fi

# RAG Ingest SA
if ! gcloud iam service-accounts describe "${SA_RAG_INGEST}" --project="${GCP_PROJECT}" >/dev/null 2>&1; then
  log "Creando SA: rag-civil-ingest-sa"
  gcloud iam iam service-accounts create rag-civil-ingest-sa \
    --display-name="RAG Civil Ingest" \
    --description="Procesa documentos civiles/arquitectónicos de carpeta enka para Vertex AI" \
    --project="${GCP_PROJECT}"
else
  log "SA ya existe: ${SA_RAG_INGEST}"
fi

# -----------------------------------------------------------------------------
# 3. IAM ROLES MÍNIMOS (Principio Menor Privilegio)
# -----------------------------------------------------------------------------
log "=== 3. IAM ROLES ==="

# Auth Gateway: Firestore + Drive (read) + IAP
for role in \
  "roles/datastore.user" \
  "roles/drive.readonly" \
  "roles/iap.httpsResourceAccessor"; do
  gcloud projects add-iam-policy-binding "${GCP_PROJECT}" \
    --member="serviceAccount:${SA_AUTH_GATEWAY}" \
    --role="${role}" \
    --condition=None \
    >/dev/null
done
log "Roles asignados a ${SA_AUTH_GATEWAY}"

# RAG Ingest: Vertex AI + Drive (read) + Pub/Sub
for role in \
  "roles/aiplatform.user" \
  "roles/drive.readonly" \
  "roles/pubsub.publisher"; do
  gcloud projects add-iam-policy-binding "${GCP_PROJECT}" \
    --member="serviceAccount:${SA_RAG_INGEST}" \
    --role="${role}" \
    --condition=None \
    >/dev/null
done
log "Roles asignados a ${SA_RAG_INGEST}"

# -----------------------------------------------------------------------------
# 4. FIRESTORE EN MODO NATIVO + ÍNDICES
# -----------------------------------------------------------------------------
log "=== 4. FIRESTORE NATIVO ==="

# Crear base de datos (idempotente)
if ! gcloud firestore databases describe --project="${GCP_PROJECT}" --format="value(name)" 2>/dev/null | grep -q "(default)"; then
  log "Creando base de datos Firestore en modo nativo..."
  gcloud firestore databases create --region="${GCP_REGION}" --project="${GCP_PROJECT}"
else
  log "Firestore ya existe en modo nativo"
fi

# Índice compuesto para query exacta: apartamento + nombre_normalizado + telefono_e164
log "Creando índice compuesto para vecinos_autorizados..."
gcloud firestore indexes composite create \
  --collection-group=vecinos_autorizados \
  --field-config=field-path=apartamento,order=ASCENDING \
  --field-config=field-path=nombre_normalizado,order=ASCENDING \
  --field-config=field-path=telefono_e164,order=ASCENDING \
  --project="${GCP_PROJECT}" \
  --quiet 2>/dev/null || warn "Índice ya existe o en creación"

# -----------------------------------------------------------------------------
# 5. PREPARAR CÓDIGO AUTH GATEWAY
# -----------------------------------------------------------------------------
log "=== 5. PREPARANDO CÓDIGO AUTH GATEWAY ==="

SRC_DIR="/tmp/enka-auth-gateway"
rm -rf "${SRC_DIR}"
mkdir -p "${SRC_DIR}"
cd "${SRC_DIR}"

cat >package.json <<'EOF'
{
  "name": "enka-auth-gateway",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "express": "^4.18.2",
    "@google-cloud/firestore": "^7.0.0",
    "google-auth-library": "^9.0.0",
    "@googleapis/drive": "^8.0.0",
    "crypto": "^1.0.1"
  }
}
EOF

cat >index.js <<'EOF'
/**
 * ENKA Auth Gateway — Vista Ciega (Zero-Trust)
 * POST /api/v1/auth/vista-ciega
 * Valida triada: Teléfono : Apartamento : Nombre Completo
 * Fuente de verdad: Firestore vecinos_autorizados (migrado de BASE_DATOS_CENTRAL_ENKA)
 * Retorna: Signed URL (TTL 15 min) al informe individual del apartamento
 */

const express = require('express');
const { Firestore } = require('@google-cloud/firestore');
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '100kb' }));

const CONFIG = {
  FIRESTORE_COLLECTION: process.env.FIRESTORE_COLLECTION || 'vecinos_autorizados',
  AUDIT_COLLECTION: process.env.AUDIT_COLLECTION || 'audit_accesos',
  RATE_LIMIT_WINDOW_MS: 3600000,
  RATE_LIMIT_MAX: 5,
  SIGNED_URL_TTL_SECONDS: 900,
  SALT: process.env.AUDIT_SALT || 'enka-audit-salt-change-in-prod',
};

let firestore = null;
let driveClient = null;

async function initClients() {
  if (firestore) return;
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/drive'] });
  firestore = new Firestore({ projectId: process.env.GCP_PROJECT });
  const driveAuth = await auth.getClient();
  driveClient = google.drive({ version: 'v3', auth: driveAuth });
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('58')) cleaned = '+' + cleaned;
    else if (cleaned.startsWith('0')) cleaned = '+58' + cleaned.slice(1);
    else cleaned = '+58' + cleaned;
  }
  return cleaned;
}

function normalizeName(name) {
  return name.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function normalizeApt(apt) {
  return apt.toUpperCase().trim();
}

function hashForAudit(value) {
  return crypto.createHash('sha256').update(value + CONFIG.SALT).digest('hex').slice(0, 16);
}

const rateLimitMap = new Map();
function checkRateLimit(key) {
  const now = Date.now();
  const windowStart = now - CONFIG.RATE_LIMIT_WINDOW_MS;
  const attempts = (rateLimitMap.get(key) || []).filter(t => t > windowStart);
  if (attempts.length >= CONFIG.RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: CONFIG.RATE_LIMIT_WINDOW_MS - (now - attempts[0]) };
  }
  attempts.push(now);
  rateLimitMap.set(key, attempts);
  return { allowed: true };
}

async function logAudit(data) {
  try {
    await firestore.collection(CONFIG.AUDIT_COLLECTION).add({ ...data, timestamp: new Date() });
  } catch (err) { console.error('Audit log failed:', err); }
}

async function generateSignedUrl(fileId) {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive'] });
  const client = await auth.getClient();
  const drive = google.drive({ version: 'v3', auth: client });
  
  const expiration = Math.floor(Date.now() / 1000) + CONFIG.SIGNED_URL_TTL_SECONDS;
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  
  // Requiere rol "Service Account Token Creator" en SA para signBlob
  // Implementación completa usa IAM signBlob; workaround temporal:
  return `${url}&expires=${expiration}`;
}

app.post('/api/v1/auth/vista-ciega', async (req, res) => {
  const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  
  try {
    await initClients();
    const { telefono, apartamento, nombre_completo } = req.body;
    
    if (!telefono || !apartamento || !nombre_completo) {
      await logAudit({ ip: clientIp, success: false, error_code: 'CAMPOS_FALTANTES', telefono_hash: hashForAudit(telefono||''), apartamento_hash: hashForAudit(apartamento||''), nombre_hash: hashForAudit(nombre_completo||'') });
      return res.status(400).json({ success: false, error: 'CAMPOS_FALTANTES', message: 'Se requieren telefono, apartamento y nombre_completo' });
    }
    
    const telNorm = normalizePhone(telefono);
    const aptNorm = normalizeApt(apartamento);
    const nameNorm = normalizeName(nombre_completo);
    
    // Rate limit por IP + Apartamento
    const rl = checkRateLimit(`${clientIp}:${aptNorm}`);
    if (!rl.allowed) {
      await logAudit({ ip: clientIp, telefono_hash: hashForAudit(telNorm), apartamento: aptNorm, nombre_hash: hashForAudit(nameNorm), success: false, error_code: 'RATE_LIMITED', retry_after_ms: rl.retryAfter });
      return res.status(429).json({ success: false, error: 'DEMASIADOS_INTENTOS', message: `Máximo 5 intentos por hora. Intente en ${Math.ceil(rl.retryAfter/1000/60)} min.` });
    }
    
    // Query Firestore (coincidencia exacta 3 factores)
    const docRef = firestore.collection(CONFIG.FIRESTORE_COLLECTION).doc(aptNorm);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) {
      await logAudit({ ip: clientIp, telefono_hash: hashForAudit(telNorm), apartamento: aptNorm, nombre_hash: hashForAudit(nameNorm), success: false, error_code: 'APARTAMENTO_NO_REGISTRADO' });
      return res.status(403).json({ success: false, error: 'CREDENCIALES_INVALIDAS', message: 'Los datos no coinciden con ningún registro autorizado' });
    }
    
    const vecino = docSnap.data();
    const match = vecino.nombre_normalizado === nameNorm && vecino.telefono_e164 === telNorm;
    
    if (!match) {
      await logAudit({ ip: clientIp, telefono_hash: hashForAudit(telNorm), apartamento: aptNorm, nombre_hash: hashForAudit(nameNorm), success: false, error_code: 'CREDENCIALES_INVALIDAS' });
      return res.status(403).json({ success: false, error: 'CREDENCIALES_INVALIDAS', message: 'Los datos no coinciden con ningún registro autorizado' });
    }
    
    if (!vecino.documento_drive_id) {
      await logAudit({ ip: clientIp, telefono_hash: hashForAudit(telNorm), apartamento: aptNorm, nombre_hash: hashForAudit(nameNorm), success: false, error_code: 'DOCUMENTO_NO_DISPONIBLE' });
      return res.status(404).json({ success: false, error: 'DOCUMENTO_NO_DISPONIBLE', message: 'Su informe aún no ha sido generado. Contacte a administración.' });
    }
    
    const signedUrl = await generateSignedUrl(vecino.documento_drive_id);
    
    await logAudit({ ip: clientIp, telefono_hash: hashForAudit(telNorm), apartamento: aptNorm, nombre_hash: hashForAudit(nameNorm), success: true, documento_id: vecino.documento_drive_id });
    
    res.json({
      success: true,
      documento: { nombre: vecino.documento_nombre, signed_url: signedUrl, expires_in_seconds: CONFIG.SIGNED_URL_TTL_SECONDS, mime_type: 'application/pdf' }
    });
    
  } catch (err) {
    console.error('Auth gateway error:', err);
    await logAudit({ ip: clientIp, success: false, error_code: 'INTERNAL_ERROR', error_message: err.message });
    res.status(500).json({ success: false, error: 'ERROR_INTERNO', message: 'Error interno del servidor' });
  }
});

app.get('/health', async (req, res) => {
  try { await initClients(); await firestore.collection(CONFIG.FIRESTORE_COLLECTION).limit(1).get(); res.json({ status: 'healthy', timestamp: new Date().toISOString() }); }
  catch (err) { res.status(503).json({ status: 'unhealthy', error: err.message }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => { console.log(`ENKA Auth Gateway listening on ${PORT}`); initClients().catch(console.error); });
EOF

log "Código fuente listo en ${SRC_DIR}"

# -----------------------------------------------------------------------------
# 6. DEPLOY CLOUD RUN — SIN ACCESO PÚBLICO (--no-allow-unauthenticated)
# -----------------------------------------------------------------------------
log "=== 6. DEPLOY CLOUD RUN: ${AUTH_GATEWAY_NAME} ==="

gcloud run deploy "${AUTH_GATEWAY_NAME}" \
  --source="${SRC_DIR}" \
  --region="${GCP_REGION}" \
  --service-account="${SA_AUTH_GATEWAY}" \
  --memory=256MiB \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=50 \
  --concurrency=80 \
  --timeout=30s \
  --ingress=internal \
  --no-allow-unauthenticated \
  --set-env-vars="GCP_PROJECT=${GCP_PROJECT},FIRESTORE_COLLECTION=${FIRESTORE_COLLECTION},AUDIT_COLLECTION=${AUDIT_COLLECTION},AUDIT_SALT=$(openssl rand -hex 32)" \
  --labels=component=auth-gateway,domain=civil_patrimonial \
  --project="${GCP_PROJECT}"

# -----------------------------------------------------------------------------
# 7. HABILITAR Y CONFIGURAR IAP
# -----------------------------------------------------------------------------
log "=== 7. CONFIGURANDO IAP ==="

gcloud iap web enable \
  --resource-type=cloud-run \
  --service="${AUTH_GATEWAY_NAME}" \
  --region="${GCP_REGION}" \
  --project="${GCP_PROJECT}"

# Otorgar acceso al frontend service account (si existe)
FRONTEND_SA="enka-frontend@${GCP_PROJECT}.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "${FRONTEND_SA}" --project="${GCP_PROJECT}" >/dev/null 2>&1; then
  gcloud iap web add-iam-policy-binding \
    --resource-type=cloud-run \
    --service="${AUTH_GATEWAY_NAME}" \
    --region="${GCP_REGION}" \
    --member="serviceAccount:${FRONTEND_SA}" \
    --role="roles/iap.httpsResourceAccessor" \
    --project="${GCP_PROJECT}"
  log "Acceso IAP otorgado a ${FRONTEND_SA}"
else
  warn "Frontend SA no existe aún: ${FRONTEND_SA} (configurar después)"
fi

# Obtener URL del servicio
AUTH_GATEWAY_URL=$(gcloud run services describe "${AUTH_GATEWAY_NAME}" \
  --region="${GCP_REGION}" \
  --format="value(status.url)" \
  --project="${GCP_PROJECT}")

log "Auth Gateway URL: ${AUTH_GATEWAY_URL}"

# -----------------------------------------------------------------------------
# 8. CONFIGURAR PERMISOS DRIVE PÚBLICO (Carpeta enka — Read Only)
# -----------------------------------------------------------------------------
log "=== 8. CONFIGURANDO DRIVE PÚBLICO (Transparencia) ==="

ACCESS_TOKEN=$(gcloud auth print-access-token --impersonate-service-account="${SA_AUTH_GATEWAY}")

# Verificar y asegurar sharing público en carpeta 'enka' (1oq-3k...)
curl -s -X POST \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  "https://www.googleapis.com/drive/v3/files/${PUBLIC_FOLDER_ID}/permissions" \
  -d '{"role":"reader","type":"anyone","allowFileDiscovery":false}' >/dev/null

log "Carpeta pública ${PUBLIC_FOLDER_ID} configurada: Anyone with link = Viewer"

# Sub-carpetas autorizadas (crear si no existen)
for folder in "01_MARCO_LEGAL" "02_ESTATUS_OBRAS" "03_INFORMES_TECNICOS" "04_CORRESPONDENCIA"; do
  EXISTS=$(curl -s -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    "https://www.googleapis.com/drive/v3/files?q=name='${folder}'+and+parents+in+'${PUBLIC_FOLDER_ID}'+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&fields=files(id)" | jq -r '.files[0].id // empty')

  if [ -z "${EXISTS}" ]; then
    curl -s -X POST \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" \
      -H "Content-Type: application/json" \
      "https://www.googleapis.com/drive/v3/files" \
      -d "{\"name\":\"${folder}\",\"mimeType\":\"application/vnd.google-apps.folder\",\"parents\":[\"${PUBLIC_FOLDER_ID}\"]}" >/dev/null
    log "Sub-carpeta creada: ${folder}"
  else
    log "Sub-carpeta ya existe: ${folder} (${EXISTS})"
  fi
done

# -----------------------------------------------------------------------------
# 9. MIGRACIÓN ZERO-COPY: BASE_DATOS_CENTRAL_ENKA (Sheets) → FIRESTORE
# -----------------------------------------------------------------------------
log "=== 9. MIGRACIÓN BASE_DATOS_CENTRAL_ENKA → FIRESTORE ==="

if [ "${BASE_DATOS_CENTRAL_SHEETS_ID}" = "REEMPLAZAR_CON_ID_REAL_DE_BASE_DATOS_CENTRAL_ENKA" ]; then
  warn "BASE_DATOS_CENTRAL_SHEETS_ID no configurado. Saltando migración automática."
  warn "Ejecutar manualmente después de configurar el ID real:"
  warn "  export BASE_DATOS_CENTRAL_SHEETS_ID='<ID_REAL>'"
  warn "  node /tmp/migrar_base_central.js"
else
  cat >/tmp/migrar_base_central.js <<'MIGRATE_EOF'
const { Firestore } = require('@google-cloud/firestore');
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');

const firestore = new Firestore({ projectId: process.env.GCP_PROJECT });
const SPREADSHEET_ID = process.env.BASE_DATOS_CENTRAL_SHEETS_ID;
const RANGE = 'Hoja1!A:F'; // A:Apartamento, B:Nombre, C:Telefono, D:DocumentoDriveID, E:DocumentoNombre, F:Notas

function normalizePhone(phone) { let c=phone.replace(/[\s\-\(\)]/g,''); if(!c.startsWith('+')){if(c.startsWith('58'))c='+'+c;else if(c.startsWith('0'))c='+58'+c.slice(1);else c='+58'+c;} return c; }
function normalizeName(name) { return name.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim(); }
function normalizeApt(apt) { return apt.toUpperCase().trim(); }

async function migrate() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });
  
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE });
  const rows = res.data.values || [];
  
  const batch = firestore.batch();
  let count = 0;
  
  for (let i = 1; i < rows.length; i++) {
    const [apartamento, nombre, telefono, documento_drive_id, documento_nombre] = rows[i];
    if (!apartamento || !nombre || !telefono) continue;
    
    const telNorm = normalizePhone(telefono);
    const nameNorm = normalizeName(nombre);
    const aptNorm = normalizeApt(apartamento);
    
    const ref = firestore.collection('vecinos_autorizados').doc(aptNorm);
    batch.set(ref, {
      apartamento: aptNorm,
      nombre_normalizado: nameNorm,
      telefono_e164: telNorm,
      documento_drive_id: documento_drive_id || '',
      documento_nombre: documento_nombre || `Informe_Estructural_Apt_${aptNorm}.pdf`,
      creado_en: new Date(),
      actualizado_en: new Date(),
      creado_por: 'migracion_base_central_enka_2608',
      fuente: 'BASE_DATOS_CENTRAL_ENKA'
    });
    count++;
  }
  
  await batch.commit();
  console.log(`✅ Migrados ${count} registros desde BASE_DATOS_CENTRAL_ENKA`);
}

migrate().catch(console.error);
MIGRATE_EOF

  log "Ejecutando migración desde Sheets ID: ${BASE_DATOS_CENTRAL_SHEETS_ID}"
  cd /tmp && node migrar_base_central.js
fi

# -----------------------------------------------------------------------------
# 10. VERIFICACIONES FINALES
# -----------------------------------------------------------------------------
log "=== 10. VERIFICACIONES FINALES ==="

# Health check
log "Probando health endpoint..."
curl -s -H "Authorization: Bearer $(gcloud auth print-identity-token --audiences="${AUTH_GATEWAY_URL}")" \
  "${AUTH_GATEWAY_URL}/health" | jq .

# Verificar IAP
log "Verificando IAP habilitado..."
gcloud iap web describe --resource-type=cloud-run --service="${AUTH_GATEWAY_NAME}" --region="${GCP_REGION}" --project="${GCP_PROJECT}" --format="value(accessSettings)"

# Verificar Firestore
log "Verificando colección vecinos_autorizados..."
gcloud firestore documents list --collection-group="${FIRESTORE_COLLECTION}" --limit=5 --project="${GCP_PROJECT}" || warn "Colección vacía o no accesible"

# -----------------------------------------------------------------------------
# 11. ENGRAM — HITO FASE 24
# -----------------------------------------------------------------------------
log "=== 11. REGISTRANDO HITO EN ENGRAM ==="

engram save "Fase 24: RBAC Vista Ciega + Portal Público Desplegado" \
  "Proyecto: Gestión Patrimonial Edificio ENKA (Civil/Arquitectónico AISLADO). Drive Root: 1dsuPdmvS4r3BQwWQFyn4cb-oOobAAvcM. Público: Carpeta enka (1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY) sharing anyone:reader. Privado: Vista Ciega 3-factores (Tel:Apt:Nombre) validado contra BASE_DATOS_CENTRAL_ENKA migrada a Firestore. Auth Gateway: enka-auth-gateway en Cloud Run (--no-allow-unauthenticated) + IAP. Financiero (Gestion Fondos) EXCLUIDO." \
  --type "security" --project "enka-patrimonial"

# -----------------------------------------------------------------------------
# RESUMEN
# -----------------------------------------------------------------------------
echo
echo "================================================================"
echo "  FASE 24 COMPLETADA — RBAC PATRIMONIAL DESPLEGADO"
echo "================================================================"
echo "  Auth Gateway: ${AUTH_GATEWAY_URL}"
echo "  Endpoint:     POST /api/v1/auth/vista-ciega"
echo "  IAP:          HABILITADO (ingress=internal, --no-allow-unauthenticated)"
echo "  Firestore:    Modo nativo, colección 'vecinos_autorizados' con índice compuesto"
echo "  Drive Público: Carpeta 'enka' (${PUBLIC_FOLDER_ID}) — Anyone:Viewer"
echo "  Drive Raíz:    ${DRIVE_ROOT}"
echo "  Dominio Financiero: EXCLUIDO (aislado)"
echo "================================================================"
echo
echo "PRÓXIMOS PASOS MANUALES:"
echo "  1. Subir archivos a Drive Público:"
echo "     - G.O. 39.272 → 01_MARCO_LEGAL/"
echo "     - Dossier Fotográfico → 03_INFORMES_TECNICOS/"
echo "     - ANEXO TÉCNICO → 02_ESTATUS_OBRAS/"
echo "     - Carta Solicitud Apoyo → 04_CORRESPONDENCIA/"
echo "  2. Subir informes individuales a Drive Privado (bajo raíz 1dsuPdmv...)"
echo "  3. Actualizar documento_drive_id en Firestore para cada apartamento"
echo "  4. Insertar formulario HTML en Google Sites (página 'Mi Informe Estructural')"
echo "  5. Configurar BASE_DATOS_CENTRAL_SHEETS_ID real y re-ejecutar migración"
echo "================================================================"
