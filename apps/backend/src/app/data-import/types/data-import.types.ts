export interface DataCategory {
  name: string;
  baseUrl: string;
  years: number[];
  tablePrefix: string;
  hasSchema: boolean;
  importStrategy?: 'direct-xlsx' | 'ssp-iml';
  useYearSuffix?: boolean;
  sheetNamePatterns?: string[];
  columnTypeOverrides?: Record<string, string>;
}

export interface FileMetadata {
  id?: string;
  category: string;
  year: number;
  fileUrl: string;
  fileHash: string;
  fileSize: number;
  lastDownloaded: Date;
  lastImported?: Date;
  recordCount: number;
}

export interface ImlFileMetadata extends FileMetadata {
  month: number;
}

export interface RustColumnAnalysis {
  name: string;
  normalized_name: string;
  recommended_type: string;
  sample_values: string[];
  null_count: number;
  total_count: number;
  min_length: number;
  max_length: number;
  unique_count: number;
}

export interface RustCsvAnalysis {
  columns: RustColumnAnalysis[];
  total_rows: number;
  file_path: string;
}

export interface ImportDecision {
  shouldImport: boolean;
  reason: string;
}

export interface FileChangeCheck {
  category: string;
  year: number;
  url: string;
  existingHash?: string;
}

export interface FileChangeResult {
  category: string;
  year: number;
  hasChanged: boolean;
  newHash?: string;
  size?: number;
  error?: string;
}

export interface TableColumnInfo {
  column_name: string;
  data_type: string;
}

export interface ImportStatus {
  tableExists: boolean;
  recordCount: number;
}
