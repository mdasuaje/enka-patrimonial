#!/usr/bin/env python3
"""
Validación rápida del dataset en producción (vía stdin).
"""

import json
import sys


def validate():
    data = json.load(sys.stdin)
    assert data.get("success") is True, "success debe ser true"
    assert data.get("fileCount") == 17, "fileCount debe ser 17"
    print(f"OK Dataset en produccion valido: {data['fileCount']} registros")
    return True


if __name__ == "__main__":
    try:
        validate()
        sys.exit(0)
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)
