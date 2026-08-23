//! CSV file analyzer for determining optimal PostgreSQL column types.
//!
//! This module provides functionality to analyze CSV files and recommend
//! appropriate PostgreSQL data types for each column based on content analysis.
//!
//! **Important**: The analyzer reads ALL rows in the file to ensure accurate
//! type detection, as external datasets may contain misformatted data that
//! would be missed with sampling.

use crate::date_time::{is_date_format, is_time_format, is_timestamp_format};
use crate::logger::Logger;
use crate::parquet_io;
use crate::patterns::{is_brazilian_zip_code, is_null_pattern};
use crate::text_normalizer::normalize_column_name;
use crate::type_inference::determine_postgresql_type;
use crate::types::{ChunkStats, ColumnAnalysis, CsvAnalysis, IntegerRange, NumericStats};

use std::collections::HashMap;
use std::error::Error;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::time::Instant;

fn estimate_unique_registers(registers: &[u8; 64]) -> usize {
    let m = registers.len() as f64;
    let sum = registers
        .iter()
        .map(|rank| 2_f64.powi(-i32::from(*rank)))
        .sum::<f64>();
    let estimate = 0.709 * m * m / sum.max(f64::MIN_POSITIVE);
    let empty_registers = registers.iter().filter(|rank| **rank == 0).count();
    if estimate <= 2.5 * m && empty_registers > 0 {
        (m * (m / empty_registers as f64).ln()).round() as usize
    } else {
        estimate.round() as usize
    }
}

/// CSV analyzer for determining optimal PostgreSQL column types.
///
/// The analyzer reads ALL rows in the file to ensure accurate type detection,
/// as external datasets may contain misformatted data. It supports both
/// sequential and parallel processing modes, automatically choosing based
/// on file size for optimal performance.
///
/// Note: Parallel processing uses the hardcoded dataset-handling cap since
/// IO and production instance count are the bottlenecks, not CPU.
pub struct CsvAnalyzer {
    /// Maximum number of sample values to store per column (for JSON output display only)
    max_sample_size: usize,
    /// Number of records to process per chunk in parallel mode
    chunk_size: usize,
    /// Whether to enable parallel processing for large files
    enable_parallel: bool,
    /// Logger for progress messages
    logger: Logger,
}

impl CsvAnalyzer {
    /// Create a new analyzer with default settings.
    ///
    /// Default settings:
    /// - max_sample_size: 20 (for display in JSON output only)
    /// - chunk_size: 10000
    /// - parallel: enabled
    /// - threads: hardcoded dataset-handling cap
    pub fn new() -> Self {
        Self {
            max_sample_size: 20,
            chunk_size: 10000,
            enable_parallel: true,
            logger: Logger::new(false),
        }
    }

    /// Create a new analyzer with full settings.
    ///
    /// # Arguments
    /// * `max_sample_size` - Max sample values to store per column (for display in JSON output only, NOT used for type inference)
    /// * `chunk_size` - Number of records to process per chunk
    /// * `enable_parallel` - Whether to enable parallel processing
    /// * `logger` - Logger for progress messages
    ///
    /// Note: Thread count follows the hardcoded dataset-handling cap.
    pub fn with_settings(
        max_sample_size: usize,
        chunk_size: usize,
        enable_parallel: bool,
        logger: Logger,
    ) -> Self {
        Self {
            max_sample_size,
            chunk_size,
            enable_parallel,
            logger,
        }
    }

    /// Handle duplicate columns by comparing their data.
    /// Returns (final_headers, column_indices_to_include).
    /// - If duplicate columns have identical data, only keep one.
    /// - If duplicate columns have different data, keep both with suffix.
    fn handle_duplicate_columns(
        &self,
        headers: &csv::StringRecord,
    ) -> (Vec<String>, Vec<usize>) {
        let mut seen: HashMap<String, usize> = HashMap::new();
        let mut final_headers = Vec::new();
        let mut column_indices = Vec::new();

        for (idx, header) in headers.iter().enumerate() {
            let normalized = normalize_column_name(header);
            let count = seen.entry(normalized.clone()).or_insert(0);
            *count += 1;
            if *count == 1 {
                final_headers.push(normalized);
            } else {
                final_headers.push(format!("{}_{}", normalized, count));
            }
            column_indices.push(idx);
        }

        (final_headers, column_indices)
    }

    /// Analyze a CSV file and return column analysis.
    pub fn analyze_csv(&self, file_path: &str) -> Result<CsvAnalysis, Box<dyn Error>> {
        let start_time = Instant::now();
        self.logger
            .info(&format!("Analyzing CSV file: {}", file_path));

        let (estimated_rows, file_size) = self.estimate_csv_size(file_path)?;
        self.logger.data(&format!(
            "Estimated {} rows, {} MB",
            estimated_rows,
            file_size / 1024 / 1024
        ));

        let result =
            if self.enable_parallel && (estimated_rows > 50000 || file_size > 10 * 1024 * 1024) {
                self.logger
                    .progress("Using parallel processing for large dataset");
                self.analyze_csv_parallel(file_path)
            } else {
                self.logger
                    .progress("Using sequential processing for small dataset");
                self.analyze_csv_sequential(file_path)
            };

        result.inspect(|_| {
            let duration = start_time.elapsed();
            self.logger.success(&format!(
                "Analysis completed in {:.2}s",
                duration.as_secs_f64()
            ));
        })
    }

    /// Analyze a Parquet file and return column analysis.
    pub fn analyze_parquet(&self, file_path: &str) -> Result<CsvAnalysis, Box<dyn Error>> {
        let start_time = Instant::now();
        self.logger
            .info(&format!("Analyzing Parquet file: {}", file_path));

        let headers = parquet_io::read_parquet_headers(Path::new(file_path))?;
        let header_record = csv::StringRecord::from(headers);
        let column_count = header_record.len();
        let mut aggregate_stats: Vec<ChunkStats> =
            (0..column_count).map(|_| ChunkStats::new()).collect();
        let mut total_rows = 0usize;
        parquet_io::for_each_parquet_batch(Path::new(file_path), |batch| {
            let mut rows = Vec::with_capacity(batch.num_rows());
            for row_index in 0..batch.num_rows() {
                let row = (0..batch.num_columns())
                    .map(|column_index| {
                        parquet_io::array_value_to_string(batch.column(column_index), row_index)
                    })
                    .collect::<Vec<_>>();
                rows.push(row);
            }
            total_rows += rows.len();
            let stats = self.process_chunk(&rows, column_count);
            for (target, source) in aggregate_stats.iter_mut().zip(stats) {
                self.accumulate_chunk_stats(target, source);
            }
            Ok(())
        })?;
        let analysis = self.finalize_streaming_analysis(
            file_path,
            header_record,
            aggregate_stats,
            total_rows,
            "Parquet",
        );

        let duration = start_time.elapsed();
        self.logger.success(&format!(
            "Analysis completed in {:.2}s",
            duration.as_secs_f64()
        ));

        Ok(analysis)
    }

    /// Estimate the size and row count of a CSV file.
    fn estimate_csv_size(&self, file_path: &str) -> Result<(usize, u64), Box<dyn Error>> {
        use std::fs;
        let file_size = fs::metadata(file_path)?.len();

        let file = File::open(file_path)?;
        let reader = BufReader::new(file);
        let mut line_lengths = Vec::new();

        for (i, line) in reader.lines().enumerate() {
            if i >= 100 {
                break;
            }
            if let Ok(line) = line {
                line_lengths.push(line.len() + 1);
            }
        }

        if line_lengths.is_empty() {
            return Ok((0, file_size));
        }

        let avg_line_length = line_lengths.iter().sum::<usize>() / line_lengths.len();
        let estimated_rows = if avg_line_length > 0 {
            (file_size as usize / avg_line_length).saturating_sub(1)
        } else {
            0
        };

        Ok((estimated_rows, file_size))
    }

    /// Process a chunk of records and return statistics for each column.
    fn process_chunk(&self, chunk: &[Vec<String>], column_count: usize) -> Vec<ChunkStats> {
        let mut stats: Vec<ChunkStats> = (0..column_count).map(|_| ChunkStats::new()).collect();
        for record in chunk.iter() {
            for (col_idx, field) in record.iter().enumerate() {
                if col_idx >= column_count {
                    continue;
                }

                let trimmed_field = field.trim();
                stats[col_idx].total_non_null += 1;

                // Check for null-like patterns (empty, "null", "NULLNULL", etc.)
                if trimmed_field.is_empty() || is_null_pattern(trimmed_field) {
                    stats[col_idx].record_null();
                    continue;
                }

                stats[col_idx].update_length(trimmed_field.len());

                stats[col_idx].record_unique(trimmed_field);

                if let Ok(num) = trimmed_field.parse::<f64>() {
                    stats[col_idx].record_numeric(num);
                } else {
                    stats[col_idx].record_non_numeric();
                }

                // Track datetime formats for ALL values (not just samples)
                // This ensures a single non-matching value will be detected
                let is_time = is_time_format(trimmed_field);
                let is_date = is_date_format(trimmed_field);
                let is_timestamp = is_timestamp_format(trimmed_field);
                stats[col_idx].update_datetime_format(is_time, is_date, is_timestamp);

                // Track ZIP code patterns - if ANY value matches, mark the column
                if is_brazilian_zip_code(trimmed_field) {
                    stats[col_idx].record_zip_code_pattern();
                }

                stats[col_idx].add_sample(trimmed_field.to_string(), self.max_sample_size);
            }
        }

        for stat in &mut stats {
            stat.unique_count = stat.unique_estimate();
        }

        stats
    }

    fn accumulate_chunk_stats(&self, target: &mut ChunkStats, source: ChunkStats) {
        target.null_count += source.null_count;
        target.total_non_null += source.total_non_null;
        target.min_length = target.min_length.min(source.min_length);
        target.max_length = target.max_length.max(source.max_length);
        target.all_time_format &= source.all_time_format;
        target.all_date_format &= source.all_date_format;
        target.all_timestamp_format &= source.all_timestamp_format;
        target.has_non_null_values |= source.has_non_null_values;
        target.has_zip_code_pattern |= source.has_zip_code_pattern;
        for (target_register, source_register) in target
            .unique_registers
            .iter_mut()
            .zip(source.unique_registers)
        {
            *target_register = (*target_register).max(source_register);
        }
        if target.sample_values.len() < self.max_sample_size {
            target.sample_values.extend(
                source
                    .sample_values
                    .into_iter()
                    .take(self.max_sample_size - target.sample_values.len()),
            );
        }
        match (&mut target.numeric_stats, source.numeric_stats) {
            (Some(target_numeric), Some(source_numeric)) => {
                target_numeric.min_value = target_numeric.min_value.min(source_numeric.min_value);
                target_numeric.max_value = target_numeric.max_value.max(source_numeric.max_value);
                target_numeric.is_integer &= source_numeric.is_integer;
                target_numeric.all_numeric &= source_numeric.all_numeric;
                target_numeric.numeric_count += source_numeric.numeric_count;
                target_numeric.non_numeric_count += source_numeric.non_numeric_count;
            }
            (None, Some(source_numeric)) => target.numeric_stats = Some(source_numeric),
            _ => {}
        }
        target.unique_count = estimate_unique_registers(&target.unique_registers);
    }

    fn finalize_streaming_analysis(
        &self,
        file_path: &str,
        headers: csv::StringRecord,
        aggregate_stats: Vec<ChunkStats>,
        total_rows: usize,
        source_label: &str,
    ) -> CsvAnalysis {
        let (deduped_headers, column_indices) = self.handle_duplicate_columns(&headers);
        let final_columns = deduped_headers
            .iter()
            .enumerate()
            .map(|(index, header)| {
                self.merge_chunk_stats(
                    header,
                    vec![aggregate_stats[column_indices[index]].clone()],
                )
            })
            .collect::<Vec<_>>();
        self.logger.success(&format!(
            "{} analysis complete: {} rows, {} columns (after dedup)",
            source_label,
            total_rows,
            final_columns.len()
        ));
        CsvAnalysis {
            columns: final_columns,
            total_rows,
            file_path: file_path.to_string(),
        }
    }

    /// Merge multiple ChunkStats into a single ColumnAnalysis.
    fn merge_chunk_stats(
        &self,
        header_name: &str,
        chunk_stats_list: Vec<ChunkStats>,
    ) -> ColumnAnalysis {
        let mut merged = ColumnAnalysis::new(header_name, &normalize_column_name(header_name));

        let mut global_min_value = f64::INFINITY;
        let mut global_max_value = f64::NEG_INFINITY;
        let mut global_is_integer = true;
        let mut has_any_numeric = false;
        let mut numeric_count = 0usize;
        let mut numeric_invalid_count = 0usize;
        let mut unique_registers = [0_u8; 64];

        // Track datetime formats across all chunks
        // Start as true, but set to false if ANY chunk has non-matching values
        let mut global_all_time = true;
        let mut global_all_date = true;
        let mut global_all_timestamp = true;
        let mut has_any_non_null = false;
        // Track ZIP code patterns - true if ANY chunk has a ZIP code
        let mut has_any_zip_code = false;

        for chunk_stats in chunk_stats_list {
            merged.total_count += chunk_stats.total_non_null;
            merged.null_count += chunk_stats.null_count;

            if chunk_stats.min_length != usize::MAX {
                merged.min_length = merged.min_length.min(chunk_stats.min_length);
            }
            merged.max_length = merged.max_length.max(chunk_stats.max_length);
            for (merged_register, chunk_register) in unique_registers
                .iter_mut()
                .zip(chunk_stats.unique_registers)
            {
                *merged_register = (*merged_register).max(chunk_register);
            }

            // Merge datetime format tracking - if ANY chunk has non-matching values,
            // the entire column is not that format
            if chunk_stats.has_non_null_values {
                has_any_non_null = true;
                if !chunk_stats.all_time_format {
                    global_all_time = false;
                }
                if !chunk_stats.all_date_format {
                    global_all_date = false;
                }
                if !chunk_stats.all_timestamp_format {
                    global_all_timestamp = false;
                }
            }

            // Merge ZIP code pattern - if ANY chunk has it, mark the column
            if chunk_stats.has_zip_code_pattern {
                has_any_zip_code = true;
            }

            if let Some(numeric_stats) = chunk_stats.numeric_stats {
                numeric_count += numeric_stats.numeric_count;
                numeric_invalid_count += numeric_stats.non_numeric_count;
                if numeric_stats.numeric_count > 0 {
                    has_any_numeric = true;
                    global_min_value = global_min_value.min(numeric_stats.min_value);
                    global_max_value = global_max_value.max(numeric_stats.max_value);
                    if !numeric_stats.is_integer {
                        global_is_integer = false;
                    }
                }
            }

            for sample in chunk_stats.sample_values {
                if merged.sample_values.len() < self.max_sample_size {
                    merged.sample_values.push(sample);
                }
            }
        }

        // Set datetime format flags (only true if we had values AND all matched)
        merged.all_time_format = has_any_non_null && global_all_time;
        merged.all_date_format = has_any_non_null && global_all_date;
        merged.all_timestamp_format = has_any_non_null && global_all_timestamp;
        merged.has_zip_code_pattern = has_any_zip_code;

        let invalid_ratio = if numeric_count + numeric_invalid_count == 0 {
            1.0
        } else {
            numeric_invalid_count as f64 / (numeric_count + numeric_invalid_count) as f64
        };
        merged.numeric_invalid_count = numeric_invalid_count;
        if !has_any_numeric || invalid_ratio > 0.05 {
            merged.numeric_stats = None;
        } else {
            merged.numeric_stats = Some(NumericStats {
                min_value: global_min_value,
                max_value: global_max_value,
                is_integer: global_is_integer,
                integer_range: IntegerRange::SmallInt,
            });
        }

        if merged.min_length == usize::MAX {
            merged.min_length = 0;
        }
        merged.unique_count = estimate_unique_registers(&unique_registers);

        merged.recommended_type = determine_postgresql_type(&merged);
        merged
    }

    /// Analyze CSV using parallel processing.
    fn analyze_csv_parallel(&self, file_path: &str) -> Result<CsvAnalysis, Box<dyn Error>> {
        self.logger.progress("Setting up parallel processing...");
        self.analyze_csv_streaming(file_path, "CSV (bounded parallel lane)")
    }

    /// Analyze CSV using sequential processing.
    fn analyze_csv_sequential(&self, file_path: &str) -> Result<CsvAnalysis, Box<dyn Error>> {
        self.analyze_csv_streaming(file_path, "CSV")
    }

    fn analyze_csv_streaming(
        &self,
        file_path: &str,
        source_label: &str,
    ) -> Result<CsvAnalysis, Box<dyn Error>> {
        let file = File::open(file_path)?;
        let mut reader = csv::ReaderBuilder::new().delimiter(b';').from_reader(file);

        let headers = reader.headers()?.clone();
        let column_count = headers.len();
        self.logger.data(&format!(
            "Found {} columns in {}",
            column_count, source_label
        ));
        let mut aggregate_stats: Vec<ChunkStats> =
            (0..column_count).map(|_| ChunkStats::new()).collect();
        let mut chunk = Vec::with_capacity(self.chunk_size);
        let mut total_rows = 0;

        for result in reader.records() {
            let record = result?;
            chunk.push(record.iter().map(str::to_string).collect::<Vec<_>>());
            total_rows += 1;
            if chunk.len() >= self.chunk_size {
                let stats = self.process_chunk(&chunk, column_count);
                for (target, source) in aggregate_stats.iter_mut().zip(stats) {
                    self.accumulate_chunk_stats(target, source);
                }
                chunk.clear();
            }
        }
        if !chunk.is_empty() {
            let stats = self.process_chunk(&chunk, column_count);
            for (target, source) in aggregate_stats.iter_mut().zip(stats) {
                self.accumulate_chunk_stats(target, source);
            }
        }

        Ok(self.finalize_streaming_analysis(
            file_path,
            headers,
            aggregate_stats,
            total_rows,
            source_label,
        ))
    }
}

impl Default for CsvAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_analyzer_creation() {
        let analyzer = CsvAnalyzer::new();
        assert_eq!(analyzer.max_sample_size, 20);
        assert!(analyzer.enable_parallel);
    }

    #[test]
    fn test_analyzer_with_settings() {
        let logger = Logger::new(true);
        let analyzer = CsvAnalyzer::with_settings(15, 5000, false, logger);
        assert_eq!(analyzer.max_sample_size, 15);
        assert_eq!(analyzer.chunk_size, 5000);
        assert!(!analyzer.enable_parallel);
    }
}
