#!/usr/bin/env python3
"""
FASE 25 — ETL VALIDACIÓN SPREAD CAMBIARIO (BCV vs Real)
=========================================================

Proyecto: GESTIÓN PATRIMONIAL EDIFICIO ENKA (Civil/Arquitectónico)
Base de Datos: BASE_DATOS_CENTRAL_ENKA (Google Sheets)
Propósito: Validar y normalizar montos en USD usando tasa BCV oficial vs tasa real de mercado
           Detectar inconsistencias en aportes vecinales registrados en bolívares.

Ejecutar en: Google Cloud Shell / Vertex AI Workbench / Cloud Run Job
Dependencias: pip install gspread gspread-pandas polars requests python-dotenv
"""

import asyncio
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime

import gspread
import requests
from google.auth import default
from google.auth.transport.requests import Request


# -----------------------------------------------------------------------------
# CONFIGURACIÓN
# -----------------------------------------------------------------------------
@dataclass
class Config:
    # Google Sheets - BASE_DATOS_CENTRAL_ENKA
    SPREADSHEET_ID: str = os.getenv(
        "ENKA_CENTRAL_DB_SHEETS_ID", "REEMPLAZAR_CON_ID_REAL"
    )
    WORKSHEET_APORTES: str = "APORTES_SEPT_2026"  # Hoja con registros de aportes
    WORKSHEET_VECINOS: str = "vecinos_autorizados"  # Hoja con datos de vecinos
    WORKSHEET_AUDIT: str = "AUDITORIA_SPREAD"  # Hoja de auditoría resultados

    # BCV API (Tasa Oficial)
    BCV_API_URL: str = "https://api.bcv.org.ve/tasas"  # Endpoint oficial (ejemplo)
    BCV_FALLBACK_URL: str = (
        "https://pydolarvenezuela-api.vercel.app/api/v1/dollar"  # Fallback
    )

    # Tasa Real de Mercado (Referencia)
    MARKET_API_URL: str = "https://api.exchangerate.host/latest?base=USD&symbols=VES"

    # Umbrales de validación
    MAX_SPREAD_PCT: float = 15.0  # Alertar si spread > 15%
    CRITICAL_SPREAD_PCT: float = 25.0  # Crítico si spread > 25%

    # Configuración general
    PROJECT_ID: str = os.getenv("GCP_PROJECT", "enka-patrimonial-rag")
    REGION: str = os.getenv("GCP_REGION", "us-central1")


# -----------------------------------------------------------------------------
# MODELOS DE DATOS
# -----------------------------------------------------------------------------
@dataclass
class AporteRecord:
    """Registro de aporte vecinal desde BASE_DATOS_CENTRAL_ENKA"""

    apartamento: str
    nombre: str
    telefono: str
    fecha: str
    monto_usd: float
    monto_bs: float  # Monto en bolívares (registrado)
    tasa_usada: float  # Tasa USD/VES usada en el registro
    metodo_pago: str
    referencia: str
    comprobante_url: str
    estado: str  # PENDIENTE, VERIFICADO, RECHAZADO


@dataclass
class SpreadValidation:
    """Resultado de validación de spread cambiario"""

    apartamento: str
    fecha: str
    monto_usd: float
    monto_bs: float
    tasa_registrada: float
    tasa_bcv: float
    tasa_mercado: float
    spread_bcv_pct: float
    spread_mercado_pct: float
    estatus: str  # OK, ALERTA, CRITICO
    observacion: str
    timestamp_validacion: str


# -----------------------------------------------------------------------------
# CLIENTES Y AUTENTICACIÓN
# -----------------------------------------------------------------------------
class SpreadValidator:
    def __init__(self, config: Config):
        self.config = config
        self.gc = None
        self.spreadsheet = None
        self._init_gsheets()

    def _init_gsheets(self):
        """Inicializa cliente Google Sheets con ADC"""
        try:
            credentials, _ = default(
                scopes=[
                    "https://www.googleapis.com/auth/spreadsheets",
                    "https://www.googleapis.com/auth/drive.readonly",
                ]
            )
            # Refrescar token si es necesario
            if credentials.expired:
                credentials.refresh(Request())

            self.gc = gspread.authorize(credentials)
            self.spreadsheet = self.gc.open_by_key(self.config.SPREADSHEET_ID)
            print(f"✅ Conectado a Spreadsheet: {self.config.SPREADSHEET_ID}")
        except Exception as e:
            print(f"❌ Error autenticación Sheets: {e}")
            raise

    def fetch_bcv_rate(self) -> float | None:
        """Obtiene tasa BCV oficial (USD/VES)"""
        # Intentar API oficial BCV
        try:
            resp = requests.get(self.config.BCV_API_URL, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                # Estructura esperada: {"tasa": 36.50, "fecha": "2026-09-07"}
                tasa = float(data.get("tasa", 0))
                if tasa > 0:
                    print(f"📊 Tasa BCV oficial: {tasa:.4f} VES/USD")
                    return tasa
        except Exception as e:
            print(f"⚠️ BCV API falló: {e}")

        # Fallback: pydolarvenezuela
        try:
            resp = requests.get(self.config.BCV_FALLBACK_URL, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                # Estructura: {"bcv": {"price": 36.50, ...}}
                tasa = float(data.get("bcv", {}).get("price", 0))
                if tasa > 0:
                    print(f"📊 Tasa BCV (fallback): {tasa:.4f} VES/USD")
                    return tasa
        except Exception as e:
            print(f"⚠️ Fallback BCV falló: {e}")

        return None

    def fetch_market_rate(self) -> float | None:
        """Obtiene tasa real de mercado (USD/VES)"""
        try:
            resp = requests.get(self.config.MARKET_API_URL, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                tasa = float(data.get("rates", {}).get("VES", 0))
                if tasa > 0:
                    print(f"📈 Tasa Mercado: {tasa:.4f} VES/USD")
                    return tasa
        except Exception as e:
            print(f"⚠️ Mercado API falló: {e}")
        return None

    def load_aportes(self) -> list[AporteRecord]:
        """Carga registros de aportes desde la hoja APORTES_SEPT_2026"""
        try:
            ws = self.spreadsheet.worksheet(self.config.WORKSHEET_APORTES)
            records = ws.get_all_records()

            aportes = []
            for row in records:
                # Normalizar campos (manejar variaciones de nombres de columnas)
                apto = (
                    str(row.get("Apartamento", row.get("apartamento", "")))
                    .strip()
                    .upper()
                )
                if not apto:
                    continue

                aportes.append(
                    AporteRecord(
                        apartamento=apto,
                        nombre=str(
                            row.get("Nombre", row.get("nombre_residente", ""))
                        ).strip(),
                        telefono=str(
                            row.get("Telefono", row.get("telefono", ""))
                        ).strip(),
                        fecha=str(row.get("Fecha", row.get("fecha", ""))).strip(),
                        monto_usd=float(
                            row.get("Monto_USD", row.get("monto_usd", 0)) or 0
                        ),
                        monto_bs=float(
                            row.get("Monto_BS", row.get("monto_bs", 0)) or 0
                        ),
                        tasa_usada=float(
                            row.get("Tasa", row.get("tasa_usada", 0)) or 0
                        ),
                        metodo_pago=str(
                            row.get("Metodo", row.get("metodo_pago", ""))
                        ).strip(),
                        referencia=str(
                            row.get("Referencia", row.get("ref_bancaria", ""))
                        ).strip(),
                        comprobante_url=str(
                            row.get("Comprobante", row.get("comprobante_url", ""))
                        ).strip(),
                        estado=str(row.get("Estado", row.get("estado", "PENDIENTE")))
                        .strip()
                        .upper(),
                    )
                )

            print(f"📋 Cargados {len(aportes)} registros de aportes")
            return aportes

        except gspread.WorksheetNotFound:
            print(f"⚠️ Hoja '{self.config.WORKSHEET_APORTES}' no encontrada")
            return []
        except Exception as e:
            print(f"❌ Error cargando aportes: {e}")
            return []

    def validate_spread(
        self, aporte: AporteRecord, tasa_bcv: float, tasa_mercado: float
    ) -> SpreadValidation:
        """Valida spread entre tasa registrada vs BCV vs Mercado"""
        if aporte.monto_usd <= 0 or aporte.monto_bs <= 0:
            return SpreadValidation(
                apartamento=aporte.apartamento,
                fecha=aporte.fecha,
                monto_usd=aporte.monto_usd,
                monto_bs=aporte.monto_bs,
                tasa_registrada=aporte.tasa_usada,
                tasa_bcv=tasa_bcv,
                tasa_mercado=tasa_mercado,
                spread_bcv_pct=0,
                spread_mercado_pct=0,
                estatus="SIN_DATOS",
                observacion="Monto USD o BS inválido",
                timestamp_validacion=datetime.utcnow().isoformat() + "Z",
            )

        # Calcular tasa implícita del registro
        tasa_implicita = aporte.monto_bs / aporte.monto_usd

        # Spread vs BCV
        spread_bcv = abs(tasa_implicita - tasa_bcv) / tasa_bcv * 100

        # Spread vs Mercado
        spread_mercado = abs(tasa_implicita - tasa_mercado) / tasa_mercado * 100

        # Determinar estatus
        max_spread = max(spread_bcv, spread_mercado)

        if max_spread <= self.config.MAX_SPREAD_PCT:
            estatus = "OK"
            observacion = "Tasa dentro de rango aceptable"
        elif max_spread <= self.config.CRITICAL_SPREAD_PCT:
            estatus = "ALERTA"
            observacion = (
                f"Spread elevado: BCV={spread_bcv:.1f}%, Mercado={spread_mercado:.1f}%"
            )
        else:
            estatus = "CRITICO"
            observacion = (
                f"Spread crítico: BCV={spread_bcv:.1f}%, Mercado={spread_mercado:.1f}%"
            )

        # Si la tasa registrada difiere significativamente de la implícita
        if aporte.tasa_usada > 0:
            diff_registrada = (
                abs(aporte.tasa_usada - tasa_implicita) / tasa_implicita * 100
            )
            if diff_registrada > 5:
                observacion += (
                    f" | Tasa registrada difiere {diff_registrada:.1f}% de la implícita"
                )

        return SpreadValidation(
            apartamento=aporte.apartamento,
            fecha=aporte.fecha,
            monto_usd=aporte.monto_usd,
            monto_bs=aporte.monto_bs,
            tasa_registrada=aporte.tasa_usada,
            tasa_implicita=round(tasa_implicita, 4),
            tasa_bcv=tasa_bcv,
            tasa_mercado=tasa_mercado,
            spread_bcv_pct=round(spread_bcv, 2),
            spread_mercado_pct=round(spread_mercado, 2),
            estatus=estatus,
            observacion=observacion,
            timestamp_validacion=datetime.utcnow().isoformat() + "Z",
        )

    def write_audit_results(self, validations: list[SpreadValidation]):
        """Escribe resultados de auditoría en hoja AUDITORIA_SPREAD"""
        try:
            # Crear hoja si no existe
            try:
                ws = self.spreadsheet.worksheet(self.config.WORKSHEET_AUDIT)
            except gspread.WorksheetNotFound:
                ws = self.spreadsheet.add_worksheet(
                    title=self.config.WORKSHEET_AUDIT, rows=1000, cols=15
                )

            # Headers
            headers = [
                "Timestamp",
                "Apartamento",
                "Fecha_Aporte",
                "Monto_USD",
                "Monto_BS",
                "Tasa_Registrada",
                "Tasa_Implicita",
                "Tasa_BCV",
                "Tasa_Mercado",
                "Spread_BCV_%",
                "Spread_Mercado_%",
                "Estatus",
                "Observacion",
            ]

            # Preparar filas
            rows = [headers]
            for v in validations:
                rows.append(
                    [
                        v.timestamp_validacion,
                        v.apartamento,
                        v.fecha,
                        v.monto_usd,
                        v.monto_bs,
                        v.tasa_registrada,
                        getattr(v, "tasa_implicita", 0),
                        v.tasa_bcv,
                        v.tasa_mercado,
                        v.spread_bcv_pct,
                        v.spread_mercado_pct,
                        v.estatus,
                        v.observacion,
                    ]
                )

            # Escribir (append para mantener histórico)
            ws.append_rows(rows, value_input_option="USER_ENTERED")
            print(
                f"📝 Auditoría escrita: {len(validations)} registros en {self.config.WORKSHEET_AUDIT}"
            )

        except Exception as e:
            print(f"❌ Error escribiendo auditoría: {e}")

    def generate_summary_report(self, validations: list[SpreadValidation]) -> dict:
        """Genera reporte resumen de validaciones"""
        total = len(validations)
        ok = sum(1 for v in validations if v.estatus == "OK")
        alerta = sum(1 for v in validations if v.estatus == "ALERTA")
        critico = sum(1 for v in validations if v.estatus == "CRITICO")
        sin_datos = sum(1 for v in validations if v.estatus == "SIN_DATOS")

        # Promedios de spread (solo válidos)
        valid = [v for v in validations if v.estatus in ("OK", "ALERTA", "CRITICO")]
        avg_spread_bcv = (
            sum(v.spread_bcv_pct for v in valid) / len(valid) if valid else 0
        )
        avg_spread_mercado = (
            sum(v.spread_mercado_pct for v in valid) / len(valid) if valid else 0
        )

        return {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "total_registros": total,
            "distribucion": {
                "OK": ok,
                "ALERTA": alerta,
                "CRITICO": critico,
                "SIN_DATOS": sin_datos,
            },
            "spread_promedio_bcv_pct": round(avg_spread_bcv, 2),
            "spread_promedio_mercado_pct": round(avg_spread_mercado, 2),
            "alertas_detalle": [
                {
                    "apartamento": v.apartamento,
                    "fecha": v.fecha,
                    "spread_bcv": v.spread_bcv_pct,
                    "spread_mercado": v.spread_mercado_pct,
                    "estatus": v.estatus,
                    "observacion": v.observacion,
                }
                for v in validations
                if v.estatus in ("ALERTA", "CRITICO")
            ],
        }


# -----------------------------------------------------------------------------
# MAIN PIPELINE
# -----------------------------------------------------------------------------
async def main():
    config = Config()

    # Validar configuración
    if config.SPREADSHEET_ID == "REEMPLAZAR_CON_ID_REAL":
        print(
            "❌ Configurar ENKA_CENTRAL_DB_SHEETS_ID con el ID real de BASE_DATOS_CENTRAL_ENKA"
        )
        print("   export ENKA_CENTRAL_DB_SHEETS_ID='1abc...XYZ'")
        sys.exit(1)

    print("=" * 60)
    print("  ETL VALIDACIÓN SPREAD CAMBIARIO - ENKA PATRIMONIAL")
    print("=" * 60)
    print(f"Proyecto: {config.PROJECT_ID}")
    print(f"Spreadsheet: {config.SPREADSHEET_ID}")
    print(
        f"Umbrales: Alerta >{config.MAX_SPREAD_PCT}% | Crítico >{config.CRITICAL_SPREAD_PCT}%"
    )
    print()

    validator = SpreadValidator(config)

    # 1. Obtener tasas actuales
    print("\n🔄 Obteniendo tasas de cambio...")
    tasa_bcv = validator.fetch_bcv_rate()
    tasa_mercado = validator.fetch_market_rate()

    if not tasa_bcv:
        print("❌ No se pudo obtener tasa BCV. Abortando.")
        sys.exit(1)

    if not tasa_mercado:
        print("⚠️ Tasa mercado no disponible, usando solo BCV")
        tasa_mercado = tasa_bcv

    print(f"   BCV: {tasa_bcv:.4f} VES/USD")
    print(f"   Mercado: {tasa_mercado:.4f} VES/USD")
    print(
        f"   Spread BCV-Mercado: {abs(tasa_bcv - tasa_mercado) / tasa_bcv * 100:.2f}%"
    )

    # 2. Cargar aportes
    print("\n📥 Cargando registros de BASE_DATOS_CENTRAL_ENKA...")
    aportes = validator.load_aportes()

    if not aportes:
        print("⚠️ No hay registros para validar")
        return

    # 3. Validar cada registro
    print(f"\n🔍 Validando {len(aportes)} registros...")
    validations = []
    for aporte in aportes:
        validation = validator.validate_spread(aporte, tasa_bcv, tasa_mercado)
        validations.append(validation)

        status_icon = {
            "OK": "✅",
            "ALERTA": "⚠️",
            "CRITICO": "🔴",
            "SIN_DATOS": "⚪",
        }.get(validation.estatus, "❓")
        print(
            f"   {status_icon} Apt {validation.apartamento} | Spread BCV: {validation.spread_bcv_pct:.1f}% | {validation.estatus}"
        )

    # 4. Escribir auditoría
    print("\n📝 Escribiendo auditoría en Spreadsheet...")
    validator.write_audit_results(validations)

    # 5. Generar reporte resumen
    summary = validator.generate_summary_report(validations)

    print("\n" + "=" * 60)
    print("  RESUMEN DE VALIDACIÓN SPREAD CAMBIARIO")
    print("=" * 60)
    print(f"Total registros: {summary['total_registros']}")
    print(f"✅ OK: {summary['distribucion']['OK']}")
    print(f"⚠️ ALERTA: {summary['distribucion']['ALERTA']}")
    print(f"🔴 CRÍTICO: {summary['distribucion']['CRITICO']}")
    print(f"⚪ SIN DATOS: {summary['distribucion']['SIN_DATOS']}")
    print(f"Spread promedio vs BCV: {summary['spread_promedio_bcv_pct']:.2f}%")
    print(f"Spread promedio vs Mercado: {summary['spread_promedio_mercado_pct']:.2f}%")

    if summary["alertas_detalle"]:
        print(f"\n🚨 ALERTAS DETECTADAS ({len(summary['alertas_detalle'])}):")
        for a in summary["alertas_detalle"]:
            print(
                f"   🔴 Apt {a['apartamento']} ({a['fecha']}) | BCV: {a['spread_bcv']:.1f}% | Mercado: {a['spread_mercado']:.1f}% | {a['estatus']}"
            )
            print(f"      {a['observacion']}")

    # Guardar reporte JSON para trazabilidad (usar directorio seguro)
    import tempfile

    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".json",
        prefix="spread_validation_",
        delete=False,
        dir=tempfile.gettempdir(),
    ) as tmp:
        json.dump(summary, tmp, indent=2, ensure_ascii=False)
        report_path = tmp.name
    print(f"\n💾 Reporte JSON guardado: {report_path}")

    # Registrar en Engram
    try:
        import subprocess

        subprocess.run(
            [
                "engram",
                "save",
                f"ETL Spread Cambiario - {datetime.now().strftime('%Y-%m-%d')}",
                f"Validación {len(aportes)} registros BASE_DATOS_CENTRAL_ENKA. "
                f"BCV: {tasa_bcv:.4f}, Mercado: {tasa_mercado:.4f}. "
                f"OK: {summary['distribucion']['OK']}, ALERTA: {summary['distribucion']['ALERTA']}, "
                f"CRITICO: {summary['distribucion']['CRITICO']}. "
                f"Spread promedio BCV: {summary['spread_promedio_bcv_pct']:.2f}%.",
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

    print("\n✅ ETL COMPLETADO")


if __name__ == "__main__":
    asyncio.run(main())
