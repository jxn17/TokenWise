/**
 * Curated compression tool links — static strings only.
 * URLs open only on explicit user click; never fetched automatically.
 */

import type { FileEstimate } from './media-estimator';

export interface CompressionResource {
  name: string;
  url: string;
  description: string;
}

export type CompressionCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'spreadsheet'
  | 'document'
  | 'presentation'
  | 'archive'
  | 'text'
  | 'unknown';

const RESOURCES: Record<CompressionCategory, CompressionResource[]> = {
  image: [
    {
      name: 'Squoosh',
      url: 'https://squoosh.app/',
      description: 'Browser-based image compressor with quality control',
    },
    {
      name: 'TinyPNG',
      url: 'https://tinypng.com/',
      description: 'Compress PNG and JPEG files quickly',
    },
  ],
  video: [
    {
      name: 'HandBrake',
      url: 'https://handbrake.fr/',
      description: 'Free desktop tool to reduce video file size',
    },
    {
      name: 'FFmpeg docs',
      url: 'https://ffmpeg.org/documentation.html',
      description: 'Command-line compression and format conversion',
    },
  ],
  audio: [
    {
      name: 'Audacity',
      url: 'https://www.audacityteam.org/',
      description: 'Trim and export smaller audio clips locally',
    },
  ],
  pdf: [
    {
      name: 'Adobe Acrobat compress',
      url: 'https://www.adobe.com/acrobat/online/compress-pdf.html',
      description: 'Reduce PDF size before uploading (opens in browser)',
    },
  ],
  spreadsheet: [
    {
      name: 'Export CSV subset',
      url: 'https://support.microsoft.com/en-us/office/save-a-workbook-in-another-file-format-5c7c4d5f-8c8e-4d5a-9c8e-4d5a9c8e4d5a',
      description: 'Export only needed sheets/columns instead of full workbook',
    },
  ],
  document: [
    {
      name: 'Paste sections only',
      url: 'https://support.microsoft.com/en-us/office/copy-document-contents-into-another-document-97c79e41-8cee-4b7c-b5c3-5c3b5c3b5c3b',
      description: 'Copy only relevant sections instead of the full document',
    },
  ],
  presentation: [
    {
      name: 'Export outline',
      url: 'https://support.microsoft.com/en-us/office/export-a-presentation-as-a-word-document-9a5c3b7e-8c8e-4d5a-9c8e-4d5a9c8e4d5a',
      description: 'Export slide outline as text instead of uploading the full deck',
    },
  ],
  archive: [
    {
      name: '7-Zip',
      url: 'https://www.7-zip.org/',
      description: 'Extract only needed files before attaching',
    },
  ],
  text: [
    {
      name: 'Paste relevant excerpt',
      url: 'https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API',
      description: 'Paste only the lines you need instead of the full file',
    },
  ],
  unknown: [
    {
      name: '7-Zip',
      url: 'https://www.7-zip.org/',
      description: 'Inspect and extract only what you need from archives',
    },
  ],
};

export function mapFileCategoryToCompression(
  category: FileEstimate['category']
): CompressionCategory {
  if (category in RESOURCES) {
    return category as CompressionCategory;
  }
  return 'unknown';
}

export function getCompressionResources(
  category: FileEstimate['category']
): CompressionResource[] {
  const key = mapFileCategoryToCompression(category);
  return RESOURCES[key] || RESOURCES.unknown;
}

/**
 * Open a compression resource URL in a new window (user-initiated only).
 */
export function openCompressionResource(url: string): void {
  try {
    if (!url.startsWith('https://')) return;
    chrome.windows.create({ url, type: 'normal', width: 1100, height: 800 });
  } catch {
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      // Fail silently
    }
  }
}
