PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- DOMINIO 1: EXPEDIENTE TÉCNICO (BIC G.O. 39.272)
CREATE TABLE IF NOT EXISTS arquitectonico_registro (
    id_suceso INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha_suceso TEXT NOT NULL,
    fase_intervencion TEXT,
    componente_estructural TEXT NOT NULL,
    diagnostico_patologia TEXT NOT NULL,
    maestro_obra TEXT DEFAULT 'Gregory Rodríguez'
);
CREATE VIRTUAL TABLE IF NOT EXISTS v_arquitectonico_index USING fts5(
    id_suceso UNINDEXED, componente_estructural, diagnostico_patologia, tokenize='porter'
);
CREATE TRIGGER IF NOT EXISTS ai_arquitectonico_after_insert AFTER INSERT ON arquitectonico_registro BEGIN
    INSERT INTO v_arquitectonico_index(id_suceso, componente_estructural, diagnostico_patologia)
    VALUES (new.id_suceso, new.componente_estructural, new.diagnostico_patologia);
END;

-- DOMINIO 2: NÚCLEO FINANCIERO (CAJA CHICA)
CREATE TABLE IF NOT EXISTS financiero_caja_chica (
    id_tx INTEGER PRIMARY KEY AUTOINCREMENT,
    apto_id TEXT NOT NULL,
    residente_nombre TEXT NOT NULL,
    monto_usd REAL NOT NULL,
    referencia_bnc TEXT,
    fecha_pago TEXT NOT NULL,
    estado_conciliacion TEXT DEFAULT 'Pendiente'
);
CREATE VIRTUAL TABLE IF NOT EXISTS v_financiero_index USING fts5(
    id_tx UNINDEXED, apto_id, residente_nombre, referencia_bnc, tokenize='porter'
);
CREATE TRIGGER IF NOT EXISTS ai_financiero_after_insert AFTER INSERT ON financiero_caja_chica BEGIN
    INSERT INTO v_financiero_index(id_tx, apto_id, residente_nombre, referencia_bnc)
    VALUES (new.id_tx, new.apto_id, new.residente_nombre, new.referencia_bnc);
END;