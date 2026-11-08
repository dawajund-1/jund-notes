// Mustatar App - Main Frontend Script with Updated Upload Limits
// Increased file size limits: 50 MB for documents/PDFs, 60 MB for media/audio files.

const MAX_FILE_SIZE_DOCUMENT = 50 * 1024 * 1024; // 50 MB
const MAX_FILE_SIZE_MEDIA = 60 * 1024 * 1024;    // 60 MB
const MAX_FILES_COUNT = 8;

function validateAndQueueFiles(files) {
  if (files.length > MAX_FILES_COUNT) {
    alert(`Choose up to ${MAX_FILES_COUNT} supported files.`);
    return false;
  }
  
  for (let file of files) {
    const isAudio = file.type.startsWith('audio/') || file.name.endsWith('.mp3') || file.name.endsWith('.m4a') || file.name.endsWith('.wav');
    const limit = isAudio ? MAX_FILE_SIZE_MEDIA : MAX_FILE_SIZE_DOCUMENT;
    const limitLabel = isAudio ? '60 MB' : '50 MB';

    if (file.size > limit) {
      alert(`File "${file.name}" is too large. Maximum allowed size is ${limitLabel}.`);
      return false;
    }
  }
  return true;
}

// Initializing event listeners for file upload components
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const selectedFiles = Array.from(e.target.files);
      if (validateAndQueueFiles(selectedFiles)) {
        console.log('Files successfully accepted for review and upload.');
      }
    });
  }
});
