export type ExportFormat = 'image/jpeg' | 'image/png';

export type ResolutionPreset = 'full' | 'high' | 'medium';

export interface ExportOptions {
  format: ExportFormat;
  quality: number; // 0.1 to 1.0 (for JPEG)
  targetWidth?: number;
  targetHeight?: number;
  scale?: number; // 1.0, 0.75, 0.5
}

export interface PreparedExport {
  blob: Blob;
  file: File;
  objectUrl: string;
  filename: string;
  format: ExportFormat;
  quality: number;
  width: number;
  height: number;
  fileSize: number;
  formattedSize: string;
  createdAt: number;
}

export interface ShareResult {
  success: boolean;
  cancelled?: boolean;
  error?: string;
}
