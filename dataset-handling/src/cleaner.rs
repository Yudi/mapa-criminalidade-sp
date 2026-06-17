//! CSV data cleaner for handling malformed values.
//!
//! This module provides functionality to clean CSV data based on column types,
//! handling malformed values, Excel errors, and format inconsistencies.

use crate::logger::Logger;
use crate::text_normalizer::normalize_column_name;
use crate::type_inference::correct_column_type;
use crate::value_cleaners::{
    clean_date_value, clean_general_value, clean_integer_value, clean_numeric_value,
    clean_time_value,
};

use rayon::prelude::*;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

/// CSV data cleaner for handling malformed values in different column types.
pub struct CsvCleaner {
    logger: Logger,
}

impl CsvCleaner {
    /// Create a new CSV cleaner instance.
    pub fn new(silent: bool) -> Self {
        Self {
            logger: Logger::new(silent),
        }
    }

    /// Process and clean CSV file based on column types.
    pub fn clean_csv(
        &self,
        input_path: &str,
        output_path: &str,
        column_types: &HashMap<String, String>,
    ) -> Result<usize, Box<dyn std::error::Error>> {
        self.clean_csv_with_columns(input_path, output_path, column_types, None)
    }

    /// Process and clean CSV file with column filtering and reordering.
    pub fn clean_csv_with_columns(
        &self,
        input_path: &str,
        output_path: &str,
        column_types: &HashMap<String, String>,
        _target_columns: Option<&[String]>,
    ) -> Result<usize, Box<dyn std::error::Error>> {
        self.logger.processing(&format!(
            "Cleaning CSV data: {} -> {}",
            input_path, output_path
        ));

        // First pass: read all data to detect and handle duplicate columns
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .quote(b'"')
            .escape(Some(b'"'))
            .double_quote(true)
            .flexible(false)
            .from_path(input_path)?;

        let original_headers = reader.headers()?.clone();

        // Read all records into memory for duplicate column comparison
        let all_records: Vec<csv::StringRecord> = reader.records().filter_map(|r| r.ok()).collect();

        // Detect duplicate columns and determine which to keep
        let (final_headers, column_indices) =
            self.handle_duplicate_columns(&original_headers, &all_records);

        // Now write the cleaned output
        let mut writer = csv::WriterBuilder::new()
            .delimiter(b';')
            .quote_style(csv::QuoteStyle::Necessary)
            .quote(b'"')
            .escape(b'"')
            .double_quote(true)
            .from_path(output_path)?;

        writer.write_record(&final_headers)?;

        let mut processed_rows = 0;
        let mut cleaned_values = 0;

        for record in &all_records {
            let mut cleaned_record = Vec::new();

            for &col_idx in &column_indices {
                let value = record.get(col_idx).unwrap_or("");
                let cleaned_value = if let Some(original_header) =
                    original_headers.get(col_idx)
                {
                    let normalized_header = normalize_column_name(original_header);
                    let default_type = "text".to_string();
                    let db_type = column_types
                        .get(original_header)
                        .or_else(|| column_types.get(&normalized_header))
                        .unwrap_or(&default_type);
                    let corrected_type =
                        correct_column_type(original_header, db_type, Some(value));

                    let cleaned =
                        self.clean_value_by_type(value, &corrected_type, original_header);
                    if cleaned != value {
                        cleaned_values += 1;
                    }
                    cleaned
                } else {
                    value.to_string()
                };

                cleaned_record.push(cleaned_value);
            }

            writer.write_record(&cleaned_record)?;
            processed_rows += 1;

            if processed_rows % 10000 == 0 {
                self.logger.progress(&format!(
                    "Processed {} rows, cleaned {} values",
                    processed_rows, cleaned_values
                ));
            }
        }

        writer.flush()?;

        self.logger.success(&format!(
            "CSV cleaning complete: {} rows processed, {} values cleaned",
            processed_rows, cleaned_values
        ));

        Ok(processed_rows)
    }

    /// Handle duplicate columns by comparing their data.
    /// Returns the final headers and the column indices to include.
    /// - If duplicate columns have identical data, only keep one.
    /// - If duplicate columns have different data, keep both with suffix.
    fn handle_duplicate_columns(
        &self,
        original_headers: &csv::StringRecord,
        all_records: &[csv::StringRecord],
    ) -> (Vec<String>, Vec<usize>) {
        let mut normalized_to_indices: HashMap<String, Vec<usize>> = HashMap::new();

        // Group columns by normalized name
        for (idx, header) in original_headers.iter().enumerate() {
            let normalized = normalize_column_name(header).to_uppercase();
            normalized_to_indices
                .entry(normalized)
                .or_default()
                .push(idx);
        }

        let mut final_headers = Vec::new();
        let mut column_indices = Vec::new();
        let mut processed_indices = std::collections::HashSet::new();

        for (idx, header) in original_headers.iter().enumerate() {
            if processed_indices.contains(&idx) {
                continue;
            }

            let normalized = normalize_column_name(header);
            let upper = normalized.to_uppercase();
            let indices = normalized_to_indices.get(&upper).unwrap();

            if indices.len() == 1 {
                final_headers.push(normalized);
                column_indices.push(idx);
                processed_indices.insert(idx);
            } else {
                let first_idx = indices[0];
                let mut all_identical = true;
                let mut diff_indices = Vec::new();

                for &other_idx in &indices[1..] {
                    let data_matches =
                        self.columns_have_identical_data(all_records, first_idx, other_idx);
                    if !data_matches {
                        all_identical = false;
                        diff_indices.push(other_idx);
                    }
                }

                if all_identical {
                    self.logger.info(&format!(
                        "Duplicate column \"{}\" found {} times with identical data - keeping only one",
                        normalized, indices.len()
                    ));
                    final_headers.push(normalized);
                    column_indices.push(first_idx);
                    for &i in indices {
                        processed_indices.insert(i);
                    }
                } else {
                    self.logger.warn(&format!(
                        "Duplicate column \"{}\" found with DIFFERENT data - keeping all with suffixes",
                        normalized
                    ));
                    final_headers.push(normalized.clone());
                    column_indices.push(first_idx);
                    processed_indices.insert(first_idx);
                    let mut suffix = 2;
                    for &other_idx in &indices[1..] {
                        let suffixed_name = format!("{}_{}", normalized, suffix);
                        final_headers.push(suffixed_name);
                        column_indices.push(other_idx);
                        processed_indices.insert(other_idx);
                        suffix += 1;
                    }
                }
            }
        }

        (final_headers, column_indices)
    }

    /// Check if two columns have identical data across all records.
    /// Uses parallel processing with early exit for large datasets.
    ///
    /// # Implementation Details:
    /// - Uses an AtomicBool as a "found difference" flag shared across threads
    /// - Each thread checks the flag before processing each chunk
    /// - When any thread finds a difference, it sets the flag and other threads exit early
    /// - Memory efficient: processes data in place without copying
    fn columns_have_identical_data(
        &self,
        records: &[csv::StringRecord],
        col1_idx: usize,
        col2_idx: usize,
    ) -> bool {
        // For small datasets, use sequential comparison (thread overhead not worth it)
        if records.len() < 10_000 {
            return self.columns_have_identical_data_sequential(records, col1_idx, col2_idx);
        }

        // Shared atomic flag for early exit across all threads
        // When any thread finds a difference, it sets this to true
        let found_difference = AtomicBool::new(false);

        // Process in parallel chunks with early exit
        // par_chunks divides the data without copying
        records
            .par_chunks(5_000) // Process 5000 rows per chunk
            .try_for_each(|chunk| {
                if found_difference.load(Ordering::Relaxed) {
                    return Err(()); // Stop this thread
                }

                for record in chunk {
                    if found_difference.load(Ordering::Relaxed) {
                        return Err(());
                    }

                    let val1 = record.get(col1_idx).unwrap_or("").trim();
                    let val2 = record.get(col2_idx).unwrap_or("").trim();

                    if val1 != val2 {
                        found_difference.store(true, Ordering::Relaxed);
                        return Err(());
                    }
                }
                Ok(())
            })
            .is_ok() // Ok = no differences found, Err = difference found
    }

    /// Sequential comparison for small datasets (avoids thread overhead).
    #[inline]
    fn columns_have_identical_data_sequential(
        &self,
        records: &[csv::StringRecord],
        col1_idx: usize,
        col2_idx: usize,
    ) -> bool {
        for record in records {
            let val1 = record.get(col1_idx).unwrap_or("").trim();
            let val2 = record.get(col2_idx).unwrap_or("").trim();
            if val1 != val2 {
                return false;
            }
        }
        true
    }

    /// Clean a value based on its column type.
    fn clean_value_by_type(&self, value: &str, col_type: &str, header: &str) -> String {
        let normalized_type = col_type.to_lowercase();

        match normalized_type.as_str() {
            t if t.contains("double precision")
                || t.contains("real")
                || t.contains("float")
                || t.contains("numeric") =>
            {
                clean_numeric_value(value, &self.logger)
            }
            t if t.contains("bigint")
                || t.contains("integer")
                || t.contains("smallint")
                || t.contains("int") =>
            {
                // Check if it's a ZIP code column that should remain as string
                let header_lower = header.to_lowercase();
                if header_lower.contains("cep")
                    || header_lower.contains("postal")
                    || header_lower.contains("zip")
                {
                    clean_general_value(value, &self.logger)
                } else {
                    clean_integer_value(value, &self.logger)
                }
            }
            t if t.contains("date") => clean_date_value(value, &self.logger),
            t if t.contains("time") => clean_time_value(value, &self.logger),
            _ => clean_general_value(value, &self.logger),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn test_cleaner_creation() {
        let _cleaner = CsvCleaner::new(true);
        // Just verify it doesn't panic
    }

    #[test]
    fn test_clean_csv_uses_normalized_header_for_type_lookup() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let input_path = std::env::temp_dir().join(format!(
            "cleaner_input_{}.csv",
            suffix
        ));
        let output_path = std::env::temp_dir().join(format!(
            "cleaner_output_{}.csv",
            suffix
        ));

        fs::write(&input_path, "\"QTDE (GRAMAS)\"\n\"12,5\"\n").unwrap();

        let mut column_types = HashMap::new();
        column_types.insert("QTDE_GRAMAS".to_string(), "numeric".to_string());

        let cleaner = CsvCleaner::new(true);
        cleaner
            .clean_csv(
                input_path.to_str().unwrap(),
                output_path.to_str().unwrap(),
                &column_types,
            )
            .unwrap();

        let output = fs::read_to_string(&output_path).unwrap();
        assert!(output.contains("QTDE_GRAMAS"));
        assert!(output.contains("12.5"));

        let _ = fs::remove_file(input_path);
        let _ = fs::remove_file(output_path);
    }
}
