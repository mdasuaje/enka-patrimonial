# PRD-002: Actualización Portal ENKA — Plan Septiembre 2026 (Fases II y III)

## Contexto

Actualización del **Dossier Técnico Digital Edificio ENKA** para reflejar el estado oficial al 07-Sept-2026 según la carpeta Drive "ENKA SEPTIEMBRE 2026" (ID: 1GPRxyz1k4tpY83RbJj7peFq7gdPHge3F).

## Objetivos

1. **Visibilizar progreso Fase II** (Intervención Columnas y Áreas Comunes) como "En Progreso"
2. **Elevar Fase III** (Restauración Fachadas) a estado "Gestión Institucional" con solicitud formal a Alcaldía
3. **Integrar capa financiera** con esquema de recaudación vecinal (Google Sheets + Strict-RLS)
4. **Alinear arquitectura digital** con propuesta "Dossier ENKA Live" (Google Sites + Looker Studio + Google Lens)

---

## Requisitos Funcionales

### RF-01: Estado de Fases Actualizado

- **Fase I**: Completada (Agosto 2026) — Muro parapetado 13 m lineales, 4 columnas amarre, mampostería ligera, media caña + manto asfáltico
- **Fase II**: En Progreso — Saneamiento columnas (SikaGrout), remoción frisos sueltos P1, desalojo escombros losa superior
- **Fase III**: Gestión Institucional — Restauración fachadas Av. Fermín Toro y Rafael Seijas, conservación herrería Art Decó 70 años bajo directrices IPC

### RF-02: Documentos Oficiales Vinculados

- `solicitud_apoyo_enka-v2.pdf` (Sep 04) → Enlace a Alcaldía Caracas (A/J Carmen Meléndez)
- `remision_reglamento_enka.pdf` (Sep 04) → Reglamento Interno aprobado Ago 23, 2026
- Anexo Técnico: Matriz Patologías y Autogestión
- Esquema Recaudación Septiembre 2026 (Google Sheets + Apps Script)

### RF-03: Capa Financiera (Strict-RLS)

- Dashboard Looker Studio embebido en Google Sites
- Filtros por `Correo_Propietario` (RLS a nivel fila)
- 3 Scorecards: Deuda Histórica, Total Pagado, Saldo Pendiente
- Gráfico anillos: Transparencia gastos comunes (Corpoelec, Hidrocapital) — sin RLS
- Formulario recaudación: Apartamento (PB-18), Nombre, Concepto, Método, Monto USD, Ref BNC, Comprobante

### RF-04: Arquitectura Digital "ENKA Live"

| Capa | Tecnología | Función |
| ------ | ------------ | --------- |
| Presentación | Google Sites | Micrositio "Expediente Técnico: Edificio ENKA" |
| Repositorio | Google Photos + Drive | Álbumes/carpetas públicas integradas |
| Analítica | Looker Studio | Dashboard % áreas recuperadas vs críticas (Strict-RLS) |
| Ingesta | Google Lens | Categorización automática patologías desde smartphone |

---

## Requisitos No Funcionales

- **Mobile-First**: Canvas 1280×720 px, alto contraste `#1E1E1E`
- **Acceso institucional**: Enlaces directos a PDFs oficiales en Drive (públicos)
- **Trazabilidad**: Cada fase con especificaciones técnicas y estado legal
- **Performance**: Carga < 3s en 3G, sin dependencias pesadas

---

## Criterios de Aceptación

- [ ] Header muestra "Sep 2026 — Fase II En Progreso / Fase III Gestión Institucional"
- [ ] Tarjetas de fase reflejan especificaciones del Anexo Técnico
- [ ] Sección "Documentos Oficiales" con enlaces a PDFs Drive
- [ ] Módulo financiero: iframe Looker Studio + formulario Google Forms/Apps Script
- [ ] Badge "ENKA Live Architecture" con 4 capas
- [ ] Galería existente (Ejes I-IV) preservada y funcional
