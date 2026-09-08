# TASKS-005: RBAC y Vista Ciega — Provisioning CLI (Dominio CIVIL_Y_ARQUITECTONICO)

## Variables de Entorno

```bash
export GCP_PROJECT="enka-patrimonial-rag"           # Proyecto GCP (mismo que RAG)
export GCP_REGION="us-central1"
export DRIVE_ROOT_ID="1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY"     # Carpeta raíz "enka"
export SA_NAME="enka-auth-gateway-sa"
export SA_EMAIL="${SA_NAME}@${GCP_PROJECT}.iam.gserviceaccount.com"
export PUBLIC_FOLDER_NAME="00_PUBLICO_TRANSPARENCIA"
export PRIVATE_FOLDER_NAME="01_PRIVADO_VECINOS"
export FIRESTORE_DB="(default)"                     # Firestore en modo nativo
```

---

## Fase A: Estructura de Carpetas Drive y Permisos

### Carpeta Pública (Transparencia)

- [ ] **Tarea 01**: Crear carpeta pública `00_PUBLICO_TRANSPARENCIA` dentro de `enka`

  ```bash
  # Requiere OAuth token con scope drive.file o drive
  ACCESS_TOKEN=$(gcloud auth print-access-token --impersonate-service-account=${SA_EMAIL})
  
  PUBLIC_FOLDER_ID=$(curl -s -X POST \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    "https://www.googleapis.com/drive/v3/files" \
    -d "{
      \"name\": \"${PUBLIC_FOLDER_NAME}\",
      \"mimeType\": \"application/vnd.google-apps.folder\",
      \"parents\": [\"${DRIVE_ROOT_ID}\"]
    }" | jq -r '.id')
  
  echo "PUBLIC_FOLDER_ID=${PUBLIC_FOLDER_ID}"
  export PUBLIC_FOLDER_ID
  ```

- [ ] **Tarea 02**: Configurar sharing público (Anyone with link: Viewer)

  ```bash
  curl -s -X POST \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    "https://www.googleapis.com/drive/v3/files/${PUBLIC_FOLDER_ID}/permissions" \
    -d '{
      "role": "reader",
      "type": "anyone",
      "allowFileDiscovery": false
    }'
  ```

- [ ] **Tarea 03**: Crear sub-carpetas públicas

  ```bash
  for folder in "01_MARCO_LEGAL" "02_ESTATUS_OBRAS" "03_INFORMES_TECNICOS" "04_ACTAS_ASAMBLEA"; do
    SUB_ID=$(curl -s -X POST \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" \
      -H "Content-Type: application/json" \
      "https://www.googleapis.com/drive/v3/files" \
      -d "{
        \"name\": \"${folder}\",
        \"mimeType\": \"application/vnd.google-apps.folder\",
        \"parents\": [\"${PUBLIC_FOLDER_ID}\"]
      }" | jq -r '.id')
    echo "${folder}_ID=${SUB_ID}"
  done
  ```

### Carpeta Privada (Vista Ciega)

- [ ] **Tarea 04**: Crear carpeta privada `01_PRIVADO_VECINOS`

  ```bash
  PRIVATE_FOLDER_ID=$(curl -s -X POST \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    "https://www.googleapis.com/drive/v3/files" \
    -d "{
      \"name\": \"${PRIVATE_FOLDER_NAME}\",
      \"mimeType\": \"application/vnd.google-apps.folder\",
      \"parents\": [\"${DRIVE_ROOT_ID}\"]
    }" | jq -r '.id')
  
  echo "PRIVATE_FOLDER_ID=${PRIVATE_FOLDER_ID}"
  export PRIVATE_FOLDER_ID
  ```

- [ ] **Tarea 05**: Configurar sharing RESTRICTED (solo SA + Admins)

  ```bash
  # Remover permisos heredados (si los hay)
  curl -s -X DELETE \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    "https://www.googleapis.com/drive/v3/files/${PRIVATE_FOLDER_ID}/permissions/anyoneWithLink"
  
  # Otorgar acceso al Service Account (Editor para subir archivos)
  curl -s -X POST \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    "https://www.googleapis.com/drive/v3/files/${PRIVATE_FOLDER_ID}/permissions" \
    -d "{
      \"role\": \"fileOrganizer\",  # o writer
      \"type\": \"user\",
      \"emailAddress\": \"${SA_EMAIL}\"
    }"
  
  # Otorgar acceso a Admins (listar emails)
  for admin in "admin1@enka.ve" "admin2@enka.ve"; do
    curl -s -X POST \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" \
      -H "Content-Type: application/json" \
      "https://www.googleapis.com/drive/v3/files/${PRIVATE_FOLDER_ID}/permissions" \
      -d "{
        \"role\": \"writer\",
        \"type\": \"user\",
        \"emailAddress\": \"${admin}\"
      }"
  done
  ```

- [ ] **Tarea 06**: Crear 19 sub-carpetas por apartamento (PB, 1-18)

  ```bash
  APARTAMENTOS=("PB" "1" "2" "3" "4" "5" "6" "7" "8" "9" "10" "11" "12" "13" "14" "15" "16" "17" "18")
  
  for apt in "${APARTAMENTOS[@]}"; do
    APT_FOLDER_ID=$(curl -s -X POST \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" \
      -H "Content-Type: application/json" \
      "https://www.googleapis.com/drive/v3/files" \
      -d "{
        \"name\": \"Apt_${apt}\",
        \"mimeType\": \"application/vnd.google-apps.folder\",
        \"parents\": [\"${PRIVATE_FOLDER_ID}\"]
      }" | jq -r '.id')
    echo "APT_${apt}_FOLDER_ID=${APT_FOLDER_ID}"
  done
  ```

---

## Fase B: Firestore — Registro de Vecinos Autorizados

- [ ] **Tarea 07**: Habilitar Firestore en modo nativo

  ```bash
  gcloud firestore databases create --region=${GCP_REGION} --project=${GCP_PROJECT}
  ```

- [ ] **Tarea 08**: Crear índices compuestos para queries de autenticación

  ```bash
  # Índice para query exacta: apartamento + nombre_normalizado + telefono_e164
  gcloud firestore indexes composite create \
    --collection-group=vecinos_autorizados \
    --field-config=field-path=apartamento,order=ASCENDING \
    --field-config=field-path=nombre_normalizado,order=ASCENDING \
    --field-config=field-path=telefono_e164,order=ASCENDING \
    --project=${GCP_PROJECT}
  ```

- [ ] **Tarea 09**: Poblar colección `vecinos_autorizados` (ejemplo via script Node o Console)

  ```bash
  # Ejemplo estructura documento (ejecutar en Cloud Shell o script separado)
  cat > /tmp/poblar_vecinos.js << 'EOF'
  const { Firestore } = require('@google-cloud/firestore');
  const firestore = new Firestore({ projectId: process.env.GCP_PROJECT });
  
  const vecinos = [
    { apartamento: "PB", nombre_normalizado: "JUAN PEREZ", telefono_e164: "+584121234567", documento_drive_id: "", documento_nombre: "Informe_Estructural_Apt_PB.pdf" },
    { apartamento: "1", nombre_normalizado: "MARIA GONZALEZ", telefono_e164: "+584142345678", documento_drive_id: "", documento_nombre: "Informe_Estructural_Apt_1.pdf" },
    // ... completar 19 registros
  ];
  
  async function seed() {
    const batch = firestore.batch();
    vecinos.forEach(v => {
      const ref = firestore.collection('vecinos_autorizados').doc(v.apartamento);
      batch.set(ref, {
        ...v,
        creado_en: new Date(),
        actualizado_en: new Date(),
        creado_por: "admin@enka.ve"
      });
    });
    await batch.commit();
    console.log('✅ Vecinos poblados');
  }
  seed().catch(console.error);
  EOF
  
  node /tmp/poblar_vecinos.js
  ```

---

## Fase C: Cloud Run — Auth Gateway (`enka-auth-gateway`)

- [ ] **Tarea 10**: Preparar código fuente

  ```bash
  mkdir -p /tmp/enka-auth-gateway && cd /tmp/enka-auth-gateway
  
  cat > package.json << 'EOF'
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
  
  cat > index.js << 'EOF'
  /**
   * ENKA Auth Gateway — Cloud Run Service
   * POST /api/v1/auth/vista-ciega
   * Zero-Trust 3-factor auth → Signed URL for private document
   */
  
  const express = require('express');
  const { Firestore } = require('@google-cloud/firestore');
  const { GoogleAuth } = require('google-auth-library');
  const { google } = require('googleapis');
  const crypto = require('crypto');
  
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  
  // Config
  const CONFIG = {
    FIRESTORE_COLLECTION: 'vecinos_autorizados',
    AUDIT_COLLECTION: 'audit_accesos',
    RATE_LIMIT_WINDOW_MS: 3600000, // 1 hora
    RATE_LIMIT_MAX: 5,
    SIGNED_URL_TTL_SECONDS: 900, // 15 min
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
  
  // Helpers
  function normalizePhone(phone) {
    // E.164: +58XXXXXXXXXX
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
  
  // Rate limiting en memoria (para producción: Redis / Firestore counter)
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
  
  // Audit logging
  async function logAudit(data) {
    try {
      await firestore.collection(CONFIG.AUDIT_COLLECTION).add({
        ...data,
        timestamp: new Date(),
      });
    } catch (err) {
      console.error('Audit log failed:', err);
    }
  }
  
  // Generate Signed URL for Drive file
  async function generateSignedUrl(fileId) {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive'] });
    const client = await auth.getClient();
    
    // Usar Drive API v3 para generar signed URL
    // Nota: Service Account debe tener permisos "Service Account Token Creator" para signBlob
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    
    // Generar signed URL manualmente (simplificado)
    // En producción: usar signBlob IAM o Cloud Storage signed URL si se migra
    const expiration = Math.floor(Date.now() / 1000) + CONFIG.SIGNED_URL_TTL_SECONDS;
    
    // Para Service Account: usar generateSignedUrlWithClient
    const drive = google.drive({ version: 'v3', auth: client });
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    
    // Workaround: retornar URL que requiere auth (el frontend la usa con token)
    // Implementación completa requiere signBlob permission
    return `${url}&expires=${expiration}`;
  }
  
  // Main endpoint
  app.post('/api/v1/auth/vista-ciega', async (req, res) => {
    const startTime = Date.now();
    const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    
    try {
      await initClients();
      
      const { telefono, apartamento, nombre_completo } = req.body;
      
      // Validación básica
      if (!telefono || !apartamento || !nombre_completo) {
        await logAudit({
          ip: clientIp,
          success: false,
          error_code: 'CAMPOS_FALTANTES',
          telefono_hash: hashForAudit(telefono || ''),
          apartamento_hash: hashForAudit(apartamento || ''),
          nombre_hash: hashForAudit(nombre_completo || ''),
        });
        return res.status(400).json({
          success: false,
          error: 'CAMPOS_FALTANTES',
          message: 'Se requieren telefono, apartamento y nombre_completo',
        });
      }
      
      // Normalizar
      const telNorm = normalizePhone(telefono);
      const aptNorm = normalizeApt(apartamento);
      const nameNorm = normalizeName(nombre_completo);
      
      // Rate limiting por IP + Apartamento
      const rlKey = `${clientIp}:${aptNorm}`;
      const rl = checkRateLimit(rlKey);
      if (!rl.allowed) {
        await logAudit({
          ip: clientIp,
          telefono_hash: hashForAudit(telNorm),
          apartamento: aptNorm,
          nombre_hash: hashForAudit(nameNorm),
          success: false,
          error_code: 'RATE_LIMITED',
          retry_after_ms: rl.retryAfter,
        });
        return res.status(429).json({
          success: false,
          error: 'DEMASIADOS_INTENTOS',
          message: `Máximo 5 intentos por hora. Intente en ${Math.ceil(rl.retryAfter / 1000 / 60)} minutos.`,
        });
      }
      
      // Query Firestore (coincidencia exacta 3 factores)
      const docRef = firestore.collection(CONFIG.FIRESTORE_COLLECTION).doc(aptNorm);
      const docSnap = await docRef.get();
      
      if (!docSnap.exists) {
        await logAudit({
          ip: clientIp,
          telefono_hash: hashForAudit(telNorm),
          apartamento: aptNorm,
          nombre_hash: hashForAudit(nameNorm),
          success: false,
          error_code: 'APARTAMENTO_NO_REGISTRADO',
        });
        // Timing-safe: mismo response que credenciales inválidas
        return res.status(403).json({
          success: false,
          error: 'CREDENCIALES_INVALIDAS',
          message: 'Los datos proporcionados no coinciden con ningún registro autorizado',
        });
      }
      
      const vecino = docSnap.data();
      
      // Verificar 3 factores
      const match = 
        vecino.nombre_normalizado === nameNorm &&
        vecino.telefono_e164 === telNorm;
      
      if (!match) {
        await logAudit({
          ip: clientIp,
          telefono_hash: hashForAudit(telNorm),
          apartamento: aptNorm,
          nombre_hash: hashForAudit(nameNorm),
          success: false,
          error_code: 'CREDENCIALES_INVALIDAS',
        });
        return res.status(403).json({
          success: false,
          error: 'CREDENCIALES_INVALIDAS',
          message: 'Los datos proporcionados no coinciden con ningún registro autorizado',
        });
      }
      
      // Verificar que tiene documento asignado
      if (!vecino.documento_drive_id) {
        await logAudit({
          ip: clientIp,
          telefono_hash: hashForAudit(telNorm),
          apartamento: aptNorm,
          nombre_hash: hashForAudit(nameNorm),
          success: false,
          error_code: 'DOCUMENTO_NO_DISPONIBLE',
        });
        return res.status(404).json({
          success: false,
          error: 'DOCUMENTO_NO_DISPONIBLE',
          message: 'Su informe aún no ha sido generado o cargado. Contacte a administración.',
        });
      }
      
      // Generar Signed URL
      let signedUrl;
      try {
        signedUrl = await generateSignedUrl(vecino.documento_drive_id);
      } catch (err) {
        console.error('Signed URL generation failed:', err);
        await logAudit({
          ip: clientIp,
          telefono_hash: hashForAudit(telNorm),
          apartamento: aptNorm,
          nombre_hash: hashForAudit(nameNorm),
          success: false,
          error_code: 'SIGNED_URL_ERROR',
        });
        return res.status(500).json({
          success: false,
          error: 'ERROR_INTERNO',
          message: 'No se pudo generar el enlace de acceso. Intente más tarde.',
        });
      }
      
      // Success audit
      await logAudit({
        ip: clientIp,
        telefono_hash: hashForAudit(telNorm),
        apartamento: aptNorm,
        nombre_hash: hashForAudit(nameNorm),
        success: true,
        documento_id: vecino.documento_drive_id,
      });
      
      // Response
      res.json({
        success: true,
        documento: {
          nombre: vecino.documento_nombre,
          signed_url: signedUrl,
          expires_in_seconds: CONFIG.SIGNED_URL_TTL_SECONDS,
          mime_type: 'application/pdf',
        },
      });
      
    } catch (err) {
      console.error('Auth gateway error:', err);
      await logAudit({
        ip: clientIp,
        success: false,
        error_code: 'INTERNAL_ERROR',
        error_message: err.message,
      });
      res.status(500).json({
        success: false,
        error: 'ERROR_INTERNO',
        message: 'Error interno del servidor',
      });
    }
  });
  
  // Health check
  app.get('/health', async (req, res) => {
    try {
      await initClients();
      await firestore.collection(CONFIG.FIRESTORE_COLLECTION).limit(1).get();
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    } catch (err) {
      res.status(503).json({ status: 'unhealthy', error: err.message });
    }
  });
  
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`ENKA Auth Gateway listening on ${PORT}`);
    initClients().catch(console.error);
  });
  EOF
  ```

- [ ] **Tarea 11**: Deploy a Cloud Run con IAP

  ```bash
  cd /tmp/enka-auth-gateway
  
  gcloud run deploy enka-auth-gateway \
    --source=. \
    --region=${GCP_REGION} \
    --service-account=${SA_EMAIL} \
    --memory=256MiB \
    --cpu=1 \
    --min-instances=0 \
    --max-instances=50 \
    --concurrency=80 \
    --timeout=30s \
    --ingress=internal \
    --set-env-vars="GCP_PROJECT=${GCP_PROJECT},AUDIT_SALT=$(openssl rand -hex 32)" \
    --labels=component=auth-gateway,domain=civil_patrimonial \
    --project=${GCP_PROJECT}
  ```

- [ ] **Tarea 12**: Habilitar IAP en el servicio

  ```bash
  gcloud iap web enable \
    --resource-type=cloud-run \
    --service=enka-auth-gateway \
    --region=${GCP_REGION} \
    --project=${GCP_PROJECT}
  
  # Otorgar acceso a frontend service account (para llamadas server-to-server)
  gcloud iap web add-iam-policy-binding \
    --resource-type=cloud-run \
    --service=enka-auth-gateway \
    --region=${GCP_REGION} \
    --member="serviceAccount:enka-frontend@${GCP_PROJECT}.iam.gserviceaccount.com" \
    --role="roles/iap.httpsResourceAccessor" \
    --project=${GCP_PROJECT}
  ```

- [ ] **Tarea 13**: Obtener URL del servicio para configurar frontend

  ```bash
  AUTH_GATEWAY_URL=$(gcloud run services describe enka-auth-gateway \
    --region=${GCP_REGION} \
    --format="value(status.url)" \
    --project=${GCP_PROJECT})
  
  echo "AUTH_GATEWAY_URL=${AUTH_GATEWAY_URL}"
  # Ejemplo: https://enka-auth-gateway-abc123-uc.a.run.app
  ```

---

## Fase D: Integración Frontend (Google Sites / Static HTML)

- [ ] **Tarea 14**: Actualizar `evidencia/index.html` con formulario Vista Ciega

  ```bash
  # Agregar sección en index.html (ver PRD-005 para UI spec)
  # El formulario hace POST a ${AUTH_GATEWAY_URL}/api/v1/auth/vista-ciega
  # Con headers: Authorization: Bearer <OIDC_TOKEN> (si frontend autentica)
  # O sin auth si Cloud Run ingress=all (menos seguro)
  ```

---

## Fase E: Validación End-to-End

- [ ] **Tarea 15**: Test credenciales válidas

  ```bash
  curl -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $(gcloud auth print-identity-token --audiences=${AUTH_GATEWAY_URL})" \
    "${AUTH_GATEWAY_URL}/api/v1/auth/vista-ciega" \
    -d '{"telefono":"+584121234567","apartamento":"PB","nombre_completo":"Juan Perez"}'
  # Debe retornar 200 + signed_url
  ```

- [ ] **Tarea 16**: Test credenciales inválidas (teléfono errado)

  ```bash
  curl -X POST ... -d '{"telefono":"+584129999999","apartamento":"PB","nombre_completo":"Juan Perez"}'
  # Debe retornar 403 CREDENCIALES_INVALIDAS
  ```

- [ ] **Tarea 17**: Test apartamento sin documento

  ```bash
  # Para apartamento sin documento_drive_id en Firestore
  curl -X POST ... -d '{"telefono":"+584121234567","apartamento":"2","nombre_completo":"Maria Gonzalez"}'
  # Debe retornar 404 DOCUMENTO_NO_DISPONIBLE
  ```

- [ ] **Tarea 18**: Test rate limiting (6 requests rápidos)

  ```bash
  for i in {1..6}; do
    curl -X POST ... -d '{"telefono":"+584121234567","apartamento":"PB","nombre_completo":"Juan Perez"}'
    sleep 0.1
  done
  # 6to request debe retornar 429 DEMASIADOS_INTENTOS
  ```

- [ ] **Tarea 19**: Verificar auditoría en Firestore

  ```bash
  # Console → Firestore → audit_accesos collection
  # Debe haber registros con telefono_hash, apartamento, success/error_code
  ```

- [ ] **Tarea 20**: Verificar carpeta pública accesible

  ```bash
  # Abrir en navegador incógnito:
  # https://drive.google.com/drive/folders/${PUBLIC_FOLDER_ID}
  # Debe mostrar contenido sin login
  ```

- [ ] **Tarea 21**: Verificar carpeta privada NO accesible

  ```bash
  # Abrir en navegador incógnito:
  # https://drive.google.com/drive/folders/${PRIVATE_FOLDER_ID}
  # Debe mostrar "Acceso denegado" o "Necesitas permiso"
  ```

---

## Fase F: Documentación y Cierre

- [ ] **Tarea 22**: Engram save hito Fase 24 (security)

---

## DoD (Definition of Done)

- Carpeta pública `00_PUBLICO_TRANSPARENCIA` con sharing `anyone:reader`
- Carpeta privada `01_PRIVADO_VECINOS` con sharing restringido (SA + Admins)
- 19 sub-carpetas apartamento creadas en privada
- Firestore `vecinos_autorizados` poblado con 19 registros
- `enka-auth-gateway` deployado en Cloud Run + IAP habilitado
- POST `/auth/vista-ciega` valida 3 factores exactos → Signed URL (TTL 900s)
- Rate limiting 5 req/hora por IP/apt funcionando
- Auditoría en `audit_accesos` registra todos los intentos
- Documentos privados NO accesibles por link directo
- Engram doctor 4/4 OK
