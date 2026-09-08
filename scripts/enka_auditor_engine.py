#!/usr/bin/env python3
import logging
import os
import sqlite3
import tempfile

# Ephemeral database for Zero-Copy compliance (destroyed on reboot/make clean-vault)
DB_PATH = os.path.join(tempfile.gettempdir(), 'enka_patrimonial_vault.db')  # nosec: intentional ephemeral storage for Zero-Copy
SCHEMA_PATH = os.path.expanduser("~/workspaces/enka-patrimonial/design/enka_local_fts5.sql")
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")


class EnkaAuditorEngine:
    def __init__(self):
        self.conn = sqlite3.connect(DB_PATH)
        self.cursor = self.conn.cursor()

    def inicializar_boveda(self):
        if os.path.exists(SCHEMA_PATH):
            try:
                with open(SCHEMA_PATH, encoding='utf-8') as f:
                    self.cursor.executescript(f.read())
                self.conn.commit()
                logging.info("🛡️ [ENKA-System] Bóveda efímera FTS5 inicializada (Zero-Copy).")
            except OSError as e:
                logging.error(f"❌ Error leyendo schema: {e}")
                raise

    def inyectar_ssot_cache(self):
        datos_fin = [
            ("Apto 17", "Iris Useche", 45.0, "BNC-9912", "Sep 04, 2026"),
            ("Apto 05", "Gregory Rodríguez", 60.0, "BNC-8831", "Sep 05, 2026"),
            ("Apto 12", "María González", 30.0, "BNC-7745", "Sep 03, 2026")
        ]
        try:
            self.cursor.executemany(
                "INSERT INTO financiero_caja_chica (apto_id, residente_nombre, monto_usd, referencia_bnc, fecha_pago) VALUES (?, ?, ?, ?, ?)", datos_fin
            )
            self.conn.commit()
            logging.info("⚡ [SSoT-In-Memory] Matriz financiera simulada cargada.")
        except sqlite3.IntegrityError:
            pass

        # Demo arquitectónico
        datos_arq = [
            ("Sep 01, 2026", "Fase II", "Columna corta eje 3", "Carbonatación avanzada con armadura expuesta. Tratamiento con Sika Rustex + SikaGrout 212.", "Gregory Rodríguez"),
            ("Sep 03, 2026", "Fase II", "Friso entrada principal", "Desprendimiento de revoque por humedad capilar. Reposición con mortero transpirable.", "Gregory Rodríguez"),
            ("Sep 05, 2026", "Fase III", "Hito herrería Av. Fermín Toro", "Oxidación severa en ornamentos Art Decó. Requiere desoxidación y protección catódica.", "Gregory Rodríguez"),
        ]
        try:
            self.cursor.executemany(
                "INSERT INTO arquitectonico_registro (fecha_suceso, fase_intervencion, componente_estructural, diagnostico_patologia, maestro_obra) VALUES (?, ?, ?, ?, ?)", datos_arq
            )
            self.conn.commit()
            logging.info("⚡ [SSoT-In-Memory] Matriz arquitectónica simulada cargada.")
        except sqlite3.IntegrityError:
            pass

    def buscar_financiero(self, termino: str) -> list:
        """Búsqueda FTS5 en dominio financiero (parameterized query)."""
        query = """
        SELECT fc.apto_id, fc.residente_nombre, fc.monto_usd, fc.referencia_bnc, fc.fecha_pago, fc.estado_conciliacion
        FROM financiero_caja_chica fc
        JOIN v_financiero_index vi ON fc.id_tx = vi.id_tx
        WHERE v_financiero_index MATCH ?
        ORDER BY fc.fecha_pago DESC
        """
        # Parameterized query to prevent SQL injection
        self.cursor.execute(query, (termino,))
        return self.cursor.fetchall()

    def buscar_arquitectonico(self, termino: str) -> list:
        """Búsqueda FTS5 en dominio arquitectónico (parameterized query)."""
        query = """
        SELECT ar.fecha_suceso, ar.fase_intervencion, ar.componente_estructural, ar.diagnostico_patologia, ar.maestro_obra
        FROM arquitectonico_registro ar
        JOIN v_arquitectonico_index vi ON ar.id_suceso = vi.id_suceso
        WHERE v_arquitectonico_index MATCH ?
        ORDER BY ar.fecha_suceso DESC
        """
        # Parameterized query to prevent SQL injection
        self.cursor.execute(query, (termino,))
        return self.cursor.fetchall()

    def insertar_arquitectonico(self, fecha: str, fase: str, componente: str, diagnostico: str, maestro: str = 'Gregory Rodríguez'):
        """Inserta registro arquitectónico y actualiza índice FTS5 automáticamente."""
        # Parameterized query to prevent SQL injection
        self.cursor.execute(
            "INSERT INTO arquitectonico_registro (fecha_suceso, fase_intervencion, componente_estructural, diagnostico_patologia, maestro_obra) VALUES (?, ?, ?, ?, ?)",
            (fecha, fase, componente, diagnostico, maestro)
        )
        self.conn.commit()
        logging.info(f"✅ [Arquitectónico] Registro insertado: {componente} - {diagnostico[:50]}...")

    def cerrar(self):
        self.conn.close()


if __name__ == "__main__":
    auditor = EnkaAuditorEngine()
    auditor.inicializar_boveda()
    auditor.inyectar_ssot_cache()

    # Demo búsqueda
    print("\n🔍 Búsqueda financiera 'Iris':")
    for r in auditor.buscar_financiero("Iris"):
        print(f"  {r}")

    print("\n🔍 Búsqueda arquitectónica 'columna':")
    for r in auditor.buscar_arquitectonico("columna"):
        print(f"  {r}")

    auditor.cerrar()
