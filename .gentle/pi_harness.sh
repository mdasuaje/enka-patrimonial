#!/usr/bin/env bash
set -euo pipefail

echo "================================================="
echo "   Gentle-AI Stack :: Pi Agent Orchestrator      "
echo "   Proyecto: enka-patrimonial | SDD Mode Active  "
echo "================================================="

if command -v engram &>/dev/null; then
  echo "[✓] Engram Memory Engine activo."
fi

PROMPT_CONTEXT="Hola Pi. Lee prd/PRD-001-gallery-filtering.md y tasks/TASKS-001.md. Procesa los requisitos de filtrado por Ejes I-IV para la galería del Edificio ENKA."

if command -v pi &>/dev/null; then
  echo "[+] Ejecutando Pi Agent..."
  pi "$PROMPT_CONTEXT"
else
  echo "[!] Executable 'pi' no hallado en PATH. Ejecutando emulación de orquestación Gentle..."
  python3 -c '
import json
with open(".gentle/config.json") as f:
    cfg = json.load(f)
print(f"[✓] Harnés Gentle alineado con proyecto {cfg[\"project\"]} en workspace {cfg[\"workspace\"]}.")
'
fi
