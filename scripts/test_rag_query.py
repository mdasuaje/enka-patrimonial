#!/usr/bin/env python3
"""
FASE 26.1 — VALIDACIÓN RAG QUERY (Zero-Copy, SSoT)
====================================================

Cliente HTTP ligero para validar endpoint remoto rag-civil-query.
Sin dependencias pesadas: solo stdlib (urllib) + google-auth (ADC).
Procesamiento ocurre EN LA NUBE (Cloud Function rag-civil-query).
"""

import json
import os
import subprocess
import sys
from urllib import parse, request

from google.auth import default
from google.auth.transport.requests import Request

# -----------------------------------------------------------------------------
# CONFIGURACIÓN
# -----------------------------------------------------------------------------
GCP_PROJECT = os.getenv("GCP_PROJECT", "enka-patrimonial-rag")
GCP_REGION = os.getenv("GCP_REGION", "us-central1")
CF_NAME = "rag-civil-query"

TEST_QUESTION = (
    "¿Cuáles son las especificaciones técnicas para el uso de SikaGrout "
    "Fase II según el Anexo de Patologías?"
)

EXPECTED_CITATIONS = [
    "SikaGrout",
    "Fase II",
    "ANEXO",
    "Sika Rustex",
    "columnas",
    "carbonatación",
]


# -----------------------------------------------------------------------------
# CLIENTE HTTP LIGERO (stdlib urllib)
# -----------------------------------------------------------------------------
def get_adc_token() -> str:
    """Obtiene token OAuth2 via ADC (Application Default Credentials)."""
    credentials, _ = default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    if not credentials.valid:
        credentials.refresh(Request())
    return credentials.token


def get_function_url() -> str:
    """Obtiene URL de la Cloud Function via gcloud CLI."""
    result = subprocess.run(
        [
            "gcloud",
            "functions",
            "describe",
            "rag-civil-query",
            "--region",
            os.getenv("GCP_REGION", "us-central1"),
            "--format",
            "value(serviceConfig.uri)",
            "--project",
            os.getenv("GCP_PROJECT", "enka-patrimonial-rag"),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    url = result.stdout.strip()
    if not url:
        raise RuntimeError("No se pudo obtener URL de la Cloud Function")
    return url


def post_json(url: str, payload: dict, token: str) -> dict:
    """POST JSON via stdlib urllib."""
    data = json.dumps(payload).encode("utf-8")
    url_parsed = parse.urlparse(url)
    if url_parsed.scheme not in ("http", "https"):
        raise ValueError(f"URL scheme not allowed: {url_parsed.scheme}")
    req = request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Length", str(len(data)))

    with request.urlopen(req, timeout=30) as resp:
        if resp.status == 401:
            raise RuntimeError("401 No autorizado - Verificar IAP y ADC")
        elif resp.status == 403:
            raise RuntimeError("403 Prohibido - Verificar rol IAP en service account")
        elif resp.status != 200:
            raise RuntimeError(f"HTTP {resp.status}: {resp.read().decode()}")
        return json.loads(resp.read().decode())


def validate_response(result: dict) -> dict:
    """Valida respuesta RAG contra criterios de calidad."""
    answer = result.get("answer", "")
    sources = result.get("sources", [])

    citations_found = [
        c
        for c in [
            "SikaGrout",
            "Fase II",
            "ANEXO",
            "Sika Rustex",
            "columnas",
            "carbonatación",
        ]
        if c.lower() in answer.lower()
    ]

    validation = {
        "has_answer": len(result.get("answer", "")) > 50,
        "has_sources": len(result.get("sources", [])) > 0,
        "citations_found": citations_found,
        "source_count": len(sources),
        "latency_ms": result.get("metadata", {}).get("latencyMs", 0),
        "passed": False,
    }

    validation["passed"] = (
        validation["has_answer"]
        and validation["has_sources"]
        and len(validation["citations_found"]) >= 3
        and validation.get("latency_ms", 0) < 5000
    )
    return validation


# -----------------------------------------------------------------------------
# MAIN
# -----------------------------------------------------------------------------
def main():
    os.environ.setdefault("GCP_PROJECT", "enka-patrimonial-rag")
    os.environ.setdefault("GCP_REGION", "us-central1")

    print("=" * 70)
    print("  FASE 26.1 — VALIDACIÓN RAG QUERY (Zero-Copy, SSoT)")
    print("=" * 70)
    print(f"Proyecto: {os.getenv('GCP_PROJECT')}")
    print(
        "Pregunta: ¿Cuáles son las especificaciones técnicas para el uso de SikaGrout Fase II según el Anexo de Patologías?"
    )
    print()

    try:
        # Obtener token ADC
        token = get_adc_token()
        print("✅ ADC token obtenido")

        # Obtener URL de la función
        url = get_function_url()
        print(f"🔗 Endpoint: {url}")

        # Ejecutar consulta
        payload = {
            "question": "¿Cuáles son las especificaciones técnicas para el uso de SikaGrout Fase II según el Anexo de Patologías?",
            "top_k": 5,
            "generate": True,
        }
        print("\n📤 Consultando endpoint...")

        result = post_json(url, payload, token)

        # Mostrar respuesta
        print("\n📥 RESPUESTA RAG:")
        print("-" * 70)
        print(result.get("answer", "SIN RESPUESTA"))
        print("-" * 70)

        # Mostrar fuentes
        sources = result.get("sources", [])
        print(f"\n📚 FUENTES RECUPERADAS ({len(sources)}):")
        for i, src in enumerate(sources, 1):
            print(
                f"   [{i}] Fuente: {src.get('source', 'UNKNOWN')} | Pág: {src.get('page', 'N/A')} | Score: {src.get('score', 0):.4f}"
            )
            preview = src.get("content", "")[:150]
            print(f"       Preview: {preview}...")

        # Validar
        print("\n✅ VALIDACIÓN DE CALIDAD:")
        validation = validate_response(result)

        print(
            f"   Respuesta generada: {'✅' if validation['has_answer'] else '❌'} ({len(result.get('answer', ''))} chars)"
        )
        print(
            f"   Fuentes recuperadas: {'✅' if validation['has_sources'] else '❌'} ({validation['source_count']})"
        )
        print(
            f"   Citas clave: {'✅' if len(validation['citations_found']) >= 3 else '❌'} ({len(validation['citations_found'])}/6)"
        )
        print(f"   Citas: {validation['citations_found']}")
        print(
            f"   Latencia: {'✅' if validation.get('latency_ms', 0) < 5000 else '❌'} ({result.get('metadata', {}).get('latencyMs', 0)} ms)"
        )

        passed = validation["passed"]
        print(f"\n{'🎉 PRUEBA EXITOSA' if passed else '❌ PRUEBA FALLIDA'}")

        # Log Engram (best effort)
        try:
            import datetime
            import subprocess

            subprocess.run(
                [
                    "engram",
                    "save",
                    f"Fase 26.1 RAG Query Validation - {datetime.datetime.now().strftime('%Y-%m-%d')}",
                    f"Validación RAG query endpoint rag-civil-query. Pregunta: SikaGrout Fase II. Pasó: {passed}. Citas: {len([c for c in ['SikaGrout', 'Fase II', 'ANEXO', 'Sika Rustex', 'columnas', 'carbonatación'] if c.lower() in result.get('answer', '').lower()])}/6. Fuentes: {len(result.get('sources', []))}. Latencia: {result.get('metadata', {}).get('latencyMs', 0)}ms. Dominio: Patrimonial (BIC G.O. 39.272) AISLADO.",
                    "--type",
                    "task",
                    "--project",
                    "enka-patrimonial",
                ],
                check=False,
                capture_output=True,
            )
        except Exception as e:
            print(f"⚠️ Engram save failed: {e}")

        sys.exit(0 if passed else 1)

    except subprocess.CalledProcessError as e:
        print(f"❌ Error gcloud: {e.stderr}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
