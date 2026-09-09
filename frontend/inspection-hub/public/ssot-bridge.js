// ssot-bridge.js - Native SSoT Middleware Bridge
// Fetch API bridge para consumir Google Apps Script Web App
// Genera DOM dinámicamente con la estética Dashboard "Hoja de Papel"

// CONFIGURATION - URL del Web App GAS (pending injection by admin)
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbZ8eM3dMmypVYzKQkLdKzXuXuVNT6dKZ8e9N1lCWXW8/exec'; // TODO: Reemplazar con URL Web App deploy

/**
 * Función asíncrona para consumir el SSoT Middleware GAS
 * @param {string} folderId - ID de la carpeta Drive del Atlas Fotográfico
 * @returns {Promise<Object>} - Datos parsed con metadatos JSON
 */
async function loadSSOTMetadata(folderId = '1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY') {
  const url = `${https://script.google.com/macros/s/AKfycbzeSVLZuj_5ZUWzYcgAKeTepH0luat9oLenF7IcwL6X_Iu6DeqpKZPZ48bmSbt06qM/exec}?folderId=${encodeURIComponent(folderId)}`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      credentials: 'omit'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.success || !data.files) {
      throw new Error('Invalid SSOT response structure');
    }
    
    return {
      success: data.success,
      folderId: data.folderId,
      fileCount: data.fileCount,
      files: data.files.map(f => ({
        id: f.id,
        name: f.name,
        thumbnailLink: f.thumbnailLink,
        description: f.description,
        meta: f.meta || {}
      })
    };
  } catch (error) {
    console.error('❌ Error fetching SSOT metadata:', error);
    return {
      success: false,
      error: error.message,
      files: [],
      folderId: folderId
    };
  }
}

/**
 * Función helper para escapar HTML y prevenir XSS
 * @param {string} text - Texto a escapar
 * @returns {string} - Texto escapado seguro
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Función para renderizar las tarjetas SSOT al DOM de forma segura
 * @param {Object} data - Datos del SSOT retornados por loadSSOTMetadata
 * @param {HTMLElement} container - Contenedor HTML donde insertar las tarjetas
 */
function renderSSOTCards(data, container) {
  // Limpiar contenedor de forma segura
  container.innerHTML = '';
  
  if (!data.success || data.files.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'no-results';
    emptyMsg.textContent = 'No hay evidencia disponible';
    container.appendChild(emptyMsg);
    return;
  }
  
  // Crear arreglo de datos seguro
  const cardsData = data.files.map(file => ({
    id: file.id,
    name: file.name,
    thumbnailLink: file.thumbnailLink || 'https://via.placeholder.com/200',
    diagnostico: file.meta && file.meta.diagnostico_tecnico ? file.meta.diagnostico_tecnico : 'Sin diagnóstico asignado',
    fase_obra: file.meta && file.meta.fase_obra ? file.meta.fase_obra : 'Fase pending'
  }));
  
  const fragment = document.createDocumentFragment();
  
  cardsData.forEach(file => {
    // Card container
    const card = document.createElement('div');
    card.className = 'ssot-card';
    card.setAttribute('data-file-id', file.id);
    card.setAttribute('data-name', file.name);
    
    // Card header with SVG icon
    const header = document.createElement('div');
    header.className = 'ssot-card-header';
    header.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18" />
        <path d="M9 21V9" />
      </svg>
      <span class="ssot-filename">${escapeHtml(file.name)}</span>`;
    
    // Card body
    const body = document.createElement('div');
    body.className = 'ssot-card-body';
    body.innerHTML = `
      <div class="ssot-meta">
        <div class="meta-row">
          <span class="meta-label">Diagnóstico:</span>
          <span class="meta-value">${escapeHtml(file.diagnostico)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Fase Obra:</span>
          <span class="meta-value">${escapeHtml(file.fase_obra)}</span>
        </div>
      </div>
      <small class="ssot-caption">${escapeHtml(file.name)}</small>`;
    
    // Thumbnail image
    const img = document.createElement('img');
    img.className = 'ssot-thumbnail';
    img.src = file.thumbnailLink;
    img.alt = file.name;
    img.loading = 'lazy';
    
    // Append elements to card
    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(img);
    fragment.appendChild(card);
  });
  
  container.appendChild(fragment);
  
  // Inject minimal CSS safely
  const style = document.createElement('style');
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
async function initSSOT(containerId = 'dossier-nativo-container', folderId = '1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY') {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Container ${containerId} not found`);
    return;
  }
  
  // Mostrar estado de loading mientras se carga
  container.innerHTML = `
    <div class="loading-state">
      <svg width="32" height="32" viewBox="0 0 32 32" role="status">
        <circle cx="16" cy="16" r="14" fill="none" stroke-width="3" />
        <circle cx="16" cy="16" r="6" fill="currentColor" stroke-width="3" />
      </svg>
      <span>Conectando con el SSoT Institucional...</span>
    </div>`;
  
  const data = await loadSSOTMetadata(folderId);
  renderSSOTCards(data, container);
}

// Auto-initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  initSSOT();
});