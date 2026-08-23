//! CSV data cleaner for handling malformed values.
//!
//! The cleaner keeps the permissive source-data conversions used by the
//! project, but makes every parser failure and quality conversion observable
//! through a bounded rejection file and a manifest written atomically with the
//! cleaned CSV.

use crate::logger::Logger;
use crate::text_normalizer::normalize_column_name;
use crate::type_inference::correct_column_type;
use crate::value_cleaners::{
    clean_date_value, clean_general_value, clean_integer_value, clean_numeric_value,
    clean_time_value,
};
use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const MAX_REJECTION_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct CleanReport {
    pub source_rows: usize,
    pub accepted_rows: usize,
    pub rejected_rows: usize,
    pub invalid_values: usize,
    pub coerced_values: usize,
    pub columns: Vec<String>,
    pub rejection_path: Option<String>,
}

/// CSV data cleaner for handling malformed values in different column types.
pub struct CsvCleaner {
    logger: Logger,
}

impl CsvCleaner {
    pub fn new(silent: bool) -> Self {
        Self {
            logger: Logger::new(silent),
        }
    }

    #[allow(dead_code)]
    pub fn clean_csv(
        &self,
        input_path: &str,
        output_path: &str,
        column_types: &HashMap<String, String>,
    ) -> Result<usize, Box<dyn std::error::Error>> {
        self.clean_csv_with_columns(input_path, output_path, column_types, None)
    }

    pub fn clean_csv_with_report(
        &self,
        input_path: &str,
        output_path: &str,
        column_types: &HashMap<String, String>,
        target_columns: Option<&[String]>,
    ) -> Result<CleanReport, Box<dyn std::error::Error>> {
        self.clean_csv_report(input_path, output_path, column_types, target_columns)
    }

    #[allow(dead_code)]
    pub fn clean_csv_with_columns(
        &self,
        input_path: &str,
        output_path: &str,
        column_types: &HashMap<String, String>,
        target_columns: Option<&[String]>,
    ) -> Result<usize, Box<dyn std::error::Error>> {
        Ok(self
            .clean_csv_report(input_path, output_path, column_types, target_columns)?
            .accepted_rows)
    }

    fn clean_csv_report(
        &self,
        input_path: &str,
        output_path: &str,
        column_types: &HashMap<String, String>,
        target_columns: Option<&[String]>,
    ) -> Result<CleanReport, Box<dyn std::error::Error>> {
        self.logger.processing(&format!(
            "Cleaning CSV data: {} -> {}",
            input_path, output_path
        ));

        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .quote(b'"')
            .escape(Some(b'"'))
            .double_quote(true)
            .flexible(false)
            .from_path(input_path)?;
        let original_headers = reader.headers()?.clone();
        if original_headers.is_empty() {
            return Err("CSV has no header row".into());
        }

        let (deduped_headers, deduped_indices) =
            self.handle_duplicate_columns(&original_headers);
        let (final_headers, column_indices) =
            self.select_target_columns(&deduped_headers, &deduped_indices, target_columns)?;

        let output_path = Path::new(output_path);
        let output_temporary_path = temporary_path(output_path, "cleaned");
        let rejection_path = appended_path(output_path, ".rejected.csv");
        let temporary_rejection_path = temporary_path(&rejection_path, "rejected");
        let manifest_path = appended_path(output_path, ".manifest.json");
        let temporary_manifest_path = temporary_path(&manifest_path, "manifest");

        let result = (|| -> Result<CleanReport, Box<dyn std::error::Error>> {
            let output_file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&output_temporary_path)?;
            let mut writer = csv::WriterBuilder::new()
                .delimiter(b';')
                .quote_style(csv::QuoteStyle::Necessary)
                .quote(b'"')
                .escape(b'"')
                .double_quote(true)
                .from_writer(output_file);
            writer.write_record(&final_headers)?;

            let rejection_file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary_rejection_path)?;
            let mut rejection_writer = csv::WriterBuilder::new()
                .delimiter(b';')
                .quote_style(csv::QuoteStyle::Necessary)
                .from_writer(rejection_file);
            rejection_writer.write_record(["row", "reason"])?;

            let mut source_rows = 0;
            let mut accepted_rows = 0;
            let mut rejected_rows = 0;
            let mut invalid_values = 0;
            let mut coerced_values = 0;
            let mut rejection_bytes = 0_u64;

            for (record_index, result) in reader.records().enumerate() {
                source_rows += 1;
                let record = match result {
                    Ok(record) => record,
                    Err(error) => {
                        rejected_rows += 1;
                        if rejection_bytes < MAX_REJECTION_BYTES {
                            let reason = format!("{}", error);
                            rejection_bytes += reason.len() as u64;
                            rejection_writer.write_record([
                                (record_index + 2).to_string(),
                                reason,
                            ])?;
                        }
                        continue;
                    }
                };

                let mut cleaned_record = Vec::with_capacity(column_indices.len());
                for &col_idx in &column_indices {
                    let value = record.get(col_idx).unwrap_or("");
                    let original_header = original_headers
                        .get(deduped_indices[col_idx])
                        .ok_or("CSV column index is out of bounds")?;
                    let normalized_header = normalize_column_name(original_header);
                    let default_type = "text".to_string();
                    let db_type = column_types
                        .get(original_header)
                        .or_else(|| column_types.get(&normalized_header))
                        .unwrap_or(&default_type);
                    let corrected_type =
                        correct_column_type(original_header, db_type, Some(value));
                    let cleaned = self.clean_value_by_type(value, &corrected_type, original_header);
                    if !value.trim().is_empty() && cleaned.trim().is_empty() {
                        invalid_values += 1;
                    } else if cleaned != value {
                        coerced_values += 1;
                    }
                    cleaned_record.push(cleaned);
                }

                writer.write_record(&cleaned_record)?;
                accepted_rows += 1;
            }

            writer.flush()?;
            let output_file = writer.into_inner()?;
            output_file.sync_all()?;
            drop(output_file);
            rejection_writer.flush()?;
            let rejection_file = rejection_writer.into_inner()?;
            rejection_file.sync_all()?;
            drop(rejection_file);
            fs::rename(&output_temporary_path, output_path)?;

            let rejection_path_value = if rejected_rows > 0 {
                fs::rename(&temporary_rejection_path, &rejection_path)?;
                Some(rejection_path.display().to_string())
            } else {
                let _ = fs::remove_file(&temporary_rejection_path);
                let _ = fs::remove_file(&rejection_path);
                None
            };

            let report = CleanReport {
                source_rows,
                accepted_rows,
                rejected_rows,
                invalid_values,
                coerced_values,
                columns: final_headers.clone(),
                rejection_path: rejection_path_value,
            };
            let manifest = serde_json::to_vec_pretty(&report)?;
            let mut manifest_file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary_manifest_path)?;
            manifest_file.write_all(&manifest)?;
            manifest_file.sync_all()?;
            drop(manifest_file);
            fs::rename(&temporary_manifest_path, &manifest_path)?;

            self.logger.success(&format!(
                "CSV cleaning complete: {} accepted, {} rejected rows, {} invalid values",
                accepted_rows, rejected_rows, invalid_values
            ));
            Ok(report)
        })();

        if result.is_err() {
            let _ = fs::remove_file(&output_temporary_path);
            let _ = fs::remove_file(&temporary_rejection_path);
            let _ = fs::remove_file(&temporary_manifest_path);
        }
        result
    }

    fn select_target_columns(
        &self,
        headers: &[String],
        indices: &[usize],
        target_columns: Option<&[String]>,
    ) -> Result<(Vec<String>, Vec<usize>), Box<dyn std::error::Error>> {
        let Some(target_columns) = target_columns else {
            return Ok((headers.to_vec(), indices.to_vec()));
        };

        let normalized_targets: Vec<String> = target_columns
            .iter()
            .map(|column| normalize_column_name(column))
            .collect();
        let mut selected_headers = Vec::with_capacity(target_columns.len());
        let mut selected_indices = Vec::with_capacity(target_columns.len());
        for target in normalized_targets {
            let position = headers
                .iter()
                .position(|header| normalize_column_name(header) == target)
                .ok_or_else(|| format!("Required target column '{}' is missing", target))?;
            selected_headers.push(headers[position].clone());
            selected_indices.push(indices[position]);
        }
        if selected_indices.len() != headers.len() {
            return Err("CSV source columns do not exactly match target columns".into());
        }
        Ok((selected_headers, selected_indices))
    }

    fn handle_duplicate_columns(
        &self,
        original_headers: &csv::StringRecord,
    ) -> (Vec<String>, Vec<usize>) {
        let mut seen = HashMap::<String, usize>::new();
        let mut final_headers = Vec::with_capacity(original_headers.len());
        let mut column_indices = Vec::with_capacity(original_headers.len());
        for (index, header) in original_headers.iter().enumerate() {
            let normalized = normalize_column_name(header);
            let base = if normalized.is_empty() {
                format!("COLUMN_{}", index + 1)
            } else {
                normalized
            };
            let count = seen.entry(base.clone()).or_insert(0);
            *count += 1;
            final_headers.push(if *count == 1 {
                base
            } else {
                format!("{}_{}", base, count)
            });
            column_indices.push(index);
        }
        (final_headers, column_indices)
    }

    fn clean_value_by_type(&self, value: &str, col_type: &str, header: &str) -> String {
        let normalized_type = col_type.to_lowercase();
        match normalized_type.as_str() {
            t if t.contains("double precision")
                || t.contains("real")
                || t.contains("float")
                || t.contains("numeric") => clean_numeric_value(value, &self.logger),
            t if t.contains("bigint")
                || t.contains("integer")
                || t.contains("smallint")
                || t.contains("int") => {
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

fn temporary_path(path: &Path, stage: &str) -> PathBuf {
    path.with_extension(format!(
        "{}.{}.{}.part",
        path.extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("tmp"),
        stage,
        std::process::id()
    ))
}

fn appended_path(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn test_cleaner_creation() {
        let _cleaner = CsvCleaner::new(true);
    }

    #[test]
    fn test_clean_csv_uses_normalized_header_for_type_lookup() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let input_path = std::env::temp_dir().join(format!("cleaner_input_{}.csv", suffix));
        let output_path = std::env::temp_dir().join(format!("cleaner_output_{}.csv", suffix));

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
        let _ = fs::remove_file(&output_path);
        let _ = fs::remove_file(appended_path(&output_path, ".manifest.json"));
    }

    #[test]
    fn rejects_a_malformed_row_and_keeps_valid_rows() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let input_path = std::env::temp_dir().join(format!("cleaner_dirty_input_{}.csv", suffix));
        let output_path =
            std::env::temp_dir().join(format!("cleaner_dirty_output_{}.csv", suffix));

        fs::write(&input_path, "A;B\n1;2\nbad;row;extra\n3;4\n").unwrap();
        let report = CsvCleaner::new(true)
            .clean_csv_with_report(
                input_path.to_str().unwrap(),
                output_path.to_str().unwrap(),
                &HashMap::new(),
                None,
            )
            .unwrap();

        assert_eq!(report.source_rows, 3);
        assert_eq!(report.accepted_rows, 2);
        assert_eq!(report.rejected_rows, 1);
        assert_eq!(fs::read_to_string(&output_path).unwrap(), "A;B\n1;2\n3;4\n");
        assert!(appended_path(&output_path, ".manifest.json").exists());
        assert!(appended_path(&output_path, ".rejected.csv").exists());

        let _ = fs::remove_file(input_path);
        let _ = fs::remove_file(&output_path);
        let _ = fs::remove_file(appended_path(&output_path, ".manifest.json"));
        let _ = fs::remove_file(appended_path(&output_path, ".rejected.csv"));
    }
}
