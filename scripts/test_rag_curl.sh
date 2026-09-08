#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# FASE 26.1 — VALIDACIÓN RAG QUERY (Zero-Copy, SSoT) — CURL VERSION
# ============================================================
# Uso: ./scripts/test_rag_curl.sh
# Requisitos: gcloud auth application-default login, proyecto con Cloud Function rag-civil-query
# ============================================================

GCP_PROJECT="${GCP_PROJECT:-enka-patrimonial-rag}"
GCP_REGION="${GCP_REGION:-us-central1}"
CF_NAME="rag-civil-query"

TEST_QUESTION="¿Cuáles son las especificaciones técnicas para el uso de SikaGrout Fase II según el Anexo de Patologías?"

EXPECTED_CITATIONS=("SikaGrout" "Fase II" "ANEXO" "Sika Rustex" "columnas" "carbonatación")

echo "============================================================"
echo "  FASE 26.1 — VALIDACIÓN RAG QUERY (Zero-Copy, SSoT)"
echo "============================================================"
echo "Proyecto: ${GCP_PROJECT}"
echo "Pregunta: ${TEST_QUESTION}"
echo ""

# Obtener token ADC
echo "🔐 Obteniendo token ADC..."
TOKEN=$(gcloud auth print-identity-token --audiences="https://${GCP_REGION}-${GCP_PROJECT}.cloudfunctions.net" 2>/dev/null) || {
  echo "❌ Error: No se pudo obtener token ADC. Ejecuta: gcloud auth application-default login"
  exit 1
}
echo "✅ Token ADC obtenido"

# Obtener URL de la Cloud Function
echo "🔗 Obteniendo URL de la Cloud Function..."
CF_URL=$(gcloud functions describe rag-civil-query \
  --region="${GCP_REGION}" \
  --format="value(serviceConfig.uri)" \
  --project="${GCP_PROJECT}" 2>/dev/null) || {
  echo "❌ Error: No se pudo obtener URL de la Cloud Function 'rag-civil-query'"
  echo "   Verifica que la función existe: gcloud functions list --project=${GCP_PROJECT}"
  exit 1
}
echo "🔗 Endpoint: ${CF_URL}"

# Ejecutar consulta
echo ""
echo "📤 Consultando endpoint..."
echo "   Pregunta: ${TEST_QUESTION}"

RESPONSE=$(curl -s -X POST "${CF_URL}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"question\":\"${TEST_QUESTION}\",\"top_k\":5,\"generate\":true}" \
  --max-time 30) || {
  echo "❌ Error en curl: $?"
  exit 1
}

# Mostrar respuesta
echo ""
echo "📥 RESPUESTA RAG:"
echo "----------------------------------------------------------------------"
echo "${RESPONSE}" | jq -r '.answer // "SIN RESPUESTA"'
echo "----------------------------------------------------------------------"

# Mostrar fuentes
SOURCES_COUNT=$(echo "${RESPONSE}" | jq '.sources | length')
echo ""
echo "📚 FUENTES RECUPERADAS (${SOURCES_COUNT}):"
echo "${RESPONSE}" | jq -r '.sources[] | "   [\(.source // "UNKNOWN")] Pág: \(.page // "N/A") | Score: \(.score // 0)"'

# Validar
ANSWER=$(echo "${RESPONSE}" | jq -r '.answer // ""')
LATENCY=$(echo "${RESPONSE}" | jq -r '.metadata.latencyMs // 0')
SOURCES_COUNT=$(echo "${RESPONSE}" | jq '.sources | length')

echo ""
echo "✅ VALIDACIÓN DE CALIDAD:"

HAS_ANSWER=$([ ${#ANSWER} -gt 50 ] && echo true || echo false)
HAS_SOURCES=$([ ${SOURCES_COUNT} -gt 0 ] && echo true || echo false)

CITATIONS_FOUND=0
for CITATION in "SikaGrout" "Fase II" "ANEXO" "Sika Rustex" "columnas" "carbonatación"; do
  if echo "${ANSWER}" | grep -qi "${CITATION}"; then
    echo "   ✅ Cita encontrada: ${CITATION}"
  else
    echo "   ❌ Cita faltante: ${CITATION}"
  fi
done

LATENCY_OK=$([ ${LATENCY} -lt 5000 ] && echo true || echo false)

PASSED=true
$HAS_ANSWER || PASSED=false
$HAS_SOURCES || PASSED=false
# Check at least 3 citations found
CITATIONS_FOUND=$(grep -i "sikagrout\|fase ii\|anexo\|sika rustex\|columnas\|carbonatación" <<<"${ANSWER}" | wc -l)
[ ${CITATIONS_FOUND} -ge 3 ] || PASSED=false
$LATENCY_OK || PASSED=false

echo ""
echo "   Respuesta generada: $([ "$HAS_ANSWER" = true ] && echo "✅" || echo "❌")"
echo "   Fuentes recuperadas: $([ "$HAS_SOURCES" = true ] && echo "✅" || echo "❌") (${SOURCES_COUNT})"
echo "   Citas clave: $([ $CITATIONS_FOUND -ge 3 ] && echo "✅" || echo "❌") (${CITATIONS_FOUND}/6)"
echo "   Latencia: $([ "$LATENCY_OK" = true ] && echo "✅" || echo "❌") (${LATENCY} ms)"

if [ "$PASSED" = true ]; then
  echo ""
  echo "🎉 PRUEBA EXITOSA"
  exit 0
else
  echo ""
  echo "❌ PRUEBA FALLIDA"
  exit 1
fi
