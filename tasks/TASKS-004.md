# TASKS-004: RAG Patrimonial — Provisioning CLI (Dominio CIVIL_Y_ARQUITECTONICO)

## Variables de Entorno (Configurar antes de ejecutar)

```bash
export GCP_PROJECT="enka-patrimonial-rag"           # Proyecto GCP dedicado para RAG civil
export GCP_REGION="us-central1"                      # Región Vertex AI / Cloud Functions
export DRIVE_FOLDER_ID="1GPRxyz1k4tpY83RbJj7peFq7gdPHge3F"  # ENKA SEPTIEMBRE 2026
export DRIVE_ROOT_ID="1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY"     # Raíz carpeta "enka"
export SA_NAME="rag-civil-ingest-sa"                 # Service Account nombre
export SA_EMAIL="${SA_NAME}@${GCP_PROJECT}.iam.gserviceaccount.com"
export TOPIC_NAME="rag-civil-events"
export DLQ_TOPIC_NAME="rag-civil-dlq"
export CF_INGEST_NAME="rag-civil-ingest"
export CF_QUERY_NAME="rag-civil-query"
export VECTOR_INDEX_ID="rag-civil-index-prod"
export WEBHOOK_URL="https://${GCP_REGION}-${GCP_PROJECT}.cloudfunctions.net/${CF_INGEST_NAME}"
```

---

## Fase A: Proyecto GCP y APIs

- [ ] **Tarea 01**: Crear/seleccionar proyecto GCP dedicado

  ```bash
  gcloud projects create ${GCP_PROJECT} --name="ENKA RAG Civil Patrimonial" --set-as-default
  gcloud config set project ${GCP_PROJECT}
  ```

- [ ] **Tarea 02**: Habilitar APIs requeridas

  ```bash
  gcloud services enable \
    drive.googleapis.com \
    pubsub.googleapis.com \
    cloudfunctions.googleapis.com \
    run.googleapis.com \
    aiplatform.googleapis.com \
    cloudbuild.googleapis.com \
    eventarc.googleapis.com \
    cloudscheduler.googleapis.com \
    secretmanager.googleapis.com
  ```

- [ ] **Tarea 03**: Configurar facturación (requerido para Vertex AI / Cloud Functions)

  ```bash
  gcloud beta billing projects link ${GCP_PROJECT} --billing-account=$(gcloud beta billing accounts list --format="value(name)" --filter="open=true" --limit=1)
  ```

---

## Fase B: Service Account e IAM (Principio Menor Privilegio)

- [ ] **Tarea 04**: Crear Service Account para ingesta

  ```bash
  gcloud iam service-accounts create ${SA_NAME} \
    --display-name="RAG Civil Ingest Processor" \
    --description="Procesa cambios en Drive carpeta ENKA SEPTIEMBRE 2026 → Embeddings → Vector Store"
  ```

- [ ] **Tarea 05**: Otorgar roles mínimos al SA

  ```bash
  # Drive read-only (solo carpeta target via Domain-Wide Delegation o impersonation)
  gcloud projects add-iam-policy-binding ${GCP_PROJECT} \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/drive.readonly"

  # Vertex AI Embeddings
  gcloud projects add-iam-policy-binding ${GCP_PROJECT} \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/aiplatform.user"

  # Vertex AI Matching Engine / Vector Search
  gcloud projects add-iam-policy-binding ${GCP_PROJECT} \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/aiplatform.admin"  # o roles/aiplatform.matchingEngineIndexAdmin si existe

  # Pub/Sub publisher (para DLQ)
  gcloud projects add-iam-policy-binding ${GCP_PROJECT} \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/pubsub.publisher"
  ```

- [ ] **Tarea 06**: Configurar Domain-Wide Delegation (si Workspace) o OAuth impersonation para Drive API

  ```bash
  # Si usando Workspace con Domain-Wide Delegation:
  # Admin Console → Security → API Controls → Domain-wide Delegation
  # Client ID: ${SA_EMAIL} (unique ID del SA)
  # Scopes: https://www.googleapis.com/auth/drive.readonly
  ```

---

## Fase C: Pub/Sub Topics

- [ ] **Tarea 07**: Crear topic principal `rag-civil-events`

  ```bash
  gcloud pubsub topics create ${TOPIC_NAME} \
    --message-retention-duration=7d \
    --message-storage-policy-allowed-regions=${GCP_REGION}
  ```

- [ ] **Tarea 08**: Crear Dead Letter Queue topic

  ```bash
  gcloud pubsub topics create ${DLQ_TOPIC_NAME} \
    --message-retention-duration=30d
  ```

- [ ] **Tarea 09**: Crear suscripción con DLQ y retry policy

  ```bash
  gcloud pubsub subscriptions create ${TOPIC_NAME}-sub \
    --topic=${TOPIC_NAME} \
    --push-endpoint=${WEBHOOK_URL} \
    --push-auth-service-account=${SA_EMAIL} \
    --dead-letter-topic=${DLQ_TOPIC_NAME} \
    --max-delivery-attempts=3 \
    --min-backoff=10s \
    --max-backoff=600s \
    --ack-deadline=600s \
    --message-retention-duration=7d
  ```

---

## Fase D: Cloud Function — Ingest (`rag-civil-ingest`)

- [ ] **Tarea 10**: Preparar código fuente (directorio temporal)

  ```bash
  mkdir -p /tmp/rag-civil-ingest && cd /tmp/rag-civil-ingest
  cat > package.json << 'EOF'
  {
    "name": "rag-civil-ingest",
    "version": "1.0.0",
    "main": "index.js",
    "dependencies": {
      "@google-cloud/pubsub": "^4.5.0",
      "@google-cloud/vertexai": "^1.6.0",
      "@googleapis/drive": "^8.0.0",
      "google-auth-library": "^9.0.0"
    }
  }
  EOF
  ```

- [ ] **Tarea 11**: Implementar `index.js` (ver `evidencia/scripts/rag_ingest.js` — generar aparte)

  ```bash
  # Copiar implementación completa desde evidencia/scripts/rag_ingest.js
  cp /home/masua/workspaces/enka-patrimonial/evidencia/scripts/rag_ingest.js /tmp/rag-civil-ingest/index.js
  ```

- [ ] **Tarea 12**: Deploy Cloud Function (Gen 2, Cloud Run backed)

  ```bash
  gcloud functions deploy ${CF_INGEST_NAME} \
    --gen2 \
    --runtime=nodejs20 \
    --region=${GCP_REGION} \
    --source=/tmp/rag-civil-ingest \
    --entry-point=ingestHandler \
    --trigger-topic=${TOPIC_NAME} \
    --service-account=${SA_EMAIL} \
    --memory=512MiB \
    --timeout=540s \
    --max-instances=10 \
    --min-instances=0 \
    --set-env-vars="DRIVE_FOLDER_ID=${DRIVE_FOLDER_ID},DRIVE_ROOT_ID=${DRIVE_ROOT_ID},VECTOR_INDEX_ID=${VECTOR_INDEX_ID},GCP_PROJECT=${GCP_PROJECT},GCP_REGION=${GCP_REGION}" \
    --ingress-settings=internal-only \
    --vpc-connector=projects/${GCP_PROJECT}/locations/${GCP_REGION}/connectors/rag-vpc-connector \
    --labels=domain=civil_patrimonial,component=ingest
  ```

---

## Fase E: Vector Store — Vertex AI Matching Engine

- [ ] **Tarea 13**: Crear índice de Vector Search (Matching Engine)

  ```bash
  # Via gcloud (preview) o Console → Vertex AI → Vector Search
  gcloud ai indexes create \
    --region=${GCP_REGION} \
    --display-name="RAG Civil Patrimonial Index" \
    --metadata-file=/tmp/index_metadata.json \
    --description="Índice vectorial para documentos civiles/arquitectónicos ENKA"
  ```

  `index_metadata.json`:

  ```json
  {
    "contentsDeltaUri": "gs://${GCP_PROJECT}-rag-vectors/delta",
    "config": {
      "dimensions": 768,
      "approximateNeighborsCount": 150,
      "distanceMeasureType": "COSINE_DISTANCE",
      "featureNormType": "UNIT_L2_NORM",
      "algorithmConfig": {
        "treeAhConfig": {
          "leafNodeEmbeddingCount": 500,
          "leafNodesToSearchPercent": 7
        }
      }
    }
  }
  ```

- [ ] **Tarea 14**: Deploy Index Endpoint (public/private)

  ```bash
  gcloud ai index-endpoints create \
    --region=${GCP_REGION} \
    --display-name="RAG Civil Endpoint" \
    --network="projects/${GCP_PROJECT}/global/networks/default"  # o VPC dedicado
  ```

  ```bash
  # Deploy index to endpoint
  gcloud ai index-endpoints deploy-index ${ENDPOINT_ID} \
    --region=${GCP_REGION} \
    --index=${INDEX_ID} \
    --deployed-index-id="rag_civil_deployed" \
    --machine-type="e2-standard-2" \
    --min-replica-count=1 \
    --max-replica-count=3
  ```

---

## Fase F: Drive Watch — Canal de Notificaciones

- [ ] **Tarea 15**: Crear/renovar canal Drive Watch (ejecutar manualmente o via Cloud Scheduler)

  ```bash
  # Requiere OAuth token con scope drive.readonly (service account impersonation)
  # Ejemplo con curl + gcloud auth print-access-token:
  ACCESS_TOKEN=$(gcloud auth print-access-token --impersonate-service-account=${SA_EMAIL})
  
  curl -X POST \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    "https://www.googleapis.com/drive/v3/files/watch" \
    -d "{
      \"kind\": \"api#channel\",
      \"id\": \"rag-civil-watch-$(date +%s)\",
      \"type\": \"web_hook\",
      \"address\": \"${WEBHOOK_URL}\",
      \"params\": { \"ttl\": \"864000\" },
      \"payload\": true,
      \"resourceId\": \"${DRIVE_ROOT_ID}\",
      \"resourceUri\": \"https://www.googleapis.com/drive/v3/files?q='${DRIVE_FOLDER_ID}'+in+parents&fields=files(id,name,mimeType,parents,modifiedTime)\"
    }"
  ```

- [ ] **Tarea 16**: Cloud Scheduler para renovar watch (diario)

  ```bash
  gcloud scheduler jobs create http renew-drive-watch \
    --schedule="0 2 * * *" \
    --uri="${WEBHOOK_URL}/renew-watch" \
    --http-method=POST \
    --oauth-service-account-email=${SA_EMAIL} \
    --time-zone="America/Caracas" \
    --description="Renueva canal Drive Watch cada 10 días (TTL 864000s)"
  ```

---

## Fase G: Cloud Function — Query API (`rag-civil-query`)

- [ ] **Tarea 17**: Deploy Retrieval API (Cloud Run recomendado para concurrency)

  ```bash
  # Preparar código en /tmp/rag-civil-query (ver evidencia/scripts/rag_query.js)
  gcloud run deploy ${CF_QUERY_NAME} \
    --source=/tmp/rag-civil-query \
    --region=${GCP_REGION} \
    --service-account=${SA_EMAIL} \
    --memory=512MiB \
    --cpu=1 \
    --min-instances=0 \
    --max-instances=20 \
    --concurrency=80 \
    --timeout=60s \
    --ingress=internal \
    --vpc-connector=projects/${GCP_PROJECT}/locations/${GCP_REGION}/connectors/rag-vpc-connector \
    --set-env-vars="VECTOR_INDEX_ENDPOINT=${ENDPOINT_URL},VECTOR_DEPLOYED_INDEX_ID=rag_civil_deployed,GCP_PROJECT=${GCP_PROJECT}" \
    --labels=domain=civil_patrimonial,component=query
  ```

- [ ] **Tarea 18**: Configurar IAP para proteger endpoint

  ```bash
  gcloud iap web enable --resource-type=cloud-run --service=${CF_QUERY_NAME} --region=${GCP_REGION}
  gcloud iap web add-iam-policy-binding --resource-type=cloud-run --service=${CF_QUERY_NAME} --region=${GCP_REGION} \
    --member="serviceAccount:enka-frontend@${GCP_PROJECT}.iam.gserviceaccount.com" \
    --role="roles/iap.httpsResourceAccessor"
  ```

---

## Fase H: Validación End-to-End

- [ ] **Tarea 19**: Test Pub/Sub → CF Ingest

  ```bash
  gcloud pubsub topics publish ${TOPIC_NAME} \
    --message='{"specversion":"1.0","type":"google.cloud.drive.file.v1.updated","source":"//drive.googleapis.com/projects/'${GCP_PROJECT}'","id":"test-file-001","time":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","datacontenttype":"application/json","data":{"fileId":"test-file-001","folderId":"'${DRIVE_FOLDER_ID}'","mimeType":"application/pdf","name":"test_anexo_tecnico.pdf","driveId":"'${DRIVE_ROOT_ID}'","changedBy":"test@enka.ve","changeType":"FILE_CREATED"}}'
  ```

- [ ] **Tarea 20**: Verificar logs de ingest

  ```bash
  gcloud functions logs read ${CF_INGEST_NAME} --region=${GCP_REGION} --limit=50 --gen2
  ```

- [ ] **Tarea 21**: Test Query API

  ```bash
  QUERY_TOKEN=$(gcloud auth print-identity-token --audiences=$(gcloud run services describe ${CF_QUERY_NAME} --region=${GCP_REGION} --format="value(status.url)"))
  curl -X POST \
    -H "Authorization: Bearer ${QUERY_TOKEN}" \
    -H "Content-Type: application/json" \
    "$(gcloud run services describe ${CF_QUERY_NAME} --region=${GCP_REGION} --format="value(status.url)")" \
    -d '{"query":"Estado de la Fase II columnas","topK":5,"filters":{"folderId":"'${DRIVE_FOLDER_ID}'"}}'
  ```

- [ ] **Tarea 22**: Verificar Domain Guard (query financiera debe retornar vacío)

  ```bash
  curl -X POST ... -d '{"query":"comprobantes depósitos vecinos","topK":5}'
  # Debe retornar results: [] o error RLS
  ```

---

## Fase I: Documentación y Cierre

- [ ] **Tarea 23**: Validar sintaxis `evidencia/scripts/rag_ingest.js` y `evidencia/scripts/rag_query.js`
- [ ] **Tarea 24**: Engram save hito Fase 23 (architecture)

---

## DoD (Definition of Done)

- Topic + DLQ + Subscription activos en `${GCP_PROJECT}`
- Cloud Function `rag-civil-ingest` deployada, recibe push, procesa sin errores
- Drive Watch activo y renovándose vía Scheduler
- Vector Index + Endpoint creados, aceptan upsert/query
- Query API protegida con IAP, responde < 2s p95
- Domain Guard: `folderId` validation rechaza eventos de otras carpetas
- Engram doctor 4/4 OK
