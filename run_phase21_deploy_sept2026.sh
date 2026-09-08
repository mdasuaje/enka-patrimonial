#!/usr/bin/env bash
set -euo pipefail

WORKSPACE="/home/masua/workspaces/enka-patrimonial"
cd "$WORKSPACE" || exit 1

export ENGRAM_PROJECT="enka-patrimonial"

echo "[+] 1. Empaquetando actualización Septiembre 2026 (PRD-002)..."
git add prd/PRD-002-enka-sept-2026.md tasks/TASKS-002.md evidencia/index.html
git commit -m "feat(sept-2026): PRD-002 actualización portal - Fases II/III, docs oficiales, módulo financiero RLS, arquitectura ENKA Live" || true

echo "[+] 2. Push a GitHub (dispara GitHub Pages rebuild)..."
if git push origin main; then
  echo "[✓] Código subido exitosamente. GitHub Pages rebuild iniciado."
else
  echo "[!] Push falló. Verifica credenciales GH_TOKEN/SSH."
  exit 1
fi

echo "[+] 3. Esperando build GitHub Pages (máx 120s)..."
for i in {1..24}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://mdasuaje.github.io/enka-patrimonial/evidencia/index.html)
  if [ "$STATUS" = "200" ]; then
    echo "[✓] GitHub Pages actualizado y accesible (HTTP 200)"
    break
  fi
  echo "  Esperando... ($i/24) - Status: $STATUS"
  sleep 5
done

echo "[+] 4. Verificación final de despliegue..."
curl -s -o /dev/null -w "  Index: %{http_code}\n" https://mdasuaje.github.io/enka-patrimonial/evidencia/index.html
curl -s -o /dev/null -w "  Embed: %{http_code}\n" https://mdasuaje.github.io/enka-patrimonial/evidencia/google_sites_embed.html

echo "[+] 5. Guardando hito en Engram (release v2026.09)..."
engram save "Actualización Septiembre 2026 - Portal ENKA Live v2026.09" "PRD-002 implementado: Fases II/III actualizadas, documentos oficiales vinculados, módulo financiero Strict-RLS, arquitectura ENKA Live 4 capas. GitHub Pages rebuild completado." --type "release" --project "$ENGRAM_PROJECT"

echo "[+] 6. Salud Engram:"
engram doctor --project "$ENGRAM_PROJECT"

echo ""
echo "================================================="
echo "  DESPLIEGUE SEPTIEMBRE 2026 COMPLETADO"
echo "================================================="
echo "  Portal: https://mdasuaje.github.io/enka-patrimonial/evidencia/"
echo "  Embed:  https://mdasuaje.github.io/enka-patrimonial/evidencia/google_sites_embed.html"
echo "  Repo:   https://github.com/mdasuaje/enka-patrimonial"
echo "================================================="
