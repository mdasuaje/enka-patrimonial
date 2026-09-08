#!/usr/bin/env bash
# Arnés de prueba automatizado para PWA Bridge (ENKA)
set -e

echo "Levantando el puente FTS5 en background (Puerto 3001)..."
python3 ~/workspaces/enka-patrimonial/scripts/enka_pwa_bridge.py &
BRIDGE_PID=$!
sleep 2 # Espera a que el servidor inicie

echo -e "\n🔍 Prueba 1: Autenticación Fallida (Zero-Trust) - Apto Inexistente"
RESULT=$(curl -s -X POST http://127.0.0.1:3001/api/auth \
  -H "Content-Type: application/json" \
  -d '{"telefono":"+58 412 000 0000","apartamento":"99","nombre_completo":"Intruso"}')
if echo "$RESULT" | grep -q '"error"'; then
  echo "✅ Bloqueo Exitoso - Credenciales rechazadas correctamente"
else
  echo "⚠️ Fallo en el bloqueo - Respuesta: $RESULT"
fi

echo -e "\n🔍 Prueba 2: Autenticación Exitosa - Apto 17"
RESULT=$(curl -s -X POST http://127.0.0.1:3001/api/auth \
  -H "Content-Type: application/json" \
  -d '{"telefono":"+58 412 123 4567","apartamento":"Apto 17","nombre_completo":"Iris Useche"}')
if echo "$RESULT" | grep -q "lookerstudio"; then
  echo "✅ Acceso Concedido (Signed URL)"
else
  echo "⚠️ Fallo en la concesión - Respuesta: $RESULT"
fi

echo -e "\nApagando puente..."
kill $BRIDGE_PID
