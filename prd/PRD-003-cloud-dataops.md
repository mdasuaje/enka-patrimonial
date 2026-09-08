# PRD-003: Cloud DataOps & Backend Serverless — ENKA Septiembre 2026

## Contexto

Transformar los placeholders del frontend (PRD-002) en lógica funcional integrada con el ecosistema Google (Sheets + Apps Script + Looker Studio + Forms). Basado en la carpeta Drive "ENKA SEPTIEMBRE 2026" (ID: 1GPRxyz1k4tpY83RbJj7peFq7gdPHge3F).

## Objetivos

1. **Base de Datos Centralizada** — Google Sheets como backend serverless con esquema estricto
2. **RLS (Row-Level Security)** — Filtrado por `Correo_Propietario` en Apps Script + Looker Studio
3. **Ingesta Automatizada** — Google Forms → Sheets vía Apps Script (validación, deduplicación, triggers)
4. **Telemetría Looker Studio** — Esquema de datos tipado para dashboards operativos
5. **Webhooks/Triggers** — Notificaciones (email/Chat) en eventos críticos (pago recibido, umbral deuda)

---

## Requisitos Funcionales

### RF-01: Esquema de Base de Datos (Google Sheets)

**Hoja: `APORTES_SEPT_2026`**

| Campo | Tipo | Requerido | Validación | Notas |
| ------- | ------ | ----------- | ------------ | ------- |
| `timestamp` | datetime | Auto | ISO 8601 | `=NOW()` en submit |
| `apartamento` | string | Sí | Enum: PB,1-18 | Desplegable en Form |
| `nombre_residente` | string | Sí | Max 100 chars | |
| `correo_propietario` | email | Sí | RFC 5322 | **Clave RLS** |
| `concepto` | string | Sí | Enum: `APORTE_SEPT`, `DEUDA_ANTERIOR`, `RESERVA`, `OTRO` | |
| `metodo_pago` | string | Sí | Enum: `PAGO_MOVIL`, `TRANSFERENCIA`, `EFECTIVO`, `OTRO` | |
| `monto_usd` | number | Sí | > 0, 2 decimales | USD |
| `ref_bancaria` | string | No | Exacto 6 dígitos | Últimos 6 díg BNC |
| `comprobante_url` | url | No | Valid URL | Drive file link |
| `estado` | string | Auto | Enum: `PENDIENTE`, `VERIFICADO`, `RECHAZADO` | Default: `PENDIENTE` |
| `verificado_por` | email | No | RFC 5322 | Admin que valida |
| `verificado_en` | datetime | No | ISO 8601 | |

**Hoja: `GASTOS_OBRA`**

| Campo | Tipo | Requerido | Validación |
| ------- | ------ | ----------- | ------------ |
| `fecha` | date | Sí | ISO 8601 |
| `fase` | string | Sí | Enum: `FASE_I`, `FASE_II`, `FASE_III` |
| `concepto` | string | Sí | Max 200 chars |
| `proveedor` | string | No | Max 100 chars |
| `monto_usd` | number | Sí | > 0, 2 decimales |
| `categoria` | string | Sí | Enum: `MATERIALES`, `MANO_OBRA`, `SERVICIOS`, `ADMINISTRATIVO` |
| `comprobante_url` | url | No | Valid URL |
| `aprobado_por` | email | Sí | RFC 5322 |

**Hoja: `ESTATUS_FASES`** (Read-only para Looker)

| Campo | Tipo | Fuente |
| ------- | ------ | -------- |
| `fase` | string | `FASE_I`, `FASE_II`, `FASE_III` |
| `estado` | string | `COMPLETADA`, `EN_PROGRESO`, `GESTION_INSTITUCIONAL` |
| `porcentaje` | number | 0-100 |
| `ultima_actualizacion` | datetime | ISO 8601 |
| `presupuesto_usd` | number | Estimado |
| `ejecutado_usd` | number | Suma GASTOS_OBRA por fase |

---

### RF-02: Google Apps Script — Backend Logic

**Archivo: `enka_gas_backend.js`**

**Funciones Core:**

1. `onFormSubmit(e)` — Trigger installable al recibir Form Response
   - Validación esquemas (monto > 0, ref 6 díg, email válido)
   - Deduplicación por `ref_bancaria` + `apartamento` + `fecha`
   - Write a `APORTES_SEPT_2026` con `estado: PENDIENTE`
   - Email de confirmación a `correo_propietario` + admin

2. `verifyAporte(rowIndex, adminEmail)` — Función callable (doPost/doGet)
   - Valida admin en lista blanca (`ADMIN_EMAILS`)
   - Actualiza `estado: VERIFICADO`, `verificado_por`, `verificado_en`
   - Recalcula scorecards (trigger Looker refresh)

3. `rejectAporte(rowIndex, adminEmail, motivo)` — Rechazo con auditoría
   - `estado: RECHAZADO`, log en hoja `AUDITORIA`

4. `getDashboardData(correoPropietario)` — Endpoint RLS para Looker
   - Filtra `APORTES_SEPT_2026` por `correo_propietario = correoPropietario`
   - Retorna JSON tipado para Community Connector

5. `getTransparenciaData()` — Datos públicos (sin RLS)
   - Agrega `GASTOS_OBRA` por `categoria` + `fase`
   - Retorna para gráfico anillos (Corpoelec, Hidrocapital, etc.)

6. `dailySummaryTrigger()` — Time-driven trigger (diario 08:00)
   - Email resumen a admins: total pendiente, verificado hoy, deuda total

---

### RF-03: Google Forms — Frontend de Ingesta

**Configuración:**

- Título: "Aporte Septiembre 2026 - Edificio ENKA"
- Descripción: "Registro de aportes vecinales bajo Régimen Comunidad de Bienes (Art. 759 CC)"
- **Campos (orden exacto):**
  1. Apartamento (Desplegable: PB, 1, 2, ..., 18) — Requerido
  2. Nombre del Residente / Pagador (Respuesta corta) — Requerido
  3. Correo del Propietario (Respuesta corta, validación email) — Requerido
  4. Concepto (Opción múltiple: Aporte Septiembre, Deuda Anterior, Reserva, Otro) — Requerido
  5. Método de Pago (Opción múltiple: Pago Móvil, Transferencia, Efectivo, Otro) — Requerido
  6. Monto en USD (Número, validación > 0) — Requerido
  7. Referencia Bancaria BNC - últimos 6 dígitos (Respuesta corta, regex `^\d{6}$`) — Opcional
  8. Comprobante de Pago (Subir archivo: JPG, PNG, PDF, máx 10MB) — Opcional

**Settings:**

- Recoger emails: Sí (automático)
- Límite 1 respuesta: No
- Editar después de enviar: No
- Ver resumen: Solo admins

---

### RF-04: Looker Studio — Community Connector Schema

**Fuente de datos:** Apps Script Web App (`exec` URL) como Community Connector

**Campos (Data Schema):**

```json
{
  "fields": [
    {"name": "timestamp", "type": "TYPE_DATETIME", "semantics": "DATETIME"},
    {"name": "apartamento", "type": "TYPE_STRING", "semantics": "DIMENSION"},
    {"name": "nombre_residente", "type": "TYPE_STRING", "semantics": "DIMENSION"},
    {"name": "correo_propietario", "type": "TYPE_STRING", "semantics": "DIMENSION"},
    {"name": "concepto", "type": "TYPE_STRING", "semantics": "DIMENSION"},
    {"name": "metodo_pago", "type": "TYPE_STRING", "semantics": "DIMENSION"},
    {"name": "monto_usd", "type": "TYPE_NUMBER", "semantics": "METRIC_CURRENCY_USD"},
    {"name": "ref_bancaria", "type": "TYPE_STRING", "semantics": "DIMENSION"},
    {"name": "estado", "type": "TYPE_STRING", "semantics": "DIMENSION"}
  ],
  "configParams": [
    {"name": "correo_propietario", "displayName": "Correo Propietario (RLS)", "type": "TEXTINPUT", "helpText": "Dejar vacío para vista admin (sin filtro)"}
  ]
}
```

**Scorecards (calculadas en Looker):**

1. `Deuda_Historica` — SUM(`monto_usd`) WHERE `concepto='DEUDA_ANTERIOR'` AND `estado='VERIFICADO'`
2. `Total_Pagado` — SUM(`monto_usd`) WHERE `estado='VERIFICADO'`
3. `Saldo_Pendiente` — `Deuda_Historica` - `Total_Pagado` (o SUM WHERE `estado='PENDIENTE'`)

**Gráfico Anillos (Público):**

- Dimensión: `categoria` (de `GASTOS_OBRA`)
- Métrica: SUM(`monto_usd`)
- Filtro: `fase` = todas

---

### RF-05: Seguridad y Gobernanza

- **Lista blanca admins:** `ADMIN_EMAILS` en PropertiesService (script properties)
- **RLS estricta:** Community Connector requiere `correo_propietario` param; si vacío → error 403 (solo admins ven todo via `isAdmin()` check)
- **Validación servidor:** Nunca confiar en validación client-side del Form
- **Auditoría:** Hoja `AUDITORIA` con `timestamp`, `accion`, `usuario`, `detalle_json`
- **PQC-ready:** Todas las URLs Web App usan HTTPS; Secrets en PropertiesService (no en código)

---

## Requisitos No Funcionales

- **Latencia Apps Script:** < 3s p95 para `onFormSubmit`
- **Disponibilidad:** 99.9% (Google infra)
- **Escalabilidad:** Sheets soporta 10M celdas; ENKA ~500 rows/mes
- **Costo:** $0 (Workspace incluido)

---

## Criterios de Aceptación

- [ ] Formulario público funcional → escribe en Sheets con validación
- [ ] Admin puede verificar/rechazar via Web App (doPost)
- [ ] Looker Studio Community Connector conecta y filtra por RLS
- [ ] 3 Scorecards + Gráfico Anillos renderizan correctamente
- [ ] Trigger diario envía resumen a admins
- [ ] Hoja `AUDITORIA` registra todas las acciones admin
- [ ] `schema_looker.json` válido para importar en Looker
- [ ] `enka_gas_backend.js` copiable a Apps Script sin errores de sintaxis
