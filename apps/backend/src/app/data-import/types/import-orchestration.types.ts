import { DataCategory } from './data-import.types';

export type ImportIoLimiter = <T>(operation: () => Promise<T>) => Promise<T>;

export interface ImportUrlGroup {
  url: string;
  year: number;
  categories: DataCategory[];
}

export interface ImportTarget {
  category: DataCategory;
  year: number;
}

export interface ImportGroupResult {
  success: boolean;
  url: string;
  categories: number;
  error?: string;
}

export interface CategoryProcessResult {
  success: boolean;
  category: string;
  recordCount?: number;
  error?: string;
}
