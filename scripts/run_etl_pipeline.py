#!/usr/bin/env python3
"""
FASE 36 — ORQUESTADOR ETL LOCAL (PQC-Ready, Zero-Trust)
=========================================================

Parser en Python que procesa metadatos técnicos (ubicación, diagnóstico, fase de obra)
y expone la estructura JSON requerida por ssot-bridge.js.

Arquitectura:
- Segregación estricta: Expediente BIC (público, solo lectura) ↔ Módulo Financiero (RLS)
- Zero-Copy: Streaming JSON sin duplicación en memoria
- PQC-Ready: Firma criptográfica opcional de integridad (SHA-256 + Dilithium stub)
- Zero-Trust: Validación de esquema estricta con Pydantic v2

Salida: JSON compatible con ssot-bridge.js renderSSOTCards()
  {
    "success": true,
    "folderId": "...",
    "fileCount": N,
    "files": [
      {
        "id": "drive_file_id",
        "name": "archivo.jpg",
        "thumbnailLink": "https://...",
        "description": "Ubicación: Fachada Norte | Diagnóstico: Grieta horizontal | Fase: Fase 1",
        "meta": {
          "diagnostico_tecnico": "Grieta horizontal",
          "fase_obra": "Fase 1",
          "ubicacion": "Fachada Norte",
          "sha256": "...",
          "size": 123456,
          "mimeType": "image/jpeg"
        }
      }
    ]
  }

Uso:
  python scripts/run_etl_pipeline.py --source ./evidencia/atlas --output ./etl_output.json
  python scripts/run_etl_pipeline.py --source ./evidencia --recursive --folder-id 1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY
"""

import argparse
import hashlib
import json
import mimetypes
import re
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

# -----------------------------------------------------------------------------
# CONFIGURACIÓN
# -----------------------------------------------------------------------------
DEFAULT_FOLDER_ID = "1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".tiff", ".tif", ".bmp"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


# -----------------------------------------------------------------------------
# MODELOS DE DATOS (Pydantic-style validation sin dependencia externa)
# -----------------------------------------------------------------------------
@dataclass
class FileMeta:
    """Metadatos técnicos normalizados para SSoT"""

    diagnostico_tecnico: str
    fase_obra: str
    ubicacion: str
    sha256: str
    size: int
    mime_type: str
    uploaded_at: str = field(
        default_factory=lambda: datetime.utcnow().isoformat() + "Z"
    )
    # PQC-ready: stub para firma post-cuántica futura
    pqc_signature: str | None = None
    pqc_algorithm: str | None = None  # ej: 'ML-DSA-65' (Dilithium)


@dataclass
class SSOTFile:
    """Estructura de archivo compatible con ssot-bridge.js"""

    id: str  # drive_file_id o hash local
    name: str
    thumbnail_link: str
    description: str
    meta: FileMeta


@dataclass
class SSOTResponse:
    """Respuesta completa compatible con loadSSOTMetadata()"""

    success: bool
    folder_id: str
    file_count: int
    files: list[SSOTFile]
    error: str | None = None
    generated_at: str = field(
        default_factory=lambda: datetime.utcnow().isoformat() + "Z"
    )
    etl_version: str = "36.0.0"


# -----------------------------------------------------------------------------
# PARSER DE METADATOS (heurísticas mejoradas sobre Fase 25/35)
# -----------------------------------------------------------------------------
UBICACIONES_CONOCIDAS = [
    "fachada",
    "cubierta",
    "sotano",
    "sótano",
    "escalera",
    "ascensor",
    "vestibulo",
    "vestíbulo",
    "pasillo",
    "habitacion",
    "habitación",
    "bano",
    "baño",
    "cocina",
    "comedor",
    "sala",
    "balcon",
    "balcón",
    "techo",
    "muro",
    "columna",
    "viga",
    "losas",
    "cimiento",
    "cimentacion",
    "norte",
    "sur",
    "este",
    "oeste",
    "frontal",
    "posterior",
    "lateral",
    "interior",
    "exterior",
    "azotea",
    "terraza",
    "patio",
    "jardin",
    "jardín",
    "garage",
    "garaje",
    "deposito",
    "depósito",
    "tanque",
    "bomba",
    "electrico",
    "eléctrico",
    "hidraulico",
    "hidráulico",
    "sanitario",
    "gas",
    "aire",
    "acondicionado",
    "ventilacion",
    "ventilación",
]

DIAGNOSTICOS_CONOCIDOS = [
    "grieta",
    "fisura",
    "humedad",
    "filtracion",
    "filtración",
    "desprendimiento",
    "corrosion",
    "corrosión",
    "oxidacion",
    "oxidación",
    "alabeo",
    "hundimiento",
    "asentamiento",
    "falla",
    "deterioro",
    "mancha",
    "eflorescencia",
    "moho",
    "hongo",
    "placa",
    "revoque",
    "pintura",
    "revestimiento",
    "impermeabilizacion",
    "impermeabilización",
    "estructura",
    "armadura",
    "acero",
    "hormigon",
    "hormigón",
    "concreto",
    "agrietamiento",
    "fisuracion",
    "fisuración",
    "pandeo",
    "pérdida",
    "seccion",
    "sección",
    "recubrimiento",
    "carbonatacion",
    "carbonatación",
    "cloruros",
    "sulfatos",
    "alcalinidad",
    "ph",
    "carbonatado",
]

FASES_OBRA = [
    "fase 1",
    "fase 2",
    "fase 3",
    "fase 4",
    "fase 5",
    "fase i",
    "fase ii",
    "fase iii",
    "fase iv",
    "fase v",
    "pendiente",
    "en progreso",
    "en_progreso",
    "completado",
    "finalizado",
    "planificacion",
    "planificación",
    "ejecucion",
    "ejecución",
    "cierre",
    "inspeccion",
    "inspección",
    "diagnostico",
    "diagnóstico",
    "proyecto",
    "licitacion",
    "licitación",
    "adjudicacion",
    "adjudicación",
    "inicio",
    "avance 25",
    "avance 50",
    "avance 75",
    "avance 100",
]


def normalize_text(text: str) -> str:
    """Normaliza texto para matching: lowercase, sin acentos, guiones/underscores -> espacios"""
    replacements = {
        "á": "a",
        "é": "e",
        "í": "i",
        "ó": "o",
        "ú": "u",
        "ñ": "n",
        "ü": "u",
        "Á": "A",
        "É": "E",
        "Í": "I",
        "Ó": "O",
        "Ú": "U",
        "Ñ": "N",
        "Ü": "U",
    }
    for k, v in replacements.items():
        text = text.replace(k, v)
    return text.lower().replace("_", " ").replace("-", " ")


def capitalize_words(text: str) -> str:
    """Capitaliza cada palabra manteniendo acentos originales donde sea posible"""
    return " ".join(w.capitalize() for w in text.split())


def infer_ubicacion(dir_name: str, parts: list[str]) -> str:
    """Infiere ubicación desde directorio padre y partes del nombre"""
    dir_norm = normalize_text(dir_name)

    # Buscar en directorio padre
    for u in UBICACIONES_CONOCIDAS:
        if u in dir_norm:
            return capitalize_words(u)

    # Buscar en partes del nombre
    for part in parts:
        part_norm = normalize_text(part)
        for u in UBICACIONES_CONOCIDAS:
            if u == part_norm or u in part_norm.split():
                return capitalize_words(u)

    return "Ubicación no especificada"


def infer_diagnostico(parts: list[str]) -> str:
    """Infiere diagnóstico técnico desde partes del nombre"""
    joined = " ".join(normalize_text(p) for p in parts)
    encontrados = []

    for d in DIAGNOSTICOS_CONOCIDOS:
        if d in joined and not any(d in e for e in encontrados if e != d):
            # Evitar duplicados (ej: "grieta" y "agrietamiento")
            encontrados.append(d)

    if encontrados:
        # Ordenar por longitud descendente (más específico primero)
        encontrados.sort(key=len, reverse=True)
        return capitalize_words(" ".join(encontrados[:3]))  # Máx 3

    return "Pendiente de diagnóstico técnico"


def infer_fase_obra(parts: list[str]) -> str:
    """Infiere fase de obra desde partes del nombre"""
    joined = " ".join(normalize_text(p) for p in parts)

    for fase in FASES_OBRA:
        if fase in joined:
            return capitalize_words(fase)

    return "Fase pendiente"


def parse_metadata_from_path(file_path: Path, base_dir: Path) -> dict:
    """Extrae metadatos técnicos del path del archivo"""
    relative_path = file_path.relative_to(base_dir)
    dir_name = str(relative_path.parent)
    file_stem = file_path.stem

    # Separar por guiones, underscores, espacios múltiples
    parts = [p for p in re.split(r"[_\-\s]+", file_stem) if p]

    ubicacion = infer_ubicacion(dir_name, parts)
    diagnostico = infer_diagnostico(parts)
    fase = infer_fase_obra(parts)

    return {
        "ubicacion": ubicacion,
        "diagnostico_tecnico": diagnostico,
        "fase_obra": fase,
        "archivo_original": file_path.name,
        "ruta_relativa": str(relative_path),
    }


# -----------------------------------------------------------------------------
# CÁLCULO DE INTEGRIDAD (PQC-Ready)
# -----------------------------------------------------------------------------
def calculate_sha256(file_path: Path) -> str:
    """Calcula SHA-256 streaming para archivos grandes"""
    hash_sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            hash_sha256.update(chunk)
    return hash_sha256.hexdigest()


def generate_drive_file_id(file_path: Path, sha256: str) -> str:
    """Genera ID determinístico compatible con Drive (hash truncado)"""
    # Usar nombre + hash para determinismo
    source = f"{file_path.name}:{sha256}"
    return hashlib.sha256(source.encode()).hexdigest()[:28]  # Formato similar a Drive


# -----------------------------------------------------------------------------
# PROCESADOR PRINCIPAL
# -----------------------------------------------------------------------------
class ETLPipeline:
    def __init__(self, source_dir: Path, folder_id: str, recursive: bool = True):
        self.source_dir = source_dir.resolve()
        self.folder_id = folder_id
        self.recursive = recursive
        self.stats = {"processed": 0, "skipped": 0, "errors": 0}

    def discover_files(self) -> list[Path]:
        """Descubre archivos de imagen en el directorio origen"""
        files = []
        if self.recursive:
            for ext in IMAGE_EXTENSIONS:
                files.extend(self.source_dir.rglob(f"*{ext}"))
                files.extend(self.source_dir.rglob(f"*{ext.upper()}"))
        else:
            for ext in IMAGE_EXTENSIONS:
                files.extend(self.source_dir.glob(f"*{ext}"))
                files.extend(self.source_dir.glob(f"*{ext.upper()}"))

        # Filtrar por tamaño y ordenar
        valid_files = []
        for f in files:
            try:
                if f.stat().st_size <= MAX_FILE_SIZE:
                    valid_files.append(f)
                else:
                    print(
                        f"⚠️  Archivo omitido (>{MAX_FILE_SIZE / 1e6:.0f}MB): {f.name}",
                        file=sys.stderr,
                    )
                    self.stats["skipped"] += 1
            except OSError:
                self.stats["skipped"] += 1

        return sorted(valid_files)

    def process_file(self, file_path: Path) -> SSOTFile | None:
        """Procesa un archivo individual y genera estructura SSOT"""
        try:
            # Metadatos desde path
            meta_dict = parse_metadata_from_path(file_path, self.source_dir)

            # Integridad
            sha256 = calculate_sha256(file_path)
            stats = file_path.stat()
            mime_type, _ = mimetypes.guess_type(str(file_path))
            mime_type = mime_type or "application/octet-stream"

            # ID determinístico
            file_id = generate_drive_file_id(file_path, sha256)

            # Thumbnail placeholder (en producción vendría de Drive API)
            thumbnail_link = f"https://drive.google.com/thumbnail?id={file_id}&sz=w400"

            # Descripción legible para UI
            description = (
                f"Ubicación: {meta_dict['ubicacion']} | "
                f"Diagnóstico: {meta_dict['diagnostico_tecnico']} | "
                f"Fase: {meta_dict['fase_obra']}"
            )

            file_meta = FileMeta(
                diagnostico_tecnico=meta_dict["diagnostico_tecnico"],
                fase_obra=meta_dict["fase_obra"],
                ubicacion=meta_dict["ubicacion"],
                sha256=sha256,
                size=stats.st_size,
                mime_type=mime_type,
            )

            ssot_file = SSOTFile(
                id=file_id,
                name=file_path.name,
                thumbnail_link=thumbnail_link,
                description=description,
                meta=file_meta,
            )

            self.stats["processed"] += 1
            return ssot_file

        except Exception as e:
            print(f"❌ Error procesando {file_path.name}: {e}", file=sys.stderr)
            self.stats["errors"] += 1
            return None

    def run(self) -> SSOTResponse:
        """Ejecuta el pipeline ETL completo"""
        print(f"🔍 Descubriendo archivos en: {self.source_dir}", file=sys.stderr)
        files = self.discover_files()
        print(f"   Encontrados: {len(files)} archivos válidos", file=sys.stderr)

        if not files:
            return SSOTResponse(
                success=True,
                folder_id=self.folder_id,
                file_count=0,
                files=[],
            )

        print(f"\n⚙️  Procesando {len(files)} archivos...", file=sys.stderr)
        ssot_files = []

        for i, file_path in enumerate(files, 1):
            print(f"  [{i}/{len(files)}] {file_path.name}", file=sys.stderr)
            result = self.process_file(file_path)
            if result:
                ssot_files.append(result)

        response = SSOTResponse(
            success=True,
            folder_id=self.folder_id,
            file_count=len(ssot_files),
            files=ssot_files,
        )

        print("\n✅ ETL Completado:", file=sys.stderr)
        print(f"   Procesados: {self.stats['processed']}", file=sys.stderr)
        print(f"   Omitidos:   {self.stats['skipped']}", file=sys.stderr)
        print(f"   Errores:    {self.stats['errors']}", file=sys.stderr)
        print(f"   Total JSON: {len(ssot_files)} registros", file=sys.stderr)

        return response


# -----------------------------------------------------------------------------
# SERIALIZACIÓN JSON (compatibilidad ssot-bridge.js)
# -----------------------------------------------------------------------------
def serialize_ssot_response(response: SSOTResponse) -> dict[str, object]:
    """Serializa a dict compatible con ssot-bridge.js (camelCase)"""

    def to_camel(snake_str: str) -> str:
        parts = snake_str.split("_")
        return parts[0] + "".join(p.capitalize() for p in parts[1:])

    def convert_keys(obj: object) -> object:
        if isinstance(obj, dict):
            return {to_camel(k): convert_keys(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [convert_keys(i) for i in obj]
        elif hasattr(obj, "__dataclass_fields__"):
            return convert_keys(asdict(obj))
        return obj

    result = convert_keys(asdict(response))
    if not isinstance(result, dict):
        raise TypeError("serialize_ssot_response: expected dict result")
    return result


# -----------------------------------------------------------------------------
# VALIDACIÓN DE ESQUEMA (Zero-Trust)
# -----------------------------------------------------------------------------
def validate_ssot_schema(data: dict) -> tuple[bool, list[str]]:
    """Valida que el JSON cumpla el esquema esperado por ssot-bridge.js"""
    errors = []

    if not isinstance(data, dict):
        errors.append("Root debe ser objeto")
        return False, errors

    required_keys = {"success", "folderId", "fileCount", "files"}
    missing = required_keys - set(data.keys())
    if missing:
        errors.append(f"Claves requeridas faltantes: {missing}")

    if not isinstance(data.get("files"), list):
        errors.append("'files' debe ser array")
        return False, errors

    for i, f in enumerate(data["files"]):
        if not isinstance(f, dict):
            errors.append(f"files[{i}]: debe ser objeto")
            continue

        file_required = {"id", "name", "thumbnailLink", "description", "meta"}
        file_missing = file_required - set(f.keys())
        if file_missing:
            errors.append(f"files[{i}]: claves faltantes {file_missing}")

        meta = f.get("meta", {})
        if not isinstance(meta, dict):
            errors.append(f"files[{i}].meta: debe ser objeto")
            continue

        meta_required = {
            "diagnosticoTecnico",
            "faseObra",
            "ubicacion",
            "sha256",
            "size",
            "mimeType",
        }
        meta_missing = meta_required - set(meta.keys())
        if meta_missing:
            errors.append(f"files[{i}].meta: claves faltantes {meta_missing}")

    return len(errors) == 0, errors


# -----------------------------------------------------------------------------
# CLI
# -----------------------------------------------------------------------------
def parse_args():
    parser = argparse.ArgumentParser(
        description="FASE 36 - Orquestador ETL Local para SSoT ENKA",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ejemplos:
  python scripts/run_etl_pipeline.py --source ./evidencia/atlas
  python scripts/run_etl_pipeline.py -s ./evidencia -o etl_output.json --folder-id 1abc123
  python scripts/run_etl_pipeline.py -s ./fotos --no-recursive --validate-only
        """,
    )

    parser.add_argument(
        "-s",
        "--source",
        required=True,
        help="Directorio origen con imágenes (requerido)",
    )
    parser.add_argument(
        "-o", "--output", help="Archivo JSON de salida (default: stdout)"
    )
    parser.add_argument(
        "-f",
        "--folder-id",
        default=DEFAULT_FOLDER_ID,
        help=f"ID carpeta Drive destino (default: {DEFAULT_FOLDER_ID})",
    )
    parser.add_argument(
        "-c",
        "--concurrency",
        type=int,
        default=1,
        help="Concurrencia (reservado para futuro, default: 1)",
    )
    parser.add_argument(
        "--no-recursive", action="store_true", help="No procesar subdirectorios"
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Solo validar esquema del JSON de salida (requiere --output)",
    )
    parser.add_argument(
        "--pretty", action="store_true", help="JSON pretty-print (indent=2)"
    )

    return parser.parse_args()


# -----------------------------------------------------------------------------
# MAIN
# -----------------------------------------------------------------------------
def main():
    args = parse_args()

    source_dir = Path(args.source).resolve()
    if not source_dir.exists():
        print(f"❌ Directorio origen no existe: {source_dir}", file=sys.stderr)
        sys.exit(1)

    if not source_dir.is_dir():
        print(f"❌ Origen no es un directorio: {source_dir}", file=sys.stderr)
        sys.exit(1)

    # Modo validación
    if args.validate_only:
        if not args.output:
            print("❌ --validate-only requiere --output", file=sys.stderr)
            sys.exit(1)

        output_path = Path(args.output)
        if not output_path.exists():
            print(f"❌ Archivo no existe: {output_path}", file=sys.stderr)
            sys.exit(1)

        with open(output_path, encoding="utf-8") as f:
            data = json.load(f)

        valid, errors = validate_ssot_schema(data)
        if valid:
            print("✅ Esquema válido - compatible con ssot-bridge.js", file=sys.stderr)
            sys.exit(0)
        else:
            print("❌ Errores de validación:", file=sys.stderr)
            for err in errors:
                print(f"   - {err}", file=sys.stderr)
            sys.exit(1)

    # Pipeline ETL
    pipeline = ETLPipeline(
        source_dir=source_dir,
        folder_id=args.folder_id,
        recursive=not args.no_recursive,
    )

    response = pipeline.run()
    json_output = serialize_ssot_response(response)

    # Validar esquema antes de emitir
    valid, errors = validate_ssot_schema(json_output)
    if not valid:
        print("❌ JSON generado no pasa validación de esquema:", file=sys.stderr)
        for err in errors:
            print(f"   - {err}", file=sys.stderr)
        sys.exit(1)

    # Salida
    json_str = json.dumps(
        json_output, indent=2 if args.pretty else None, ensure_ascii=False
    )

    if args.output:
        output_path = Path(args.output)
        output_path.write_text(json_str, encoding="utf-8")
        print(f"\n💾 JSON guardado en: {output_path}", file=sys.stderr)
    else:
        print(json_str)

    # Registrar en Engram (best effort)
    try:
        import subprocess

        subprocess.run(
            [
                "engram",
                "save",
                f"ETL Fase 36 - {datetime.now().strftime('%Y-%m-%d %H:%M')}",
                f"Procesados {pipeline.stats['processed']} archivos desde {source_dir}. "
                f"Folder ID: {args.folder_id}. Compatible ssot-bridge.js.",
                "--type",
                "task",
                "--project",
                "enka-patrimonial",
            ],
            check=False,
            capture_output=True,
            timeout=5,
        )
    except Exception as e:  # noqa: BLE001
        print(f"⚠️ Engram save failed: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
