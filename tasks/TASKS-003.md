# TASKS-003: Cloud DataOps & Backend Serverless — Septiembre 2026

## Tareas de Implementación (SDD)

### Fase A: Google Sheets — Esquema Base de Datos

- [ ] **Tarea 01**: Crear Spreadsheet "ENKA_DATOS_SEPT_2026" en Drive carpeta raíz
- [ ] **Tarea 02**: Crear hoja `APORTES_SEPT_2026` con 12 columnas (timestamp, apartamento, nombre_residente, correo_propietario, concepto, metodo_pago, monto_usd, ref_bancaria, comprobante_url, estado, verificado_por, verificado_en)
- [ ] **Tarea 03**: Crear hoja `GASTOS_OBRA` con 8 columnas (fecha, fase, concepto, proveedor, monto_usd, categoria, comprobante_url, aprobado_por)
- [ ] **Tarea 04**: Crear hoja `ESTATUS_FASES` con 6 columnas (fase, estado, porcentaje, ultima_actualizacion, presupuesto_usd, ejecutado_usd) — poblar con datos Fase I/II/III
- [ ] **Tarea 05**: Crear hoja `AUDITORIA` con 4 columnas (timestamp, accion, usuario, detalle_json)
- [ ] **Tarea 06**: Configurar validación de datos (Data → Validation) en columnas enum y email

### Fase B: Google Forms — Frontend Ingesta

- [ ] **Tarea 07**: Crear Form "Aporte Septiembre 2026 - Edificio ENKA"
- [ ] **Tarea 08**: Configurar 8 campos exactos (Apartamento dropdown PB-18, Nombre, Correo, Concepto radio, Metodo radio, Monto number, Ref 6 dígitos regex, File upload)
- [ ] **Tarea 09**: Vincular Form a hoja `APORTES_SEPT_2026` (Responses → Select destination)
- [ ] **Tarea 10**: Settings: Recoger emails ON, Límite 1 OFF, Editar OFF, Resumen solo admins

### Fase C: Google Apps Script — Backend Logic

- [ ] **Tarea 11**: Abrir Extensions → Apps Script en el Spreadsheet
- [ ] **Tarea 12**: Copiar contenido de `evidencia/scripts/enka_gas_backend.js` al editor
- [ ] **Tarea 13**: Configurar Script Properties: `ADMIN_EMAILS` (JSON array: ["admin1@dominio.com","admin2@dominio.com"])
- [ ] **Tarea 14**: Configurar Script Properties: `SPREADSHEET_ID` (auto), `FORM_ID` (del Form creado)
- [ ] **Tarea 15**: Deploy → New deployment → Type: Web App → Execute as: Me → Who has access: Anyone → Deploy
- [ ] **Tarea 16**: Copiar Web App URL → actualizar `evidencia/scripts/schema_looker.json` configParams si needed
- [ ] **Tarea 17**: Crear trigger installable: `onFormSubmit` → From spreadsheet → On form submit
- [ ] **Tarea 18**: Crear trigger time-driven: `dailySummaryTrigger` → Day timer → 08:00 AM

### Fase D: Looker Studio — Community Connector

- [ ] **Tarea 19**: Crear nuevo reporte en Looker Studio
- [ ] **Tarea 20**: Add data → Community Connectors → Build your own → Paste Web App URL
- [ ] **Tarea 21**: Configurar parámetro `correo_propietario` (dejar vacío para admin, setear para usuario)
- [ ] **Tarea 22**: Crear 3 Scorecards: Deuda_Historica, Total_Pagado, Saldo_Pendiente (fórmulas PRD-003)
- [ ] **Tarea 23**: Crear Gráfico Anillos: Dimensión categoria (GASTOS_OBRA), Métrica SUM monto_usd
- [ ] **Tarea 24**: Crear tabla `ESTATUS_FASES` como scorecard de progreso
- [ ] **Tarea 25**: Obtener Embed URL → actualizar `evidencia/index.html` iframe Looker

### Fase E: Integración Frontend + Validación

- [ ] **Tarea 26**: Actualizar `evidencia/index.html` con URL real de Form (reemplazar placeholder)
- [ ] **Tarea 27**: Actualizar `evidencia/index.html` con Embed URL real de Looker Studio
- [ ] **Tarea 28**: Test end-to-end: Submit Form → Verificar en Sheets → Verificar en Looker (RLS)
- [ ] **Tarea 29**: Test admin: verifyAporte via Web App → Verificar estado VERIFICADO → Looker refresh
- [ ] **Tarea 30**: Commit + Push → GitHub Pages rebuild → Verificar deploy

### Fase F: Documentación y Cierre

- [ ] **Tarea 31**: Validar `evidencia/scripts/schema_looker.json` sintaxis JSON
- [ ] **Tarea 32**: Validar `evidencia/scripts/enka_gas_backend.js` sintaxis (Node/ESLint si disponible)
- [ ] **Tarea 33**: Engram save hito Fase 22 (feature)

## Definición de Terminado (DoD)

- Form público funcional → Sheets con validación servidor
- Admin verifica/rechaza via Web App → estado actualizado
- Looker Community Connector conecta + filtra RLS por correo_propietario
- 3 Scorecards + Gráfico Anillos + Tabla Fases renderizan
- Trigger diario 08:00 envía email resumen a admins
- Hoja AUDITORIA registra acciones admin
- Frontend `index.html` con URLs reales (no placeholders)
- GitHub Pages build exitoso
- Engram doctor 4/4 OK
