// ssot-bridge.js - Native SSoT Middleware Bridge
// Fetch API bridge para consumir Google Apps Script Web App o JSON estático local
// Genera DOM dinámicamente con la estética Dashboard "Hoja de Papel"

// CONFIGURATION - URL del Web App GAS (inyectar via build/env o usar fallback local)
// Se puede definir window.GAS_WEB_APP_URL antes de cargar este script
const GAS_WEB_APP_URL =
  typeof window !== "undefined" && window.GAS_WEB_APP_URL
    ? window.GAS_WEB_APP_URL
    : "https://script.google.com/macros/s/AKfycbZ8eM3dMmypVYzKQkLdKzXuXuVNT6dKZ8e9N1lCWXW8/exec"; // Fallback: placeholder

// Local static JSON fallback (for development/offline)
const LOCAL_SSOT_JSON = "/data/ssot_dossier.json";

// Configuración de timeout para fallback rápido (1.5s)
const GAS_TIMEOUT_MS = 1500;

/**
 * Función asíncrona para consumir el SSoT Middleware GAS con timeout rápido
 * @param {string} folderId - ID de la carpeta Drive del Atlas Fotográfico
 * @returns {Promise<Object>} - Datos parsed con metadatos JSON
 */
async function loadSSOTMetadata(
  folderId = "1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY",
) {
  // Si no hay GAS URL válida, ir directo a local
  if (!GAS_WEB_APP_URL || !GAS_WEB_APP_URL.includes("script.google.com")) {
    console.info("ℹ️ No GAS Web App URL configured, loading local JSON");
    return loadLocalSSOT();
  }

  // Try GAS Web App with timeout
  try {
    const url = `${GAS_WEB_APP_URL}?folderId=${encodeURIComponent(folderId)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GAS_TIMEOUT_MS);

    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data?.success && data?.files) {
        console.info("✅ SSOT metadata loaded from GAS Web App");
        return normalizeSSOTData(data);
      }
    }
    console.warn("⚠️ GAS Web App response invalid, falling back to local JSON");
  } catch (error) {
    if (error.name === "AbortError") {
      console.warn(
        `⚠️ GAS Web App timeout (${GAS_TIMEOUT_MS}ms), falling back to local JSON`,
      );
    } else {
      console.warn(
        "⚠️ GAS Web App fetch failed, falling back to local JSON:",
        error?.message,
      );
    }
  }

  // Fallback: load from local static JSON
  return loadLocalSSOT();
}

/**
 * Carga metadatos SSoT desde archivo JSON estático local
 * @returns {Promise<Object>} - Datos normalizados
 */
async function loadLocalSSOT() {
  try {
    const response = await fetch(LOCAL_SSOT_JSON, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data?.success || !data?.files) {
      throw new Error("Invalid local SSOT response structure");
    }

    console.info("✅ SSOT metadata loaded from local JSON fallback");
    return normalizeSSOTData(data);
  } catch (error) {
    console.error("❌ Error loading local SSOT metadata:", error);
    return {
      success: false,
      error: error.message,
      files: [],
      folderId: "1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY",
    };
  }
}

/**
 * Normaliza datos SSoT a estructura interna común
 * @param {Object} data - Datos crudos de GAS o JSON local
 * @returns {Object} - Datos normalizados
 */
function normalizeSSOTData(data) {
  return {
    success: data.success,
    folderId: data.folderId,
    fileCount: data.fileCount,
    files: data.files.map((f) => ({
      id: f.id,
      name: f.name,
      thumbnailLink: f.thumbnailLink,
      description: f.description,
      meta: f.meta || {},
    })),
  };
}

/**
 * Función para renderizar las tarjetas SSOT al DOM de forma segura
 * @param {Object} data - Datos del SSOT retornados por loadSSOTMetadata
 * @param {HTMLElement} container - Contenedor HTML donde insertar las tarjetas
 */
function renderSSOTCards(data, container) {
  // Limpiar contenedor de forma segura
  container.innerHTML = "";

  if (!data.success || data.files.length === 0) {
    const emptyMsg = document.createElement("div");
    emptyMsg.className = "no-results";
    emptyMsg.textContent = "No hay evidencia disponible";
    container.appendChild(emptyMsg);
    return;
  }

  // Crear arreglo de datos seguro
  const cardsData = data.files.map((file) => ({
    id: file.id,
    name: file.name,
    thumbnailLink: file.thumbnailLink || "https://via.placeholder.com/200",
    diagnostico:
      file.meta && file.meta.diagnostico_tecnico
        ? file.meta.diagnostico_tecnico
        : "Sin diagnóstico asignado",
    fase_obra:
      file.meta && file.meta.fase_obra ? file.meta.fase_obra : "Fase pending",
  }));

  const fragment = document.createDocumentFragment();

  for (const file of cardsData) {
    // Card container
    const card = document.createElement("div");
    card.className = "ssot-card";
    card.setAttribute("data-file-id", file.id);
    card.setAttribute("data-name", file.name);

    // Card header with SVG icon
    const header = document.createElement("div");
    header.className = "ssot-card-header";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "3");
    rect.setAttribute("y", "3");
    rect.setAttribute("width", "18");
    rect.setAttribute("height", "18");
    rect.setAttribute("rx", "2");
    svg.appendChild(rect);

    const path1 = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    path1.setAttribute("d", "M3 9h18");
    svg.appendChild(path1);

    const path2 = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    path2.setAttribute("d", "M9 21V9");
    svg.appendChild(path2);

    header.appendChild(svg);

    const filenameSpan = document.createElement("span");
    filenameSpan.className = "ssot-filename";
    filenameSpan.textContent = file.name;
    header.appendChild(filenameSpan);

    // Card body
    const body = document.createElement("div");
    body.className = "ssot-card-body";

    const metaDiv = document.createElement("div");
    metaDiv.className = "ssot-meta";

    // Diagnóstico row
    const diagRow = document.createElement("div");
    diagRow.className = "meta-row";
    const diagLabel = document.createElement("span");
    diagLabel.className = "meta-label";
    diagLabel.textContent = "Diagnóstico:";
    const diagValue = document.createElement("span");
    diagValue.className = "meta-value";
    diagValue.textContent = file.diagnostico;
    diagRow.appendChild(diagLabel);
    diagRow.appendChild(diagValue);
    metaDiv.appendChild(diagRow);

    // Fase Obra row
    const faseRow = document.createElement("div");
    faseRow.className = "meta-row";
    const faseLabel = document.createElement("span");
    faseLabel.className = "meta-label";
    faseLabel.textContent = "Fase Obra:";
    const faseValue = document.createElement("span");
    faseValue.className = "meta-value";
    faseValue.textContent = file.fase_obra;
    faseRow.appendChild(faseLabel);
    faseRow.appendChild(faseValue);
    metaDiv.appendChild(faseRow);

    body.appendChild(metaDiv);

    const caption = document.createElement("small");
    caption.className = "ssot-caption";
    caption.textContent = file.name;
    body.appendChild(caption);

    // Thumbnail image
    const img = document.createElement("img");
    img.className = "ssot-thumbnail";
    img.src = file.thumbnailLink;
    img.alt = file.name;
    img.loading = "lazy";

    // Append elements to card
    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(img);
    fragment.appendChild(card);
  }

  container.appendChild(fragment);

  // Inject minimal CSS safely
  const style = document.createElement("style");
  style.textContent = `
    .ssot-container { padding: 1rem; }
    .ssot-card { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 1rem; background: var(--card); overflow: hidden; transition: transform 0.2s; }
    .ssot-card:hover { transform: translateY(-2px); box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .ssot-card-header { padding: 0.75rem; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 0.5rem; }
    .ssot-filename { font-weight: 600; color: var(--fg); font-size: 0.85rem; }
    .ssot-card-body { padding: 0.75rem; }
    .ssot-meta { margin-top: 0.5rem; }
    .meta-row { margin-bottom: 0.25rem; display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--muted); }
    .meta-label { font-weight: 600; color: var(--accent); }
    .meta-value { color: var(--muted); }
    .ssot-thumbnail { width: 100%; height: 120px; object-fit: cover; background: var(--bg); }
    .no-results { padding: 2rem; text-align: center; color: var(--muted); font-size: 0.9rem; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.8; }
  `;

  container.appendChild(style);
}

/**
 * Función inicial para cargar y renderizar el SSoT al cargar página
 * @param {string} containerId - ID del elemento container
 * @param {string} folderId - ID de carpeta Drive opcional
 */
async function initSSOT(
  containerId = "dossier-nativo-container",
  folderId = "1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY",
) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Container ${containerId} not found`);
    return;
  }

  // Cargar y renderizar inmediatamente (sin loading spinner)
  // La función loadSSOTMetadata maneja fallback rápido a JSON local
  const data = await loadSSOTMetadata(folderId);
  renderSSOTCards(data, container);
}

// Auto-initialize on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
  initSSOT();
});
