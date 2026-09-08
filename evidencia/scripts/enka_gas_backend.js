/**
 * ENKA Patrimonial — Google Apps Script Backend (Serverless)
 *
 * Arquitectura: Google Sheets (DB) + Forms (Ingesta) + Apps Script (Logic) + Looker Studio (BI)
 * Seguridad: RLS por correo_propietario, Admin whitelist, Auditoría completa
 *
 * INSTRUCCIONES DE DESPLIEGUE:
 * 1. Abrir Spreadsheet "ENKA_DATOS_SEPT_2026" → Extensions → Apps Script
 * 2. Copiar este archivo completo al editor (Code.gs)
 * 3. Configurar Script Properties (⚙️ Settings → Script Properties):
 *    - ADMIN_EMAILS: ["admin1@dominio.com","admin2@dominio.com"]
 *    - SPREADSHEET_ID: (se auto-detecta con SpreadsheetApp.getActiveSpreadsheet().getId())
 *    - FORM_ID: (ID del Google Form creado)
 * 4. Deploy → New deployment → Type: Web App → Execute as: Me → Who has access: Anyone
 * 5. Copiar Web App URL para Looker Studio Community Connector
 * 6. Triggers (⏰ Triggers):
 *    - onFormSubmit: From spreadsheet, On form submit
 *    - dailySummaryTrigger: Time-driven, Day timer, 08:00 AM
 */

// ============================================================
// CONFIGURACIÓN Y CONSTANTES
// ============================================================

const CONFIG = {
  SHEETS: {
    APORTES: "APORTES_SEPT_2026",
    GASTOS: "GASTOS_OBRA",
    ESTATUS: "ESTATUS_FASES",
    AUDITORIA: "AUDITORIA",
  },
  COLUMNS: {
    APORTES: [
      "timestamp",
      "apartamento",
      "nombre_residente",
      "correo_propietario",
      "concepto",
      "metodo_pago",
      "monto_usd",
      "ref_bancaria",
      "comprobante_url",
      "estado",
      "verificado_por",
      "verificado_en",
    ],
    GASTOS: [
      "fecha",
      "fase",
      "concepto",
      "proveedor",
      "monto_usd",
      "categoria",
      "comprobante_url",
      "aprobado_por",
    ],
    ESTATUS: [
      "fase",
      "estado",
      "porcentaje",
      "ultima_actualizacion",
      "presupuesto_usd",
      "ejecutado_usd",
    ],
    AUDITORIA: ["timestamp", "accion", "usuario", "detalle_json"],
  },
  ENUMS: {
    CONCEPTO: ["APORTE_SEPT", "DEUDA_ANTERIOR", "RESERVA", "OTRO"],
    METODO_PAGO: ["PAGO_MOVIL", "TRANSFERENCIA", "EFECTIVO", "OTRO"],
    ESTADO: ["PENDIENTE", "VERIFICADO", "RECHAZADO"],
    FASE: ["FASE_I", "FASE_II", "FASE_III"],
    CATEGORIA_GASTO: ["MATERIALES", "MANO_OBRA", "SERVICIOS", "ADMINISTRATIVO"],
  },
  APARTAMENTOS_VALIDOS: [
    "PB",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "11",
    "12",
    "13",
    "14",
    "15",
    "16",
    "17",
    "18",
  ],
};

// ============================================================
// UTILIDADES BASE
// ============================================================

function getScriptProperty(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function setScriptProperty(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

function getAdminEmails() {
  const prop = getScriptProperty("ADMIN_EMAILS");
  if (!prop) return [];
  try {
    return JSON.parse(prop);
  } catch (e) {
    console.error("Error parsing ADMIN_EMAILS:", e);
    return [];
  }
}

function isAdmin(email) {
  if (!email) return false;
  const admins = getAdminEmails();
  return admins.some((a) => a.toLowerCase() === email.toLowerCase());
}

function getActiveSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet(name) {
  const ss = getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error(`Hoja no encontrada: ${name}`);
  }
  return sheet;
}

function getHeaders(sheetName) {
  return CONFIG.COLUMNS[sheetName] || [];
}

function nowISO() {
  return new Date().toISOString();
}

function validateEmail(email) {
  if (!email) return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function validateEnum(value, enumArray) {
  return enumArray.includes(value);
}

function validateMonto(value) {
  const n = Number(value);
  return !isNaN(n) && n > 0 && Number.isInteger(n * 100); // 2 decimales max
}

function validateRefBancaria(ref) {
  if (!ref) return true; // opcional
  return /^\d{6}$/.test(ref);
}

function validateApartamento(apt) {
  return CONFIG.APARTAMENTOS_VALIDOS.includes(apt);
}

function logAudit(accion, usuario, detalle) {
  try {
    const sheet = getSheet(CONFIG.SHEETS.AUDITORIA);
    sheet.appendRow([nowISO(), accion, usuario, JSON.stringify(detalle)]);
  } catch (e) {
    console.error("Audit log failed:", e);
  }
}

function sendEmail(to, subject, body, options = {}) {
  if (!to || !validateEmail(to)) return false;
  try {
    MailApp.sendEmail({
      to: to,
      subject: subject,
      htmlBody: body,
      ...options,
    });
    return true;
  } catch (e) {
    console.error("Email send failed:", e);
    return false;
  }
}

// ============================================================
// CORE: onFormSubmit — Trigger Installable
// ============================================================

/**
 * Trigger installable: se ejecuta al recibir respuesta del Form
 * Valida, deduplica, escribe en Sheets, envía confirmación
 */
function onFormSubmit(e) {
  try {
    // e.namedValues viene del Form (array de arrays)
    const values = e.namedValues;
    if (!values) {
      throw new Error("No namedValues en event");
    }

    // Extraer campos (Form devuelve arrays, tomar [0])
    const apartamento = (values["Apartamento"] || [""])[0]?.trim();
    const nombre_residente = (values["Nombre del Residente / Pagador"] || [
      "",
    ])[0]?.trim();
    const correo_propietario = (values["Correo del Propietario"] || [""])[0]
      ?.trim()
      .toLowerCase();
    const concepto_raw = (values["Concepto"] || [""])[0]?.trim();
    const metodo_raw = (values["Método de Pago"] || [""])[0]?.trim();
    const monto_raw = (values["Monto en USD"] || [""])[0]?.trim();
    const ref_bancaria = (values[
      "Referencia Bancaria BNC - últimos 6 dígitos"
    ] || [""])[0]?.trim();
    const comprobante_files = values["Comprobante de Pago"] || [];

    // Mapear concept/metodo a enums
    const conceptoMap = {
      "Aporte Septiembre": "APORTE_SEPT",
      "Deuda Anterior": "DEUDA_ANTERIOR",
      Reserva: "RESERVA",
      Otro: "OTRO",
    };
    const metodoMap = {
      "Pago Móvil": "PAGO_MOVIL",
      Transferencia: "TRANSFERENCIA",
      Efectivo: "EFECTIVO",
      Otro: "OTRO",
    };

    const concepto = conceptoMap[concepto_raw] || "OTRO";
    const metodo_pago = metodoMap[metodo_raw] || "OTRO";
    const monto_usd = Number(monto_raw);

    // Validaciones servidor
    const errors = [];
    if (!validateApartamento(apartamento)) errors.push("Apartamento inválido");
    if (!nombre_residente) errors.push("Nombre requerido");
    if (!validateEmail(correo_propietario)) errors.push("Email inválido");
    if (!validateEnum(concepto, CONFIG.ENUMS.CONCEPTO))
      errors.push("Concepto inválido");
    if (!validateEnum(metodo_pago, CONFIG.ENUMS.METODO_PAGO))
      errors.push("Método inválido");
    if (!validateMonto(monto_usd))
      errors.push("Monto inválido (>0, 2 decimales)");
    if (!validateRefBancaria(ref_bancaria))
      errors.push("Referencia bancaria debe ser 6 dígitos");

    if (errors.length > 0) {
      logAudit("FORM_VALIDATION_FAILED", "system", { errors, raw: values });
      // Notificar admin de intento fallido
      getAdminEmails().forEach((admin) =>
        sendEmail(
          admin,
          "⚠️ ENKA: Validación fallida en Form",
          `<p>Errores: ${errors.join(", ")}</p><pre>${JSON.stringify(values, null, 2)}</pre>`,
        ),
      );
      return; // No escribir en Sheets
    }

    // Deduplicación: mismo ref_bancaria + apartamento + fecha (día)
    if (ref_bancaria) {
      const sheetAportes = getSheet(CONFIG.SHEETS.APORTES);
      const data = sheetAportes.getDataRange().getValues();
      const headers = data[0];
      const refIdx = headers.indexOf("ref_bancaria");
      const aptIdx = headers.indexOf("apartamento");
      const tsIdx = headers.indexOf("timestamp");
      const hoy = new Date().toISOString().split("T")[0];

      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (
          row[refIdx] === ref_bancaria &&
          row[aptIdx] === apartamento &&
          row[tsIdx]?.toString().startsWith(hoy)
        ) {
          logAudit("DUPLICATE_DETECTED", "system", {
            ref_bancaria,
            apartamento,
            fecha: hoy,
          });
          // Notificar pero no bloquear (podría ser reintento legítimo)
          getAdminEmails().forEach((admin) =>
            sendEmail(
              admin,
              "⚠️ ENKA: Posible duplicado detectado",
              `<p>Ref: ${ref_bancaria}, Apt: ${apartamento}, Fecha: ${hoy}</p>`,
            ),
          );
        }
      }
    }

    // Comprobante URL (si subió archivo)
    let comprobante_url = "";
    if (comprobante_files.length > 0 && comprobante_files[0]) {
      // Form file uploads devuelven URLs de Drive
      comprobante_url = comprobante_files[0];
    }

    // Escribir en APORTES_SEPT_2026
    const sheetAportes = getSheet(CONFIG.SHEETS.APORTES);
    const rowData = [
      nowISO(), // timestamp
      apartamento, // apartamento
      nombre_residente, // nombre_residente
      correo_propietario, // correo_propietario
      concepto, // concepto
      metodo_pago, // metodo_pago
      monto_usd, // monto_usd
      ref_bancaria || "", // ref_bancaria
      comprobante_url, // comprobante_url
      "PENDIENTE", // estado
      "", // verificado_por
      "", // verificado_en
    ];
    sheetAportes.appendRow(rowData);
    const newRowIndex = sheetAportes.getLastRow();

    logAudit("APORTE_CREATED", "form_submit", {
      row: newRowIndex,
      apartamento,
      concepto,
      monto_usd,
    });

    // Email confirmación a propietario
    const subjectOwner = `✅ ENKA: Aporte recibido - ${apartamento} - $${monto_usd.toFixed(2)}`;
    const bodyOwner = `
      <p>Estimado/a <strong>${nombre_residente}</strong>,</p>
      <p>Hemos recibido su aporte para <strong>Septiembre 2026</strong>:</p>
      <ul>
        <li><strong>Apartamento:</strong> ${apartamento}</li>
        <li><strong>Concepto:</strong> ${concepto_raw}</li>
        <li><strong>Método:</strong> ${metodo_raw}</li>
        <li><strong>Monto:</strong> $${monto_usd.toFixed(2)} USD</li>
        <li><strong>Referencia:</strong> ${ref_bancaria || "No proporcionada"}</li>
        <li><strong>Estado:</strong> <span style="color: #fbbf24;">PENDIENTE DE VERIFICACIÓN</span></li>
      </ul>
      <p>La administración verificará su comprobante y actualizará el estado en 24-48h.</p>
      <p>— Comité Técnico Vecinal Edificio ENKA</p>
    `;
    sendEmail(correo_propietario, subjectOwner, bodyOwner);

    // Email notificación a admins
    const subjectAdmin = `📥 ENKA: Nuevo aporte PENDIENTE - ${apartamento}`;
    const bodyAdmin = `
      <p>Nuevo aporte requiere verificación:</p>
      <ul>
        <li>Apartamento: ${apartamento}</li>
        <li>Residente: ${nombre_residente}</li>
        <li>Email: ${correo_propietario}</li>
        <li>Concepto: ${concepto_raw}</li>
        <li>Monto: $${monto_usd.toFixed(2)}</li>
        <li>Ref: ${ref_bancaria || "N/A"}</li>
        <li>Comprobante: ${comprobante_url ? '<a href="' + comprobante_url + '">Ver</a>' : "No adjunto"}</li>
      </ul>
      <p><a href="${ScriptApp.getService().getUrl()}?action=verify&row=${newRowIndex}">Verificar</a> | 
         <a href="${ScriptApp.getService().getUrl()}?action=reject&row=${newRowIndex}">Rechazar</a></p>
    `;
    getAdminEmails().forEach((admin) =>
      sendEmail(admin, subjectAdmin, bodyAdmin),
    );
  } catch (err) {
    console.error("onFormSubmit error:", err);
    logAudit("FORM_SUBMIT_ERROR", "system", {
      error: err.toString(),
      stack: err.stack,
    });
    getAdminEmails().forEach((admin) =>
      sendEmail(
        admin,
        "🔴 ENKA: Error crítico en onFormSubmit",
        `<pre>${err.stack}</pre>`,
      ),
    );
  }
}

// ============================================================
// ADMIN ACTIONS: verifyAporte / rejectAporte
// ============================================================

/**
 * Verificar aporte (llamado via Web App doGet/doPost)
 * Parámetros: row (number), adminEmail (string)
 */
function verifyAporte(row, adminEmail) {
  try {
    if (!isAdmin(adminEmail)) {
      return { success: false, error: "No autorizado" };
    }
    if (!row || row < 2) {
      return { success: false, error: "Row inválido" };
    }

    const sheet = getSheet(CONFIG.SHEETS.APORTES);
    const estadoCol = CONFIG.COLUMNS.APORTES.indexOf("estado") + 1;
    const verifPorCol = CONFIG.COLUMNS.APORTES.indexOf("verificado_por") + 1;
    const verifEnCol = CONFIG.COLUMNS.APORTES.indexOf("verificado_en") + 1;

    const currentEstado = sheet.getRange(row, estadoCol).getValue();
    if (currentEstado === "VERIFICADO") {
      return { success: false, error: "Ya verificado" };
    }

    sheet.getRange(row, estadoCol).setValue("VERIFICADO");
    sheet.getRange(row, verifPorCol).setValue(adminEmail);
    sheet.getRange(row, verifEnCol).setValue(nowISO());

    // Obtener datos para email
    const headers = sheet
      .getRange(1, 1, 1, CONFIG.COLUMNS.APORTES.length)
      .getValues()[0];
    const rowData = sheet
      .getRange(row, 1, 1, CONFIG.COLUMNS.APORTES.length)
      .getValues()[0];
    const obj = {};
    headers.forEach((h, i) => (obj[h] = rowData[i]));

    logAudit("APORTE_VERIFIED", adminEmail, {
      row,
      apartamento: obj.apartamento,
      monto_usd: obj.monto_usd,
    });

    // Notificar al propietario
    if (validateEmail(obj.correo_propietario)) {
      sendEmail(
        obj.correo_propietario,
        `✅ ENKA: Aporte VERIFICADO - ${obj.apartamento}`,
        `<p>Su aporte de <strong>$${Number(obj.monto_usd).toFixed(2)} USD</strong> ha sido verificado.</p>
         <p>Estado: <span style="color: #22c55e;">VERIFICADO</span></p>
         <p>Verificado por: ${adminEmail} el ${new Date().toLocaleString("es-VE")}</p>`,
      );
    }

    return { success: true, row, newEstado: "VERIFICADO" };
  } catch (err) {
    console.error("verifyAporte error:", err);
    logAudit("VERIFY_ERROR", adminEmail, { row, error: err.toString() });
    return { success: false, error: err.toString() };
  }
}

/**
 * Rechazar aporte con motivo
 */
function rejectAporte(row, adminEmail, motivo) {
  try {
    if (!isAdmin(adminEmail)) {
      return { success: false, error: "No autorizado" };
    }
    if (!row || row < 2) {
      return { success: false, error: "Row inválido" };
    }
    if (!motivo || motivo.trim().length < 3) {
      return { success: false, error: "Motivo requerido (mín 3 chars)" };
    }

    const sheet = getSheet(CONFIG.SHEETS.APORTES);
    const estadoCol = CONFIG.COLUMNS.APORTES.indexOf("estado") + 1;
    const verifPorCol = CONFIG.COLUMNS.APORTES.indexOf("verificado_por") + 1;
    const verifEnCol = CONFIG.COLUMNS.APORTES.indexOf("verificado_en") + 1;

    sheet.getRange(row, estadoCol).setValue("RECHAZADO");
    sheet.getRange(row, verifPorCol).setValue(adminEmail);
    sheet.getRange(row, verifEnCol).setValue(nowISO());

    const headers = sheet
      .getRange(1, 1, 1, CONFIG.COLUMNS.APORTES.length)
      .getValues()[0];
    const rowData = sheet
      .getRange(row, 1, 1, CONFIG.COLUMNS.APORTES.length)
      .getValues()[0];
    const obj = {};
    headers.forEach((h, i) => (obj[h] = rowData[i]));

    logAudit("APORTE_REJECTED", adminEmail, {
      row,
      apartamento: obj.apartamento,
      motivo,
    });

    // Notificar al propietario
    if (validateEmail(obj.correo_propietario)) {
      sendEmail(
        obj.correo_propietario,
        `❌ ENKA: Aporte RECHAZADO - ${obj.apartamento}`,
        `<p>Su aporte de <strong>$${Number(obj.monto_usd).toFixed(2)} USD</strong> fue rechazado.</p>
         <p>Motivo: ${motivo}</p>
         <p>Por favor contacte a la administración para resolver.</p>`,
      );
    }

    return { success: true, row, newEstado: "RECHAZADO" };
  } catch (err) {
    console.error("rejectAporte error:", err);
    logAudit("REJECT_ERROR", adminEmail, { row, error: err.toString() });
    return { success: false, error: err.toString() };
  }
}

// ============================================================
// WEB APP ENTRY POINTS: doGet / doPost
// ============================================================

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const params = e.parameter || {};
  const action = params.action;
  const adminEmail = Session.getActiveUser().getEmail();

  if (!isAdmin(adminEmail)) {
    return ContentService.createTextOutput(
      JSON.stringify({
        success: false,
        error: "Acceso denegado: no es admin",
      }),
    ).setMimeType(ContentService.MimeType.JSON);
  }

  let result;
  switch (action) {
    case "verify":
      result = verifyAporte(parseInt(params.row), adminEmail);
      break;
    case "reject":
      result = rejectAporte(parseInt(params.row), adminEmail, params.motivo);
      break;
    case "dashboard":
      result = getDashboardData(params.correo_propietario);
      break;
    case "transparencia":
      result = getTransparenciaData();
      break;
    default:
      result = { success: false, error: "Acción no válida" };
  }

  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

// ============================================================
// LOOKER STUDIO COMMUNITY CONNECTOR: getDashboardData
// ============================================================

/**
 * Endpoint RLS para Looker Studio Community Connector
 * Parámetro: correo_propietario (string) — obligatorio para vista vecino
 * Si admin (isAdmin) y correo_propietario vacío → retorna todo
 */
function getDashboardData(correoPropietario) {
  try {
    const requestingAdmin = Session.getActiveUser().getEmail();
    const isRequestingAdmin = isAdmin(requestingAdmin);

    // RLS: si no es admin, requiere correo_propietario
    if (!isRequestingAdmin && !correoPropietario) {
      return { error: "RLS: correo_propietario requerido para vista no-admin" };
    }

    const sheet = getSheet(CONFIG.SHEETS.APORTES);
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { rows: [] };

    const headers = data[0];
    const rows = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const obj = {};
      headers.forEach((h, idx) => (obj[h] = row[idx]));

      // Aplicar filtro RLS
      if (!isRequestingAdmin && obj.correo_propietario !== correoPropietario) {
        continue; // Saltar rows que no pertenecen al usuario
      }

      // Solo campos necesarios para Looker
      rows.push({
        timestamp: obj.timestamp,
        apartamento: obj.apartamento,
        nombre_residente: obj.nombre_residente,
        correo_propietario: obj.correo_propietario,
        concepto: obj.concepto,
        metodo_pago: obj.metodo_pago,
        monto_usd: Number(obj.monto_usd) || 0,
        ref_bancaria: obj.ref_bancaria || "",
        estado: obj.estado,
      });
    }

    return { rows };
  } catch (err) {
    console.error("getDashboardData error:", err);
    return { error: err.toString() };
  }
}

// ============================================================
// DATOS PÚBLICOS: getTransparenciaData (sin RLS)
// ============================================================

function getTransparenciaData() {
  try {
    const sheet = getSheet(CONFIG.SHEETS.GASTOS);
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { rows: [] };

    const headers = data[0];
    const rows = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const obj = {};
      headers.forEach((h, idx) => (obj[h] = row[idx]));
      rows.push({
        fecha: obj.fecha,
        fase: obj.fase,
        concepto: obj.concepto,
        proveedor: obj.proveedor || "",
        monto_usd: Number(obj.monto_usd) || 0,
        categoria: obj.categoria,
        comprobante_url: obj.comprobante_url || "",
        aprobado_por: obj.aprobado_por,
      });
    }

    return { rows };
  } catch (err) {
    console.error("getTransparenciaData error:", err);
    return { error: err.toString() };
  }
}

// ============================================================
// TRIGGER DIARIO: dailySummaryTrigger
// ============================================================

function dailySummaryTrigger() {
  try {
    const sheetAportes = getSheet(CONFIG.SHEETS.APORTES);
    const data = sheetAportes.getDataRange().getValues();
    if (data.length < 2) return;

    const headers = data[0];
    const estadoIdx = headers.indexOf("estado");
    const montoIdx = headers.indexOf("monto_usd");
    const conceptoIdx = headers.indexOf("concepto");
    const timestampIdx = headers.indexOf("timestamp");
    const hoy = new Date().toISOString().split("T")[0];

    let totalPendiente = 0;
    let totalVerificadoHoy = 0;
    let totalDeudaHistorica = 0;
    let countPendiente = 0;
    let countVerificadoHoy = 0;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const estado = row[estadoIdx];
      const monto = Number(row[montoIdx]) || 0;
      const concepto = row[conceptoIdx];
      const ts = row[timestampIdx]?.toString().split("T")[0];

      if (estado === "PENDIENTE") {
        totalPendiente += monto;
        countPendiente++;
      }
      if (estado === "VERIFICADO" && ts === hoy) {
        totalVerificadoHoy += monto;
        countVerificadoHoy++;
      }
      if (concepto === "DEUDA_ANTERIOR" && estado === "VERIFICADO") {
        totalDeudaHistorica += monto;
      }
    }

    const subject = `📊 ENKA: Resumen Diario ${new Date().toLocaleDateString("es-VE")}`;
    const body = `
      <h3>Resumen Diario - Edificio ENKA</h3>
      <table style="border-collapse: collapse; font-family: monospace;">
        <tr><td style="padding: 4px 12px; border: 1px solid #333;">Aportes Pendientes</td><td style="padding: 4px 12px; border: 1px solid #333; text-align: right;">${countPendiente}</td><td style="padding: 4px 12px; border: 1px solid #333; text-align: right;">$${totalPendiente.toFixed(2)}</td></tr>
        <tr><td style="padding: 4px 12px; border: 1px solid #333;">Verificados Hoy</td><td style="padding: 4px 12px; border: 1px solid #333; text-align: right;">${countVerificadoHoy}</td><td style="padding: 4px 12px; border: 1px solid #333; text-align: right;">$${totalVerificadoHoy.toFixed(2)}</td></tr>
        <tr><td style="padding: 4px 12px; border: 1px solid #333;">Deuda Histórica (Verificada)</td><td colspan="2" style="padding: 4px 12px; border: 1px solid #333; text-align: right;">$${totalDeudaHistorica.toFixed(2)}</td></tr>
      </table>
      <p><small>Generado automáticamente por Apps Script Trigger (08:00)</small></p>
    `;

    getAdminEmails().forEach((admin) => sendEmail(admin, subject, body));
    logAudit("DAILY_SUMMARY_SENT", "trigger", {
      countPendiente,
      totalPendiente,
      countVerificadoHoy,
      totalVerificadoHoy,
      totalDeudaHistorica,
    });
  } catch (err) {
    console.error("dailySummaryTrigger error:", err);
    logAudit("DAILY_SUMMARY_ERROR", "trigger", { error: err.toString() });
  }
}

// ============================================================
// INICIALIZACIÓN: setupSheets (ejecutar una vez manualmente)
// ============================================================

function setupSheets() {
  const ss = getActiveSpreadsheet();

  // Crear hojas si no existen
  Object.entries(CONFIG.SHEETS).forEach(([key, name]) => {
    if (!ss.getSheetByName(name)) {
      const sheet = ss.insertSheet(name);
      const headers = CONFIG.COLUMNS[key] || [];
      if (headers.length) {
        sheet
          .getRange(1, 1, 1, headers.length)
          .setValues([headers])
          .setFontWeight("bold")
          .setBackground("#1e293b")
          .setFontColor("#f1f5f9");
        sheet.setFrozenRows(1);
      }
    }
  });

  // Poblar ESTATUS_FASES con datos iniciales
  const sheetEstatus = getSheet(CONFIG.SHEETS.ESTATUS);
  if (sheetEstatus.getLastRow() <= 1) {
    const statusData = [
      ["FASE_I", "COMPLETADA", 100, nowISO(), 1026, 1026],
      ["FASE_II", "EN_PROGRESO", 35, nowISO(), 15000, 5250],
      ["FASE_III", "GESTION_INSTITUCIONAL", 10, nowISO(), 45000, 4500],
    ];
    sheetEstatus.getRange(2, 1, statusData.length, 6).setValues(statusData);
  }

  // Poblar GASTOS_OBRA con ejemplo (Fase I completada)
  const sheetGastos = getSheet(CONFIG.SHEETS.GASTOS);
  if (sheetGastos.getLastRow() <= 1) {
    const gastosEjemplo = [
      [
        "2026-08-15",
        "FASE_I",
        "Bloques arcilla liviana (13ml muro)",
        "Ferretería Central",
        420,
        "MATERIALES",
        "",
        "admin@enka.ve",
      ],
      [
        "2026-08-18",
        "FASE_I",
        "Cemento y arena (media caña)",
        "Ferretería Central",
        180,
        "MATERIALES",
        "",
        "admin@enka.ve",
      ],
      [
        "2026-08-20",
        "FASE_I",
        "Manto asfáltico impermeabilizante",
        "Impermeabilizantes CA",
        320,
        "MATERIALES",
        "",
        "admin@enka.ve",
      ],
      [
        "2026-08-22",
        "FASE_I",
        "Mano de obra albañilería (4 días)",
        "Cuadrilla Vecinal",
        106,
        "MANO_OBRA",
        "",
        "admin@enka.ve",
      ],
    ];
    sheetGastos
      .getRange(2, 1, gastosEjemplo.length, 8)
      .setValues(gastosEjemplo);
  }

  // Validaciones de datos en APORTES
  const sheetAportes = getSheet(CONFIG.SHEETS.APORTES);
  const ruleApartamento = SpreadsheetApp.newDataValidation()
    .requireValueInList(CONFIG.APARTAMENTOS_VALIDOS, true)
    .setAllowInvalid(false)
    .setHelpText("Seleccione apartamento: PB, 1-18")
    .build();
  sheetAportes.getRange(2, 2, 1000, 1).setDataValidation(ruleApartamento);

  const ruleConcepto = SpreadsheetApp.newDataValidation()
    .requireValueInList(CONFIG.ENUMS.CONCEPTO, true)
    .setAllowInvalid(false)
    .build();
  sheetAportes.getRange(2, 5, 1000, 1).setDataValidation(ruleConcepto);

  const ruleMetodo = SpreadsheetApp.newDataValidation()
    .requireValueInList(CONFIG.ENUMS.METODO_PAGO, true)
    .setAllowInvalid(false)
    .build();
  sheetAportes.getRange(2, 6, 1000, 1).setDataValidation(ruleMetodo);

  const ruleEstado = SpreadsheetApp.newDataValidation()
    .requireValueInList(CONFIG.ENUMS.ESTADO, true)
    .setAllowInvalid(false)
    .build();
  sheetAportes.getRange(2, 10, 1000, 1).setDataValidation(ruleEstado);

  console.log("✅ Sheets inicializados correctamente");
  return "Setup completado";
}

// ============================================================
// TEST HELPERS (para desarrollo)
// ============================================================

function testOnFormSubmit() {
  const mockEvent = {
    namedValues: {
      Apartamento: ["5"],
      "Nombre del Residente / Pagador": ["Juan Pérez"],
      "Correo del Propietario": ["juan@test.com"],
      Concepto: ["Aporte Septiembre"],
      "Método de Pago": ["Transferencia"],
      "Monto en USD": ["50.00"],
      "Referencia Bancaria BNC - últimos 6 dígitos": ["123456"],
      "Comprobante de Pago": ["https://drive.google.com/file/d/xxx/view"],
    },
  };
  onFormSubmit(mockEvent);
  console.log("Test onFormSubmit ejecutado");
}

function testVerifyAporte() {
  const result = verifyAporte(2, "admin@enka.ve");
  console.log("Test verifyAporte:", JSON.stringify(result, null, 2));
}

function testGetDashboardData() {
  const result = getDashboardData("juan@test.com");
  console.log("Test getDashboardData:", JSON.stringify(result, null, 2));
}
