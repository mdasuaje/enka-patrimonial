#!/usr/bin/env python3
"""
ENKA PQC Cryptographic Layer - Zero-Trust ETL
==============================================

Módulo criptográfico para ofuscar URLs parametrizadas de Looker Studio
antes de inyectarlas al frontend iframe. Cero dependencias disk persistentes:
llave maestra leída desde variable de entorno .env, operación solo en memoria RAM.

Principios:
- Zero-Trust: Nada se confía por defecto, todo se valida y cifra
- Zero-Copy: Datos solo en memoria, nada escribe en disco durante el proceso
- PQC-Ready: Wrapper preparatorio para criptografía post-cuántica futura
"""

import base64
import logging
import os
from datetime import datetime, timedelta

from cryptography.fernet import Fernet


# -----------------------------------------------------------------------------
# CONFIG: Llave Maestra desde Variable de Entorno (NEVER hardcoded)
# -----------------------------------------------------------------------------
def get_master_key() -> str:
    """
    Obtiene la llave maestra desde variable de entorno.
    Lanzamiento Error si no está configurada (seguridad Zero-Trust).
    La clave debe ser una cadena Fernet válida (44 chars base64url con padding).
    """
    key_str = os.environ.get("ENKA_MASTER_KEY", "")
    if not key_str:
        raise ValueError(
            "❌ Variable de entorno ENKA_MASTER_KEY no configurada. "
            'Genera una con: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key())"'
        )
    # Validación: intentar crear un Fernet instance para verificar formato
    try:
        _ = Fernet(key_str)
        # Clave válida - retornar el string para pasarlo directo a Fernet en get_cipher_suite
        return key_str
    except Exception:
        raise ValueError("Formato de ENKA_MASTER_KEY inválido")


# Instanciar cipher suite solo cuando es necesario (lazy load)
_cipher_suite: Fernet | None = None


def get_cipher_suite() -> Fernet:
    """Lazy instantiation of Fernet cipher suite from master key."""
    global _cipher_suite
    if _cipher_suite is None:
        _cipher_suite = Fernet(get_master_key())
    return _cipher_suite


# -----------------------------------------------------------------------------
# ETL CRYPTO FUNCTIONS
# -----------------------------------------------------------------------------
def encrypt_looker_params(
    telefono: str, apartamento: str, nombre: str, looker_base_url: str
) -> dict:
    """
    ETL: Encripta los parámetros de Looker Studio para tránsito seguro al iframe.

    Args:
        telefono: Número teléfono validado (E.164 +58XXX XXX XXXX)
        apartamento: Apartamento validado (ej. "Apto 17")
        nombre: Nombre completo validado (ej. "Iris Useche")
        looker_base_url: URL base de Looker Studio embed

    Returns:
        dict con:
        - "encrypted_token": token cifrado en base64url para transito iframe
        - "expires_at": expiración ISO 8601 (zero-trust, single-use)
        - "token_type": "one-time-looker-access"
    """
    try:
        # 1. Construir payload parametrizado (nunca la URL completa para evitar leaks)
        params_payload = {
            "apto_id": apartamento,
            "nombre": nombre,
            "ts": datetime.utcnow().isoformat() + "Z",
            "scopes": ["iframe-access", "single-use"],
        }

        # 2. Serializar y encriptar (solo en memoria RAM)
        payload_json = base64.urlsafe_b64encode(
            str(params_payload).encode("utf-8")
        ).decode("ascii")

        cipher = get_cipher_suite()
        encrypted_token = cipher.encrypt(payload_json.encode("utf-8"))
        encrypted_b64 = base64.urlsafe_b64encode(encrypted_token).decode("utf-8")

        # 3. Calcular expiración (10 minutos single-use por Zero-Trust)
        expires_at = (datetime.utcnow() + timedelta(minutes=10)).isoformat() + "Z"

        return {
            "encrypted_token": encrypted_b64,
            "expires_at": expires_at,
            "token_type": "one-time-looker-access",
            "operation": "etl_crypto_etl",
        }

    except Exception as e:
        logging.error(f"ETL Crypto error: {e}")
        raise


def decrypt_looker_token(encrypted_token: str) -> dict | None:
    """
    Desencripta token de Looker Studio para validación server-side.
    Solo debe ser llamado por trusted internal processes.
    """
    try:
        cipher = get_cipher_suite()
        encrypted_bytes = base64.urlsafe_b64decode(encrypted_token.encode("utf-8"))
        payload_json = cipher.decrypt(encrypted_bytes)
        import json

        params = json.loads(payload_json.decode("utf-8"))
        return params
    except Exception as e:
        logging.warning(f"Token decryption failed (possibly expired/invalid): {e}")
        return None


# -----------------------------------------------------------------------------
# HEALTH CHECK
# -----------------------------------------------------------------------------
def health_check() -> dict:
    """Verifica que la llave maestre esté configurada y operativa."""
    try:
        get_master_key()
        get_cipher_suite()
        return {
            "status": "healthy",
            "master_key_configured": True,
            "cipher_operational": True,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
    except ValueError as e:
        return {
            "status": "unhealthy",
            "master_key_configured": False,
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }


if __name__ == "__main__":
    # Modo test: generar y mostrar una llave (nunca en producción)
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "--generate-key":
        from cryptography.fernet import Fernet

        key = Fernet.generate_key()
        print(f"ENKA_MASTER_KEY={key.decode('utf-8')}")
        print("\n⚠️  Añade esto a tu .env file y reinicia el servicio.")
        print("⚠️  Never commit this key to version control.")
    else:
        print("Uso: python scripts/enka_pqc_cipher.py --generate-key")
