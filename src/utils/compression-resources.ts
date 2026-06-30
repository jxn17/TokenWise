/**
 * Curated handling-tool links for file attachments.
 *
 * For compressible types (image, pdf) these point to real compression websites.
 * For audio/video they point to Gemini, which natively supports those media types.
 * For document/spreadsheet/text they are advice-only (empty url) rendered as
 * plain text in the suggestion panel.
 *
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
      name: 'Gemini',
      url: 'https://gemini.google.com/',
      description: 'Gemini natively supports video input — use it for better results',
    },
  ],
  audio: [
    {
      name: 'Gemini',
      url: 'https://gemini.google.com/',
      description: 'Gemini natively supports audio input — use it for better results',
    },
  ],
  pdf: [
    {
      name: 'Adobe Acrobat',
      url: 'https://www.adobe.com/acrobat/online/compress-pdf.html',
      description: 'Reduce PDF size before uploading (opens in browser)',
    },
    {
      name: 'iLovePDF',
      url: 'https://www.ilovepdf.com/compress_pdf',
      description: 'Free online PDF compressor',
    },
  ],
  spreadsheet: [
    {
      name: 'Export CSV',
      url: '',
      description: 'Chat models can read CSV. Export only needed columns to cut tokens',
    },
  ],
  document: [
    {
      name: 'Paste sections only',
      url: '',
      description: 'Copy only the section you need, or convert to plain text for fewer tokens',
    },
  ],
  presentation: [
    {
      name: 'Export outline',
      url: '',
      description: 'Export speaker notes or bullet outline as text instead of the full deck',
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
      name: 'Paste excerpt',
      url: '',
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
 * Open a handling-resource URL in a new window (user-initiated only).
 * Advice-only resources (empty url) are a no-op.
 */
export function openCompressionResource(url: string): void {
  if (!url || !url.startsWith('https://')) return;
  try {
    chrome.windows.create({ url, type: 'normal', width: 1100, height: 800 });
  } catch {
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      // Fail silently
    }
  }
}
