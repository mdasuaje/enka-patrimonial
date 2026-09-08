#!/usr/bin/env bash
set -euo pipefail

WORKSPACE="/home/masua/workspaces/enka-patrimonial"
cd "$WORKSPACE" || exit 1

export ENGRAM_PROJECT="enka-patrimonial"
REPO_URL="https://github.com/mdasuaje/enka-patrimonial.git"

echo "[+] 1. Configurando repositorio Git local y sincronización de rama 'main'..."
if [ ! -d ".git" ]; then
  git init
  git branch -M main
fi

if ! git remote | grep -q "origin"; then
  git remote add origin "$REPO_URL"
else
  git remote set-url origin "$REPO_URL"
fi

echo "[+] 2. Empaquetando artefactos de producción (Fase 20: Release V1.0.0)..."
git add .
git commit -m "release(v1.0.0): Dossier ENKA Live - Galería con 53 fotos, filtros Ejes I-IV, lightbox y snippet Google Sites" || true

echo "[+] 3. Ejecutando Push a repositorio remoto GitHub..."
if git push -u origin main; then
  echo "[✓] Código y evidencias subidas exitosamente a GitHub."
else
  echo "[!] Nota: Revisa tus credenciales Git (GH_TOKEN/SSH) si requieres autenticar el Push manual."
fi

echo "[+] 4. Verificando disponibilidad de entrega para Google Sites..."
if [ -f "evidencia/google_sites_embed.html" ]; then
  echo "[✓] Snippet listo en: $WORKSPACE/evidencia/google_sites_embed.html"
fi

echo "[+] 5. Guardando hito final #148 de despliegue en Engram..."
engram save "Publicación V1.0.0 y Sincronización Cloud (Fase 20)" "Despliegue a GitHub Pages, empaquetado de iframe para Google Sites y cierre del ciclo SDD." --type "release" --project "$ENGRAM_PROJECT"

echo "[+] 6. Verificación de salud final en Engram Engine:"
engram doctor --project "$ENGRAM_PROJECT"
