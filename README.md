# 🏛️ Edificio ENKA — Expediente Técnico Digital y Gestión Patrimonial

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live%20Portal-00E676?style=for-the-badge&logo=github&logoColor=black)](https://mdasuaje.github.io/enka-patrimonial/)
[![Patrimonio](https://img.shields.io/badge/Bien%20de%20Inter%C3%A9s%20Cultural-G.O.%2039.272-38BDF8?style=for-the-badge&logo=monument&logoColor=white)](https://mdasuaje.github.io/enka-patrimonial/evidencia/index.html)
[![Seguridad](https://img.shields.io/badge/Arquitectura-Zero--Trust%20%2F%20Bi--Dominio-A855F7?style=for-the-badge&logo=shield&logoColor=white)](https://mdasuaje.github.io/enka-patrimonial/)
[![Verificacion](https://img.shields.io/badge/Integridad-SHA--256%20Verified-F59E0B?style=for-the-badge&logo=checkmarx&logoColor=white)](https://github.com/mdasuaje/enka-patrimonial/blob/main/evidencia/checksums.sha256)

> **Inmueble:** Edificio ENKA  
> **Estatus Legal:** Bien de Interés Cultural de la Nación (**Gaceta Oficial Nro. 39.272**, Catálogo IPC N° 734)  
> **Régimen de Custodia:** Comunidad de Bienes (Art. 759 del Código Civil Venezolano) & Co-Custodia Vecinal  
> **Ubicación:** Av. Fermín Toro ∩ Av. Rafael Seijas, Urbanización San Bernardino, Caracas  
> **Portal Canónico:** [https://mdasuaje.github.io/enka-patrimonial/](https://mdasuaje.github.io/enka-patrimonial/)

---

## 🌐 Portal Canónico y Acceso Directo

El repositorio expone la infraestructura documental y fotográfica del expediente técnico de conservación del Edificio ENKA:

* 🚀 **[Portal de Inspección y Expediente Digital (Live)](https://mdasuaje.github.io/enka-patrimonial/)**
* 📑 **[Dossier Completo de Evidencias Técnicas](https://mdasuaje.github.io/enka-patrimonial/evidencia/index.html)**
* 📁 **[Expediente Oficial en Google Drive](https://drive.google.com/drive/folders/1GPRxyz1k4tpY83RbJj7peFq7gdPHge3F)**

---

## 🏗️ Matriz de Avance y Plan de Intervención

| Fase | Alcance Técnico | Estatus | Responsable | Financiamiento / Modelo |
| :--- | :--- | :---: | :--- | :--- |
| **Fase I: Azotea** | Rehabilitación de muro parapetado (13 m lineales × 1.42 m alto), 4 columnas de amarre (0.20 m ancho), mampostería ligera e impermeabilización con manto asfáltico. | `COMPLETADA` | Comunidad ENKA | **Autogestión Vecinal ($1,026.00 USD)** |
| **Fase II: Columnas y Estructura** | Saneamiento de columnas de carga (concreto carbonatado post-sismo), inhibidor de corrosión en cabillas expuestas, aplicación de SikaGrout y remoción de escombros losa superior. | `EN PROGRESO` | Comité Técnico Vecinal | Autogestión / Recursos de Emergencia |
| **Fase III: Fachadas y Ornato** | Remoción de frisos exteriores en riesgo de desprendimiento (Av. Fermín Toro / Av. Rafael Seijas) y restauración de herrería Art Decó original (70 años) bajo directrices IPC. | `GESTIÓN INST.` | Alcaldía de Caracas / IPC | **Solicitud Institucional (Oficio 04-Sep-2026)** |

---

## 🔒 Arquitectura de Gobernanza: Zero-Trust & Bi-Dominio

El sistema implementa el estándar **SSoT (Single Source of Truth) y Zero-Copy**:
1. **Aislamiento Bi-Dominio:** La información financiera sensible, datos personales y estados de cuenta se administran exclusivamente bajo almacenamiento seguro en Google Sheets y Google Drive con **Strict-RLS (Row-Level Security)** filtrado por correo de copropietario.
2. **Capa de Presentación Pública:** El repositorio público de GitHub Pages aloja únicamente el portal estático, metadatos no sensibles y el atlas fotográfico de inspección patológica.
3. **Punto de Entrada Canónico:** Arquitectura de raíz limpia sin errores 404, redirigiendo de forma transparente e instantánea al módulo de evidencia con soporte visual de alto contraste (`#1E1E1E`).
4. **Verificación de Integridad:** Paquetes de distribución y evidencias sellados criptográficamente mediante hash SHA-256.

---

## 📸 Atlas Fotográfico de Patologías (Ejes I–IV)

La galería interactiva en [`evidencia/index.html`](https://mdasuaje.github.io/enka-patrimonial/evidencia/index.html) clasifica 53 registros fotográficos de alta resolución organizados en 4 ejes probatorios:
* **Eje I: Contexto Patrimonial:** Entorno urbano, arquitectura Art Decó e identificación de catalogación oficial.
* **Eje II: Evidencias de Autogestión:** Memoria fotográfica de ejecución de la Fase I (muro y columnas de azotea).
* **Eje III: Patologías de Fachada:** Fisuras, grietas y desprendimiento de revestimientos hacia vías públicas.
* **Eje IV: Riesgo Estructural y Civil:** Columnas expuestas, corrosión de armadura y zonas críticas de resguardo.

---

## 📜 Marco Jurídico e Institucional

* **Gaceta Oficial de la República Bolivariana de Venezuela Nro. 39.272:** Declaratoria de Bien de Interés Cultural.
* **Código Civil de Venezuela (Art. 759):** Régimen de Comunidad de Bienes para conservación de cosas comunes.
* **Oficio de Consignación:** Solicitud formal de apoyo institucional radicada ante la Alcaldía de Caracas (A/J Carmen Meléndez) e Instituto del Patrimonio Cultural (IPC).

---

© 2026 **Comité Técnico Vecinal de Co-Custodia del Edificio ENKA** · Caracas, Venezuela.
