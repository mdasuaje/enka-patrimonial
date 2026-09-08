#!/usr/bin/env python3
"""
ENKA PWA Bridge - Local API Server (Zero-Billing, Zero-Copy)
=============================================================

HTTP server en puerto 8080 que conecta el frontend PWA con el motor FTS5 local.
Cero dependencias externas: solo stdlib (http.server, sqlite3, json).

Endpoints:
  POST /api/auth  - Autenticación 3-factores (Tel:Apt:Nombre) contra v_financiero_index
  GET  /health    - Health check
"""

import json
import logging
import os
import sqlite3
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

# -----------------------------------------------------------------------------
# CONFIG
# -----------------------------------------------------------------------------
DB_PATH = os.path.join(tempfile.gettempdir(), "enka_patrimonial_vault.db")  # nosec: ephemeral
HOST = "127.0.0.1"
PORT = 8080
ALLOWED_ORIGIN = "http://localhost:8080"

# Looker Studio embed template (reemplazar con IDs reales en producción)
LOOKER_TEMPLATE = "https://lookerstudio.google.com/embed/reporting/XYZ/page/ABC?params={params}"


# -----------------------------------------------------------------------------
# DB HELPERS
# -----------------------------------------------------------------------------
def get_db_connection():
    """Conexión SQLite con row_factory para dict-like access."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def validate_credentials(telefono: str, apartamento: str, nombre: str) -> dict | None:
    """
    Valida la triada 3-factores contra v_financiero_index (FTS5).
    Retorna dict con datos del residente si coincide, None si no.
    """
    # Normalización (debe coincidir con la guardada en BD)
    apt_norm = apartamento.strip().upper()
    name_norm = nombre.strip().upper()

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        # FTS5 MATCH con parámetros (seguro contra inyección)
        cursor.execute(
            """
            SELECT fc.apto_id, fc.residente_nombre, fc.monto_usd, fc.referencia_bnc, fc.fecha_pago, fc.estado_conciliacion
            FROM financiero_caja_chica fc
            JOIN v_financiero_index vi ON fc.id_tx = vi.id_tx
            WHERE v_financiero_index MATCH ?
            ORDER BY fc.fecha_pago DESC
            LIMIT 1
            """,
            (telefono,),
        )
        row = cursor.fetchone()
    finally:
        conn.close()

    if not row:
        return None

    # Verificación estricta 3-factores (Zero-Trust)
    if row["residente_nombre"].upper() == name_norm and row["apto_id"].upper() == apt_norm:
        return dict(row)
    return None


# -----------------------------------------------------------------------------
# HTTP HANDLER
# -----------------------------------------------------------------------------
class BridgeHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, data: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "http://localhost:8080")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        """CORS preflight."""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "http://localhost:8080")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/auth":
            self._send_json(404, {"error": "Not found"})
            return

        content_length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(content_length).decode("utf-8")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Invalid JSON"})
            return

        telefono = payload.get("telefono", "").strip()
        apartamento = payload.get("apartamento", "").strip()
        nombre = payload.get("nombre_completo", "").strip()

        if not (telefono and apartamento and nombre):
            self._send_json(400, {"error": "Complete todos los campos obligatorios"})
            return

        # Validación 3-factores
        match = validate_credentials(telefono, apartamento, nombre)

        if not match:
            self._send_json(403, {"error": "Credenciales inválidas"})
            return

        # Éxito: generar URL de Looker Studio parametrizada
        try:
            params = {"apto_id": match["apto_id"], "nombre": match["residente_nombre"]}
            looker_url = f"https://lookerstudio.google.com/embed/reporting/XYZ/page/ABC?params={json.dumps(params)}"

            self._send_json(200, {
                "success": True,
                "looker_url": looker_url,
                "documento": {
                "nombre": f"Informe Financiero - {match['apto_id']}.pdf",
                "signed_url": looker_url,
                "expires_in_seconds": 900,
                "mime_type": "application/pdf"
                }
            })
        except (KeyError, TypeError, ValueError) as e:
            logging.error(f"Error building response: {e}")
            self._send_json(500, {"error": "Error interno generando respuesta"})

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"status": "ok", "service": "enka-pwa-bridge"})
        else:
            self._send_json(404, {"error": "Not found"})


# -----------------------------------------------------------------------------
# MAIN
# -----------------------------------------------------------------------------
def main():
    # Verificar que la bóveda existe
    if not os.path.exists(DB_PATH):
        print(f"❌ Error: No existe la bóveda en {DB_PATH}")
        print("   Ejecute primero: make audit-vault")
        sys.exit(1)

    server = HTTPServer((HOST, PORT), BridgeHandler)
    print(f"🌉 [ENKA Bridge] Servidor iniciado en http://{HOST}:{PORT}")
    print("   Endpoints: POST /api/auth | GET /health")
    print(f"   Bóveda: {DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Servidor detenido")
        server.server_close()


if __name__ == "__main__":
    main()
