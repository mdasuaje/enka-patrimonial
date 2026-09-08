# PRD-005: Control de Acceso RBAC — Portal Público + Vista Ciega Vecinos

## Contexto y Segregación de Dominios (CRÍTICO)

Este PRD aplica **EXCLUSIVAMENTE** al dominio **CIVIL_Y_ARQUITECTONICO**:

- Carpeta raíz: `1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY` (`enka`)
- Sub-carpeta objetivo: `1GPRxyz1k4tpY83RbJj7peFq7gdPHge3F` (`ENKA SEPTIEMBRE 2026`)

**Dominio FINANCIERO_Y_FONDOS** (`1eGceRlB1-E2QF0iIl_aIp1DJs1TmzJwV`) — **FUERA DE ALCANCE**. Inmutable.

---

## Objetivo

Implementar una topología de acceso Zero-Trust con dos capas completamente aisladas:

| Capa | Audiencia | Autenticación | Acceso |
|------|-----------|---------------|--------|
| **PÚBLICA** | Autoridades (Alcaldía, IPC), Público General | **Ninguna** (lectura anónima) | Documentos de transparencia: Gacetas, estatus fases, informes estructurales generales, reglamentos |
| **PRIVADA** | Vecinos del Edificio ENKA | **3 Factores**: `Teléfono : Apartamento : Nombre Completo` (coincidencia exacta) | **Vista Ciega (RLS documental)**: Solo el informe/reporte correspondiente a SU apartamento |

---

## Arquitectura de Control de Acceso

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DOMINIO: CIVIL_Y_ARQUITECTONICO                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────┐          ┌──────────────────────────────┐   │
│  │      DOMINIO PÚBLICO      │          │      DOMINIO PRIVADO          │   │
│  │  (Transparencia Patrimonial)          │  (Vista Ciega - Zero Trust)   │   │
│  ├──────────────────────────┤          ├──────────────────────────────┤   │
│  │                          │          │                              │   │
│  │  Google Site Público     │          │  Cloud Run: enka-auth-gateway │   │
│  │  / Google Drive Public   │          │  1. Recibe: Tel + Apt + Name  │   │
│  │  Folder (Viewer)         │          │  2. Valida contra Registro    │   │
│  │                          │          │  3. Genera Signed URL (TTL)   │   │
│  │  Contenido:              │          │  4. Retorna solo SU documento │   │
│  │  - G.O. 39.272 (BIC)    │          │                              │   │
│  │  - Estatus Fases I/II/III│          │  Registro Inmutable:          │   │
│  │  - Informe Estructural   │          │  Firestore / Sheets (Admin)   │   │
│  │  - Reglamento Interno    │          │  { apt, name, phone, docId }  │   │
│  │  - Actas Asamblea (res.) │          │                              │   │
│  └──────────────────────────┘          └──────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Especificación Técnica

### RF-01: Dominio Público — Portal de Transparencia

**Implementación:** Google Site "Expediente Técnico ENKA" + Carpeta Drive Pública

**Estructura Carpeta Pública (dentro de `enka`):**

```
enka/
└── 00_PUBLICO_TRANSPARENCIA/          # Carpeta con sharing: "Anyone with link: Viewer"
    ├── 01_MARCO_LEGAL/
    │   ├── G.O._39.272_BIC_ENKA.pdf
    │   └── Reglamento_Interno_ENKA_20260823.pdf
    ├── 02_ESTATUS_OBRAS/
    │   ├── Fase_I_Azotea_COMPLETADA.pdf
    │   ├── Fase_II_Columnas_EN_PROGRESO.pdf
    │   └── Fase_III_Fachadas_GESTION_INST.pdf
    ├── 03_INFORMES_TECNICOS/
    │   ├── Informe_Estructural_General_2026.pdf
    │   └── Matriz_Patologias_Resumen.pdf
    └── 04_ACTAS_ASAMBLEA/
        └── Acta_Extraordinaria_20260823_Resumen.pdf
```

**Permisos Drive:**

- Carpeta `00_PUBLICO_TRANSPARENCIA`: `role=reader`, `type=anyone` (link sharing ON)
- Herencia: todos los archivos/heredan `anyone with link: viewer`
- **NUNCA** incluir documentos con datos personales (nombres, teléfonos, montos individuales)

---

### RF-02: Dominio Privado — Vista Ciega (Zero-Trust)

**Vector de Identidad (3 Factores - Coincidencia Exacta):**

```json
{
  "telefono": "+58412XXXXXXX",      // Formato E.164 normalizado
  "apartamento": "PB|1|2|...|18",   // Enum exacto
  "nombre_completo": "JUAN PEREZ"   // Uppercase, sin acentos, match exacto
}
```

**Registro de Autorización (Fuente de Verdad):**

- **Backend:** Firestore collection `vecinos_autorizados` (recomendado) o Google Sheets Admin-only
- **Esquema:**

```javascript
// Firestore: vecinos_autorizados/{apartamento}
{
  apartamento: "5",
  nombre_normalizado: "JUAN PEREZ",
  telefono_e164: "+584121234567",
  documento_drive_id: "1AbC...XYZ",      // File ID en Drive (privado)
  documento_nombre: "Informe_Estructural_Apt_5.pdf",
  creado_en: Timestamp,
  actualizado_en: Timestamp,
  creado_por: "admin@enka.ve"
}
```

**Flujo de Autenticación y Entrega:**

```
┌─────────┐     1. POST /auth/vista-ciega      ┌─────────────────────┐
│ Vecino  │  { telefono, apartamento, nombre }  │  enka-auth-gateway  │
│ (Front) │ ─────────────────────────────────► │  (Cloud Run)        │
└─────────┘                                     ├─────────────────────┤
                                                │ 2. Normaliza inputs │
                                                │ 3. Query Firestore  │
                                                │    where apt==X     │
                                                │    && nombre==Y     │
                                                │    && phone==Z      │
                                                │                     │
                                                │ 4. Si NO match:     │
                                                │    403 Forbidden    │
                                                │                     │
                                                │ 5. Si match:        │
                                                │    Genera Signed URL│
                                                │    (Drive API v3,   │
                                                │     TTL 15 min)     │
                                                │                     │
                                                │ 6. Retorna:         │
                                                │    { signedUrl,     │
                                                │      expiresIn,     │
                                                │      docName }      │
┌─────────┐     7. Signed URL (GET)              ├─────────────────────┤
│ Vecino  │ ◄────────────────────────────────── │                     │
│ (Front) │     8. Descarga/Visualiza PDF        │  Drive API          │
└─────────┘                                      │ (Backend delegado)  │
                                                 └─────────────────────┘
```

---

### RF-03: Auth Gateway — `enka-auth-gateway` (Cloud Run)

**Endpoint:** `POST /api/v1/auth/vista-ciega`

**Request:**

```json
{
  "telefono": "+584121234567",
  "apartamento": "5",
  "nombre_completo": "Juan Perez"
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "documento": {
    "nombre": "Informe_Estructural_Apt_5.pdf",
    "signed_url": "https://drive.google.com/...&signature=...",
    "expires_in_seconds": 900,
    "mime_type": "application/pdf"
  }
}
```

**Response (403 Forbidden):**

```json
{
  "success": false,
  "error": "CREDENCIALES_INVALIDAS",
  "message": "Los datos proporcionados no coinciden con ningún registro autorizado"
}
```

**Response (404 Not Found):**

```json
{
  "success": false,
  "error": "DOCUMENTO_NO_DISPONIBLE",
  "message": "Su informe aún no ha sido generado o cargado"
}
```

**Response (429 Rate Limited):**

```json
{
  "success": false,
  "error": "DEMASIADOS_INTENTOS",
  "message": "Máximo 5 intentos por hora. Intente más tarde."
}
```

---

### RF-04: Rate Limiting y Auditoría

| Control | Implementación |
| --------- | ---------------- |
| **Rate Limit** | 5 req/hora por IP + 5 req/hora por apartamento (Redis / Firestore counter) |
| **Audit Log** | Firestore `audit_accesos/{attemptId}`: `{timestamp, ip, telefono_hash, apartamento, nombre_hash, success, error_code}` |
| **Telefono Hash** | SHA-256(telefono + salt) en logs — nunca almacenar plano |
| **Bloqueo** | 10 fallos consecutivos → bloqueo 24h (requiere admin desbloqueo) |

---

### RF-05: Gestión de Documentos Privados (Admin)

**Ubicación Drive:** Carpeta privada `enka/01_PRIVADO_VECINOS/` (sharing: `restricted`)

**Estructura:**

```
enka/
└── 01_PRIVADO_VECINOS/                # Sharing: SOLO Service Account + Admins
    ├── Apt_PB/
    │   └── Informe_Estructural_Apt_PB.pdf
    ├── Apt_1/
    │   └── Informe_Estructural_Apt_1.pdf
    ...
    └── Apt_18/
        └── Informe_Estructural_Apt_18.pdf
```

**Operaciones Admin (via Apps Script / Cloud Console):**

1. Subir PDF a `01_PRIVADO_VECINOS/Apt_X/`
2. Registrar en Firestore `vecinos_autorizados` el `documento_drive_id`
3. Documento **NUNCA** se comparte directamente — solo via Signed URL del gateway

---

## Seguridad y Gobernanza

| Control | Público | Privado |
| --------- | --------- | --------- |
| **Network** | Internet abierto | Cloud Run `ingress=internal` + IAP |
| **Auth** | Ninguna | 3-factores + Rate Limit + Signed URL (TTL 15min) |
| **Encryption** | TLS 1.3 | TLS 1.3 + Signed URL (RSA-2048/SHA256) |
| **PQC** | TLS 1.3 standard | Signed URL migration path a PQC (hybrid KEM) |
| **Audit** | Cloud Audit Logs (Drive) | Firestore audit + Cloud Audit Logs |
| **Retention** | Permanente | Audit logs 2 años; Signed URLs 15 min TTL |

---

## Requisitos No Funcionales

- **Latencia auth:** < 500ms p95 (Firestore read + Drive signed URL generation)
- **Disponibilidad:** 99.9% (Cloud Run + Firestore)
- **Escalabilidad:** 100 req/s burst (Cloud Run auto-scale)
- **Costo:** < $20/mes (Cloud Run + Firestore + Drive API)

---

## Criterios de Aceptación

- [ ] Carpeta `00_PUBLICO_TRANSPARENCIA` accesible via link público (Viewer)
- [ ] Google Site público muestra documentos de transparencia correctamente
- [ ] `enka-auth-gateway` deployado en Cloud Run con IAP habilitado
- [ ] POST `/auth/vista-ciega` valida 3 factores contra Firestore
- [ ] Match exitoso → retorna Signed URL válida (TTL 900s) para SU documento
- [ ] Match fallido → 403 sin revelar información (timing-safe)
- [ ] Rate limiting funciona (5 req/hora por IP/apt)
- [ ] Auditoría registra todos los intentos (éxito/fallo)
- [ ] Documentos en `01_PRIVADO_VECINOS/` NO accesibles por link directo
- [ ] Engram hito registrado
