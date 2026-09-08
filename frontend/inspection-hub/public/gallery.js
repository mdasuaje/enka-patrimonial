// gallery.js - Zero-Copy Atlas Fotográfico ENKA
// Cero dependencias disk: todas las imágenes sirven desde Google Drive SSoT
// Intersection Observer para lazy loading, atributos data-drive-id para consumir
// por futuro Middleware Google Apps Script.

/*
 * ATENCIÓN: Este módulo asume que gallery-data.js ya ha sido cargado
 * y que galleryData[] está disponible en el scope global.
 * Cada objeto debe tener: idx, name, eje, thumb, full (URL Drive).
 * Las thumbnails usan data-drive-id en lugar de rutas locales.
 */

// Configuración global después de cargar gallery-data.js
window.ENKA_DRIVE_FOLDER = "1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY";
window.ENKA_IMAGE_COUNT = 0;
window.ENKA_CURRENT_EJE = 0;

// Inicializar conteo después de DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
    initGallery();
});

/**
 * Inicializa el galería con lazy loading y atributos data-drive-id.
 * Reemplaza src locales por data-drive-id y dispara observer.
 */
function initGallery() {
    // Contar imágenes totales
    const allImages = document.querySelectorAll('img[data-drive-id]');
    window.ENKA_IMAGE_COUNT = allImages.length;

    // Configurar Intersection Observer para lazy loading
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    // Cargar src desde data-drive-id construct URL
                    const driveId = img.getAttribute("data-drive-id");
                    if (driveId && !img.src) {
                        // Construct Google Drive thumbnail URL
                        // Patrones: size=w400 para thumbnails, size=original para full
                        const sizeSuffix = img.dataset.size || "w400";
                        img.src = `https://drive.google.com/thumbnail?id=${driveId}&sz=${sizeSuffix}`;
                        // Remover observer después de cargar
                        observer.unobserve(img);
                    }
                }
            });
        },
        {
            root: null, // viewport
            rootMargin: "0px 0px 200px 0px", // cargar 200px antes de vista
            threshold: 0.1,
        }
    );

    // Observar todas las imágenes con data-drive-id
    for (const img of allImages) {
        observer.observe(img);
    });
}

/**
 * Obtener etiqueta del eje para display
 */
function getEjeLabel(eje) {
    const labels = {
        1: "Eje I: Contexto y Fachada",
        2: "Eje II: Autogestión Azotea",
        3: "Eje III: Patologías Estructurales",
        4: "Eje IV: Evaluación de Riesgo Civil",
    };
    return labels[eje] || `Eje ${eje}`;
}

/**
 * Obtener clase CSS del eje
 */
function getEjeClass(eje) {
    return `eje-${eje}`;
}

// Exponer globals para compatibilidad con HTML antiguo
window.ENKA_DRIVE_FOLDER = window.ENKA_DRIVE_FOLDER || ENKA_DRIVE_FOLDER;
window.getEjeLabel = getEjeLabel;
window.getEjeClass = getEjeClass;
