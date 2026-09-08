# 🏛️ Edificio ENKA — Expediente Técnico Digital y Gestión Patrimonial

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live%20Portal-00E676?style=for-the-badge&logo=github&logoColor=black)](https://mdasuaje.github.io/enka-patrimonial/)
[![Patrimonio](https://img.shields.io/badge/Bien%20de%20Inter%C3%A9s%20Cultural-G.O.%2039.272-38BDF8?style=for-the-badge&logo=monument&logoColor=white)](https://mdasuaje.github.io/enka-patrimonial/evidencia/index.html)
[![Seguridad](https://img.shields.io/badge/Arquitectura-Zero--Copy%20%7C%20Zero--Trust-A855F7?style=for-the-badge&logo=shield&logoColor=white)](https://mdasuaje.github.io/enka-patrimonial/)
[![Bóveda SSoT](https://img.shields.io/badge/Drive%20Vault-SSoT%20Active-FFD700?style=for-the-badge&logo=googledrive&logoColor=black)](https://drive.google.com/drive/folders/1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY?usp=drive_link)
[![Verificación](https://img.shields.io/badge/Integridad-SHA--256%20Verified-F59E0B?style=for-the-badge&logo=checkmarx&logoColor=white)](https://github.com/mdasuaje/enka-patrimonial/blob/main/evidencia/checksums.sha256)

> **EDIFICIO ENKA:** EDIFICIO ENKA: Bien de Interés Cultural según G.O. N° 39.272 (Providencia IPC N° 019/09). Categoría de 'Lo Construido' (Registro N° 734). Avenida Fermín Toro, San Bernardino, Caracas, 1011. Gestión del inmueble tras el sismo del 24 de Jun 2026. Ante riesgos estructurales, la comunidad ejecuta reparaciones por autogestión (Art. 762 del Código Civil). En búsqueda de apoyo institucional de la Alcaldía de Caracas para restaurar fachadas y resguardar su valor patrimonial.

---

## 🌐 Portal Canónico y Acceso Directo

El repositorio expone la infraestructura documental y la interfaz web del expediente técnico de conservación del Edificio ENKA bajo arquitectura **Zero-Copy**:

* 🚀 **[Portal de Inspección y Expediente Digital (Live)](https://mdasuaje.github.io/enka-patrimonial/)**
* 📑 **[Dossier Completo de Evidencias Técnicas](https://mdasuaje.github.io/enka-patrimonial/evidencia/index.html)**
* 🗄️ **[Bóveda Multimedia SSoT en Google Drive (Carpeta Oficial)](https://drive.google.com/drive/folders/1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY?usp=drive_link)**
* 📁 **[Expediente Institucional en Google Drive](https://drive.google.com/drive/folders/1GPRxyz1k4tpY83RbJj7peFq7gdPHge3F)**

---

## 🏗️ Matriz de Avance y Plan de Intervención

| Fase | Alcance Técnico | Estatus | Responsable | Financiamiento / Modelo |
| :--- | :--- | :---: | :--- | :--- |
| **Fase I: Azotea** | Rehabilitación de muro parapetado (13 m lineales × 1.42 m alto), 4 columnas de amarre (0.20 m ancho), mampostería ligera e impermeabilización con manto asfáltico. | `COMPLETADA` | Comunidad ENKA | **Autogestión Vecinal ($1,026.00 USD)** |
| **Fase II: Columnas y Estructura** | Saneamiento de columnas de carga (concreto carbonatado post-sismo 24-Jun-2026), inhibidor de corrosión en cabillas expuestas, aplicación de SikaGrout y remoción de escombros losa superior. | `EN PROGRESO` | Comité Técnico Vecinal | Autogestión / Recursos de Emergencia (Art. 762 CC) |
| **Fase III: Fachadas y Ornato** | Remoción de frisos exteriores en riesgo de desprendimiento (Av. Fermín Toro / Av. Rafael Seijas) y restauración de herrería Art Decó original (70 años) bajo directrices IPC. | `GESTIÓN INST.` | Alcaldía de Caracas / IPC | **Solicitud Institucional (Oficio 04-Sep-2026)** |

---

## 🔒 Arquitectura de Gobernanza: Zero-Copy & Bi-Dominio

El sistema implementa el estándar **SSoT (Single Source of Truth) y Zero-Copy**:

1. **Bóveda Multimedia Exclusiva (Zero-Copy):** Cero almacenamiento local de fotos o videos en GitHub. Todos los activos multimedia (53 registros fotográficos de inspección) se sirven y respaldan exclusivamente desde la bóveda central en Google Drive (`1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY`).
2. **Aislamiento Bi-Dominio & Privacidad:** La información financiera, firmas de residentes y estados de cuenta se administran bajo almacenamiento seguro en Google Sheets / Drive con **Strict-RLS (Row-Level Security)**.
3. **Punto de Entrada Canónico:** Raíz limpia sin errores 404, redirigiendo de forma transparente e instantánea al módulo de evidencias con interfaz de alto contraste (`#1E1E1E`).
4. **Verificación de Integridad:** Paquetes de distribución sellados mediante checksums criptográficos SHA-256.

---

## 📸 Atlas Fotográfico de Patologías (Ejes I–IV)

El módulo en [`evidencia/index.html`](https://mdasuaje.github.io/enka-patrimonial/evidencia/index.html) clasifica 53 registros fotográficos organizados en 4 ejes probatorios conectados directamente a la bóveda SSoT de Google Drive:

* **Eje I: Contexto Patrimonial:** Entorno urbano, arquitectura Art Decó e identificación de catalogación oficial (BIC N° 734).
* **Eje II: Evidencias de Autogestión:** Memoria técnica de la Fase I (muro y columnas de amarre en azotea).
* **Eje III: Patologías de Fachada:** Desprendimiento de frisos y fisuras en Av. Fermín Toro y Av. Rafael Seijas.
* **Eje IV: Riesgo Estructural y Civil:** Columnas críticas expuestas tras el sismo del 24 de Junio de 2026 y zonas de resguardo.

---

## 📜 Marco Jurídico e Institucional

* **Gaceta Oficial N° 39.272 (Providencia IPC N° 019/09):** Declaratoria de Bien de Interés Cultural, Categoría "Lo Construido" (Registro N° 734).
* **Código Civil de Venezuela (Art. 762 & 759):** Facultades y deberes de la comunidad de comuneros para ejecutar reparaciones urgentes y conservación de cosas comunes.
* **Oficio de Consignación:** Solicitud formal de co-custodia radicada ante la Alcaldía de Caracas (A/J Carmen Meléndez) e Instituto del Patrimonio Cultural (IPC).

---

© 2026 **Comité Técnico Vecinal de Co-Custodia del Edificio ENKA** · Caracas, Venezuela.
