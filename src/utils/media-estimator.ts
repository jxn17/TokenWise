/**
 * TokenWise Media Estimator
 *
 * Estimates token costs for file attachments, images, PDFs, and URLs.
 * Only reads metadata (name, size, type) — never reads file contents.
 */

import { estimateImageTokens, quickEstimate } from './tokenizer';
import { getCompressionResources } from './compression-resources';

export type FileCategory =
  | 'text'
  | 'image'
  | 'pdf'
  | 'video'
  | 'audio'
  | 'spreadsheet'
  | 'document'
  | 'presentation'
  | 'archive'
  | 'unknown';

export interface FileEstimate {
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  estimatedTokens: number;
  category: FileCategory;
  tip: string;
  optimizationTips: string[];
}

export interface URLEstimate {
  url: string;
  type: 'youtube' | 'general';
  tip: string;
}

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.c', '.cpp',
  '.h', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala',
  '.html', '.css', '.scss', '.less', '.json', '.xml', '.yaml', '.yml',
  '.toml', '.ini', '.cfg', '.conf', '.sh', '.bash', '.zsh', '.ps1',
  '.sql', '.r', '.m', '.mm', '.lua', '.perl', '.pl', '.vim', '.el',
  '.log', '.env', '.gitignore', '.dockerfile',
]);

const SPREADSHEET_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv', '.tsv', '.ods']);
const DOCUMENT_EXTENSIONS = new Set(['.docx', '.doc', '.odt', '.rtf']);
const PRESENTATION_EXTENSIONS = new Set(['.pptx', '.ppt', '.odp']);
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2']);

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.ico', '.tiff',
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v',
]);

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.wma', '.m4a',
]);

const CHARS_PER_TOKEN_TEXT = 3.8;
const TOKENS_PER_KB_PDF = 250;
const TOKENS_PER_KB_DOC = 200;
const TOKENS_PER_KB_PPT = 150;

const URL_REGEX = /https?:\/\/(?:[\w-]+\.)+[\w]{2,}(?:\/[^\s]*)?/gi;
const YOUTUBE_REGEX = /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)[A-Za-z0-9_-]{11}/i;

export function estimateFileTokens(
  fileName: string,
  fileSizeBytes: number,
  fileType?: string,
  imageWidth?: number,
  imageHeight?: number
): FileEstimate {
  const safeName = sanitizeFileName(fileName);
  const safeSize = Math.max(0, fileSizeBytes);
  const extension = getExtension(safeName).toLowerCase();
  const category = detectFileCategory(extension, fileType);

  let estimatedTokens = 0;
  let tip = '';
  const optimizationTips: string[] = [];

  switch (category) {
    case 'text': {
      if (safeSize === 0) {
        // Can't estimate without reading file contents — show a caution
        estimatedTokens = -1;
        tip = '⚠️ Text/Markdown token cost depends on content length and cannot be estimated.';
      } else {
        estimatedTokens = Math.ceil(safeSize / CHARS_PER_TOKEN_TEXT);
        const kbSize = Math.round(safeSize / 1024);
        tip = kbSize > 50
          ? `Text file ${kbSize}KB (~${estimatedTokens.toLocaleString()} tokens). Paste only relevant sections.`
          : `Text file: ~${estimatedTokens.toLocaleString()} tokens`;
      }
      optimizationTips.push('Copy only the lines you need instead of the full file');
      optimizationTips.push('Remove comments and boilerplate before pasting');
      break;
    }

    case 'spreadsheet': {
      if (safeSize === 0) {
        // Can't estimate without file contents — show a caution instead of a made-up number
        estimatedTokens = -1;
        tip = '⚠️ Spreadsheet token cost depends on row/column count and cannot be estimated.';
      } else {
        estimatedTokens = Math.ceil(safeSize / CHARS_PER_TOKEN_TEXT);
        tip = `Spreadsheet (~${estimatedTokens.toLocaleString()} tokens). Export as CSV with only needed columns.`;
      }
      optimizationTips.push('Export a CSV with only required columns — models read CSV natively');
      optimizationTips.push('Delete empty rows and hidden sheets before attaching');
      optimizationTips.push('Summarize aggregates in text instead of uploading raw data');
      break;
    }

    case 'document': {
      if (safeSize === 0) {
        estimatedTokens = 600;
        tip = 'Document: ~600 tokens (size unknown — actual cost depends on length).';
      } else {
        const kbSize = Math.max(1, Math.round(safeSize / 1024));
        estimatedTokens = Math.ceil(kbSize * TOKENS_PER_KB_DOC);
        tip = `Word document (~${estimatedTokens.toLocaleString()} tokens). Paste relevant sections only.`;
      }
      optimizationTips.push('Copy only the chapter or section you need');
      optimizationTips.push('Convert to plain text or markdown for smaller token cost');
      break;
    }

    case 'presentation': {
      if (safeSize === 0) {
        estimatedTokens = 400;
        tip = 'Presentation: ~400 tokens (size unknown — actual cost depends on slide count).';
      } else {
        const kbSize = Math.max(1, Math.round(safeSize / 1024));
        estimatedTokens = Math.ceil(kbSize * TOKENS_PER_KB_PPT);
        tip = `Presentation (~${estimatedTokens.toLocaleString()} tokens). Export slide outline as text.`;
      }
      optimizationTips.push('Export speaker notes or bullet outline instead of full deck');
      optimizationTips.push('Attach only slides relevant to your question');
      break;
    }

    case 'archive': {
      estimatedTokens = -1;
      tip = 'Archive files are expensive — extract only needed files first.';
      optimizationTips.push('Extract specific files instead of uploading the whole archive');
      optimizationTips.push('Compress contents before attaching individual files');
      break;
    }

    case 'image': {
      if (imageWidth && imageHeight && imageWidth > 0 && imageHeight > 0) {
        estimatedTokens = estimateImageTokens(imageWidth, imageHeight, 'high');
        tip = `Image ${imageWidth}×${imageHeight} — ~${estimatedTokens.toLocaleString()} tokens.`;
        if (imageWidth > 2048 || imageHeight > 2048) {
          optimizationTips.push('Resize below 2048px to reduce vision token cost');
        }
      } else {
        estimatedTokens = 765;
        tip = `Image file: ~${estimatedTokens} tokens (estimate).`;
      }
      optimizationTips.push('If the image contains text, paste the text directly instead');
      optimizationTips.push('Crop to the relevant region before uploading');
      break;
    }

    case 'pdf': {
      if (safeSize === 0) {
        // Size not available — use a realistic minimum for a typical 1-2 page PDF.
        // Actual cost is ~1,500–3,000 tokens per page (text content).
        estimatedTokens = 2000;
        tip = 'PDF: ~2,000 tokens (size unknown — typically 1,500–3,000 tokens per page).';
      } else {
        const kbSize = Math.max(1, Math.round(safeSize / 1024));
        estimatedTokens = Math.ceil(kbSize * TOKENS_PER_KB_PDF);
        const pageEstimate = Math.max(1, Math.round(kbSize / 40));
        tip = `PDF (~${pageEstimate} page${pageEstimate > 1 ? 's' : ''}, ~${estimatedTokens.toLocaleString()} tokens).`;
      }
      optimizationTips.push('Extract only the pages you need');
      optimizationTips.push('Copy-paste relevant paragraphs instead of the full PDF');
      break;
    }

    case 'video': {
      // Token cost is impossible to estimate without knowing duration.
      // Models sample ~1 frame/sec; each frame costs ~170–765 tokens depending on resolution.
      estimatedTokens = -1;
      tip = '⚠️ Video: cost varies by duration (~170–765 tokens/sampled frame). Keep clips short.';
      optimizationTips.push('Gemini natively supports video — consider using it for video input');
      optimizationTips.push('Keep clips short — models sample ~1 frame/sec');
      break;
    }

    case 'audio': {
      // Most chat UIs don't support audio natively; Gemini does.
      estimatedTokens = -1;
      tip = '⚠️ Audio support varies by model. Gemini supports audio natively — use it for best results.';
      optimizationTips.push('Gemini natively supports audio — consider using it for audio input');
      optimizationTips.push('Otherwise, transcribe with Whisper and paste only the relevant excerpt');
      break;
    }

    default: {
      estimatedTokens = safeSize > 0 ? Math.ceil(safeSize / CHARS_PER_TOKEN_TEXT) : 300;
      tip = `Unknown file type: ~${estimatedTokens.toLocaleString()} tokens${safeSize === 0 ? ' (size unknown)' : ''}.`;
      optimizationTips.push('Convert to plain text if possible for lower token cost');
      break;
    }
  }

  const compression = getCompressionResources(category);
  if (compression.length > 0) {
    optimizationTips.push(`Compress with ${compression[0].name} before attaching`);
  }

  return {
    fileName: safeName,
    fileType: fileType || extension,
    fileSizeBytes: safeSize,
    estimatedTokens,
    category,
    tip,
    optimizationTips,
  };
}

export function detectURLs(text: string): URLEstimate[] {
  if (!text || text.length === 0) return [];

  const safeText = text.length > 10_000 ? text.slice(0, 10_000) : text;
  const estimates: URLEstimate[] = [];
  const seen = new Set<string>();

  URL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = URL_REGEX.exec(safeText)) !== null) {
    const url = match[0];
    if (seen.has(url)) continue;
    seen.add(url);

    if (YOUTUBE_REGEX.test(url)) {
      estimates.push({
        url,
        type: 'youtube',
        tip: 'YouTube links load full transcripts. Paste only the relevant transcript section.',
      });
    } else {
      estimates.push({
        url,
        type: 'general',
        tip: 'URLs may scrape full page content. Use r.jina.ai/<url> for clean text, or paste only the section you need.',
      });
    }
  }

  return estimates;
}

function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === fileName.length - 1) return '';
  return fileName.slice(lastDot);
}

function detectFileCategory(extension: string, mimeType?: string): FileCategory {
  if (extension === '.pdf' || mimeType === 'application/pdf') return 'pdf';
  if (SPREADSHEET_EXTENSIONS.has(extension) || mimeType?.includes('spreadsheet') || mimeType?.includes('excel')) {
    return 'spreadsheet';
  }
  if (DOCUMENT_EXTENSIONS.has(extension) || mimeType?.includes('wordprocessing') || mimeType === 'application/msword') {
    return 'document';
  }
  if (PRESENTATION_EXTENSIONS.has(extension) || mimeType?.includes('presentation')) {
    return 'presentation';
  }
  if (ARCHIVE_EXTENSIONS.has(extension) || mimeType?.includes('zip') || mimeType?.includes('compressed')) {
    return 'archive';
  }
  if (TEXT_EXTENSIONS.has(extension) || mimeType?.startsWith('text/')) return 'text';
  if (IMAGE_EXTENSIONS.has(extension) || mimeType?.startsWith('image/')) return 'image';
  if (VIDEO_EXTENSIONS.has(extension) || mimeType?.startsWith('video/')) return 'video';
  if (AUDIO_EXTENSIONS.has(extension) || mimeType?.startsWith('audio/')) return 'audio';
  return 'unknown';
}

function sanitizeFileName(name: string): string {
  if (!name) return 'unknown';
  return name.replace(/[/\\:\0]/g, '_').slice(0, 255);
}

export function generateFileTooltip(estimate: FileEstimate): string {
  const icon = getCategoryIcon(estimate.category);
  let tokenStr: string;
  if (estimate.estimatedTokens === -1) {
    tokenStr = estimate.category === 'audio' ? '⚠️ Not supported' : '⚠️ Cost varies';
  } else {
    tokenStr = `~${estimate.estimatedTokens.toLocaleString()} tokens`;
  }
  return `${icon} ${estimate.fileName} — ${tokenStr}`;
}

function getCategoryIcon(category: FileCategory): string {
  switch (category) {
    case 'text': return '📄';
    case 'spreadsheet': return '📊';
    case 'document': return '📝';
    case 'presentation': return '📽️';
    case 'archive': return '🗜️';
    case 'image': return '🖼️';
    case 'pdf': return '📑';
    case 'video': return '🎥';
    case 'audio': return '🎵';
    default: return '📎';
  }
}
