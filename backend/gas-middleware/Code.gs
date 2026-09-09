/**
 * Google Apps Script Middleware for ENKA Photo Atlas
 * Reads Google Drive folder and returns thumbnail links for institutional dashboard
 */

/**
 * Function to get photos from Drive folder with JSON metadata parsing
 * @param {Object} e - Event object with parameter folderId
 * @return {Object} JSON with thumbnail URLs and parsed metadata
 */
function doGet(e) {
  try {
    // Get folder ID from query parameter
    var folderId = e.parameter.folderId || '1oq-3k-wP2NEOUZrRoPTJXtxlBwbWc0OY';
    
    // Get the folder
    var folder = DriveApp.getFolderById(folderId);
    
    // Get all files in the folder
    var files = folder.getFiles();
    var filesArray = [];
    
    while (files.hasNext()) {
      var file = files.next();
      // Parse JSON description from file, with defaults
      var description = file.getDescription();
      var parsedMeta = {};
      try {
        parsedMeta = JSON.parse(description);
      } catch (e) {
        // Use defaults if description is empty or not valid JSON
        parsedMeta = {
          id_evidencia: file.getName(),
          fecha_captura: '',
          ubicacion_geo: '',
          diagnostico_tecnico: 'Sin diagnóstico asignado',
          fase_obra: 'Fase pending'
        };
      }
      
      filesArray.push({
        id: file.getId(),
        name: file.getName(),
        thumbnailLink: file.getThumbnailLink(),
        downloadLink: file.getDownloadUrl(),
        size: file.getSize(),
        created: file.getDateCreated(),
        modified: file.getDateModified(),
        description: file.getDescription(),
        meta: parsedMeta
      });
    }
    
    // Sort by name for consistent ordering
    filesArray.sort(function(a, b) {
      return a.name.localeCompare(b.name);
    });
    
    // Return JSON response with CORS headers
    var output = ContentService
      .setMimeType(ContentService.MimeType.JSON)
      .publish(JSON.stringify({
        success: true,
        folderId: folderId,
        fileCount: filesArray.length,
        files: filesArray
      }));
    
    // Explicit CORS headers for SSoT consumption
    output = ContentService.addHeader(output, 'Access-Control-Allow-Origin', '*');
    output = ContentService.addHeader(output, 'Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    output = ContentService.addHeader(output, 'Access-Control-Allow-Headers', 'Content-Type');
    
    return output;
  } catch (error) {
    // Return error JSON
    try {
      var errorOutput = ContentService
        .setMimeType(ContentService.MimeType.JSON)
        .publish(JSON.stringify({
          success: false,
          error: error.message,
          folderId: e.parameter?.folderId
        }));
      return ContentService.addHeader(errorOutput, 'Access-Control-Allow-Origin', '*');
    } catch (e) {
      return ContentService
        .setMimeType(ContentService.MimeType.TEXT)
        .publish('Error interno del servidor: ' + error.message);
    }
  }
}
