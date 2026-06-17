export class StringUtils {
  static removeDiacritics(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  static normalizeColumnName(name: string): string {
    return this.removeDiacritics(name)
      .toUpperCase() // Use uppercase for consistency
      .trim()
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .replace(/[^A-Z0-9_]/g, '_') // Replace non-alphanumeric with underscore
      .replace(/_+/g, '_') // Replace multiple underscores with single
      .replace(/^_|_$/g, ''); // Remove leading/trailing underscores
  }

  /**
   * Clean column name while preserving original case and structure (legacy)
   * @deprecated Use normalizeColumnName for consistency
   */
  static cleanColumnName(name: string): string {
    return this.removeDiacritics(name)
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '');
  }
  static getDatabaseColumnName(originalName: string): string {
    return this.normalizeColumnName(originalName);
  }
  static getDataType(value: string): string {
    const cleanValue = value.replace(/['"]/g, '').trim();

    if (!cleanValue || cleanValue.toUpperCase() === 'NULL') {
      return 'TEXT'; // Default to TEXT for nullable/empty values
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(cleanValue)) {
      return 'DATE';
    }

    if (/^\d{2}:\d{2}:\d{2}$/.test(cleanValue)) {
      return 'TIME';
    }

    if (/^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}/.test(cleanValue)) {
      return 'TIMESTAMP';
    }

    if (/^-?\d+$/.test(cleanValue)) {
      const num = parseInt(cleanValue, 10);
      // For safety, only use SMALLINT for very small numbers or known small ranges
      if (num >= 0 && num <= 9999) {
        return 'SMALLINT'; // Only for clearly small positive numbers
      } else if (num >= -2147483648 && num <= 2147483647) {
        return 'INT'; // Default to INT for most integers
      } else {
        return 'BIGINT';
      }
    }

    if (/^-?\d*\.\d+$/.test(cleanValue)) {
      return 'FLOAT';
    }

    if (/^\d{4}$/.test(cleanValue) && parseInt(cleanValue) >= 1900) {
      return 'SMALLINT';
    }

    // Default to TEXT for string columns
    // PostgreSQL TEXT has identical performance to VARCHAR and is safer for external data
    return 'TEXT';
  }
}
