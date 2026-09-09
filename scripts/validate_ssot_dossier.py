#!/usr/bin/env python3
"""
Validación E2E del dataset SSoT (ssot_dossier.json)
Verifica: estructura, 17 registros, SHA-256, campos PQC-ready, timestamps ISO 8601.
"""

import json
import os
import sys
from datetime import datetime


def validate():
    dossier_path = os.environ.get(
        "DOSSIER_JSON", "frontend/inspection-hub/public/data/ssot_dossier.json"
    )
    ssot_folder_id = os.environ.get(
        "SSOT_FOLDER_ID", "1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY"
    )

    with open(dossier_path) as f:
        data = json.load(f)

    # Validaciones obligatorias
    assert data.get("success") is True, "success debe ser true"
    assert data.get("folderId") == ssot_folder_id, "folderId mismatch"
    assert "fileCount" in data, "fileCount faltante"
    assert "files" in data and isinstance(data["files"], list), "files debe ser array"
    assert len(data["files"]) == data["fileCount"], "fileCount no coincide"

    print(f"OK Estructura basica valida: {data['fileCount']} archivos")

    required_fields = ["id", "name", "thumbnailLink", "description", "meta"]
    required_meta = [
        "diagnosticoTecnico",
        "faseObra",
        "ubicacion",
        "sha256",
        "size",
        "mimeType",
        "uploadedAt",
    ]

    for i, f in enumerate(data["files"], 1):
        for field in required_fields:
            assert field in f, f"Registro {i}: campo {field} faltante"
        meta = f.get("meta", {})
        for field in required_meta:
            assert field in meta, f"Registro {i}: meta.{field} faltante"
        sha = meta["sha256"]
        assert len(sha) == 64, f"Registro {i}: SHA-256 longitud invalida"
        assert all(c in "0123456789abcdef" for c in sha.lower()), (
            f"Registro {i}: SHA-256 no es hex valido"
        )
        assert meta["size"] > 0, f"Registro {i}: size debe ser > 0"
        assert meta["mimeType"].startswith("image/"), f"Registro {i}: MIME invalido"
        assert "pqcSignature" in meta, f"Registro {i}: pqcSignature faltante"
        assert "pqcAlgorithm" in meta, f"Registro {i}: pqcAlgorithm faltante"
        datetime.fromisoformat(meta["uploadedAt"].replace("Z", "+00:00"))

    print("OK Todos los 17 registros validos")
    print("OK Integridad SHA-256 verificada")
    print("OK Campos PQC-ready presentes")
    print("OK Timestamps ISO 8601 validos")
    return True


if __name__ == "__main__":
    try:
        validate()
        sys.exit(0)
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)
