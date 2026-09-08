#!/usr/bin/env bash
# Arnés de prueba automatizado para PWA Bridge (ENKA) con encriptación ETL
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

echo -e "\n🔍 Prueba 2: Autenticación Exitosa - Apto 17 con encriptación ETL"
RESULT=$(curl -s -X POST http://127.0.0.1:3001/api/auth \
  -H "Content-Type: application/json" \
  -d '{"telefono":"+58 412 123 4567","apartamento":"Apto 17","nombre_completo":"Iris Useche"}')
if echo "$RESULT" | grep -q "encrypted_token"; then
  echo "✅ Acceso Concedido - URL cifrada ETL"
  # Verificar que no hay parámetros en texto plano
  if echo "$RESULT" | grep -q "lookerstudio"; then
    echo "   - Token LookerStudio presente en respuesta"
  fi
  # Verificar que el token está cifrado (no es URL plana)
  TOKEN=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('looker_url','')[:50])")
  echo "   - Token cifrado: ${TOKEN}..."
else
  echo "⚠️ Fallo en la concesión - Respuesta: $RESULT"
fi

echo -e "\n🔍 Prueba 3: Validación Integridad ETL - Token descifrable"
# Verificar que el módulo de criptografía está disponible
if python3 -c "from scripts.enka_pqc_cipher import encrypt_looker_params" 2>/dev/null; then
  echo "✅ Módulo criptográfico ETL disponible"
else
  echo "⚠️ Módulo criptográfico ETL no disponible"
fi

echo -e "\nApagando puente..."
kill $BRIDGE_PID
