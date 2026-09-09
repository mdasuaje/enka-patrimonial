/**
 * Google Apps Script Middleware for ENKA Photo Atlas
 * Reads Google Drive folder and returns thumbnail links for institutional dashboard
 */

/**
 * Function to get photos from Drive folder
 * @param {Object} e - Event object with parameter folderId
 * @return {Object} JSON with thumbnail URLs and metadata
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
      filesArray.push({
        id: file.getId(),
        name: file.getName(),
        thumbnailLink: file.getThumbnailLink(),
        downloadLink: file.getDownloadUrl(),
        size: file.getSize(),
        created: file.getDateCreated(),
        modified: file.getDateModified()
      });
    }
    
    // Sort by name for consistent ordering
    filesArray.sort(function(a, b) {
      return a.name.localeCompare(b.name);
    });
    
    // Return JSON response
    return ContentService
      .setMimeType(ContentService.MimeType.JSON)
      .publish(JSON.stringify({
        success: true,
        folderId: folderId,
        fileCount: filesArray.length,
        files: filesArray
      }));
  } catch (error) {
    // Return error JSON
    return ContentService
      .setMimeType(ContentService.MimeType.JSON)
      .publish(JSON.stringify({
        success: false,
        error: error.message,
        folderId: e.parameter?.folderId
      }));
  }
}
