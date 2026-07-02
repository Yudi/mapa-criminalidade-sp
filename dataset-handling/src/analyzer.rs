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
use crate::parallelism::DATASET_HANDLING_PARALLELISM;
use crate::parquet_io;
use crate::patterns::{is_brazilian_zip_code, is_null_pattern};
use crate::text_normalizer::normalize_column_name;
use crate::type_inference::determine_postgresql_type;
use crate::types::{ChunkStats, ColumnAnalysis, CsvAnalysis, IntegerRange, NumericStats};

use rayon::prelude::*;
use std::collections::HashMap;
use std::error::Error;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

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
    /// Number of threads to use for parallel processing
    num_threads: usize,
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
            num_threads: DATASET_HANDLING_PARALLELISM,
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
            num_threads: DATASET_HANDLING_PARALLELISM,
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
        all_records: &[Vec<String>],
    ) -> (Vec<String>, Vec<usize>) {
        let mut normalized_to_indices: HashMap<String, Vec<usize>> = HashMap::new();

        // Group columns by normalized name
        for (idx, header) in headers.iter().enumerate() {
            let normalized = normalize_column_name(header).to_uppercase();
            normalized_to_indices
                .entry(normalized)
                .or_default()
                .push(idx);
        }

        let mut final_headers = Vec::new();
        let mut column_indices = Vec::new();
        let mut processed_indices = std::collections::HashSet::new();

        for (idx, header) in headers.iter().enumerate() {
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

                for &other_idx in &indices[1..] {
                    if !self.columns_have_identical_data(all_records, first_idx, other_idx) {
                        all_identical = false;
                        break;
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
    fn columns_have_identical_data(
        &self,
        records: &[Vec<String>],
        col1_idx: usize,
        col2_idx: usize,
    ) -> bool {
        // For small datasets, use sequential comparison
        if records.len() < 10_000 {
            return self.columns_have_identical_data_sequential(records, col1_idx, col2_idx);
        }

        // Shared atomic flag for early exit across all threads
        let found_difference = AtomicBool::new(false);

        // Process in parallel chunks with early exit
        records
            .par_chunks(5_000)
            .try_for_each(|chunk| {
                if found_difference.load(Ordering::Relaxed) {
                    return Err(());
                }

                for record in chunk {
                    if found_difference.load(Ordering::Relaxed) {
                        return Err(());
                    }

                    let val1 = record.get(col1_idx).map(|s| s.trim()).unwrap_or("");
                    let val2 = record.get(col2_idx).map(|s| s.trim()).unwrap_or("");

                    if val1 != val2 {
                        found_difference.store(true, Ordering::Relaxed);
                        return Err(());
                    }
                }
                Ok(())
            })
            .is_ok()
    }

    /// Sequential comparison for small datasets.
    #[inline]
    fn columns_have_identical_data_sequential(
        &self,
        records: &[Vec<String>],
        col1_idx: usize,
        col2_idx: usize,
    ) -> bool {
        for record in records {
            let val1 = record.get(col1_idx).map(|s| s.trim()).unwrap_or("");
            let val2 = record.get(col2_idx).map(|s| s.trim()).unwrap_or("");
            if val1 != val2 {
                return false;
            }
        }
        true
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

        let (headers, all_records) = parquet_io::read_parquet_string_rows(Path::new(file_path))?;
        let analysis = self.analyze_loaded_records(file_path, headers, all_records, "Parquet")?;

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
        let mut unique_values: Vec<HashMap<String, bool>> = vec![HashMap::new(); column_count];
        let max_unique_tracking = 1000;

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

                if unique_values[col_idx].len() < max_unique_tracking {
                    unique_values[col_idx].insert(trimmed_field.to_string(), true);
                }

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

        for (col_idx, unique_map) in unique_values.iter().enumerate() {
            stats[col_idx].unique_count = unique_map.len();
        }

        stats
    }

    fn analyze_loaded_records(
        &self,
        file_path: &str,
        headers: Vec<String>,
        all_records: Vec<Vec<String>>,
        source_label: &str,
    ) -> Result<CsvAnalysis, Box<dyn Error>> {
        let headers = csv::StringRecord::from(headers);
        let column_count = headers.len();
        let total_rows = all_records.len();

        self.logger.data(&format!(
            "Found {} columns and {} rows in {} file",
            column_count, total_rows, source_label
        ));

        let chunk_results = if self.enable_parallel && total_rows > 100_000 {
            self.logger
                .progress("Using parallel processing for large dataset");
            let effective_threads = self.num_threads.min(total_rows / self.chunk_size).max(1);
            let chunk_size = (total_rows / effective_threads).max(self.chunk_size);
            let chunks: Vec<_> = all_records.chunks(chunk_size).collect();

            chunks
                .par_iter()
                .map(|chunk| self.process_chunk(chunk, column_count))
                .collect::<Vec<_>>()
        } else {
            self.logger
                .progress("Using sequential processing for loaded dataset");
            vec![self.process_chunk(&all_records, column_count)]
        };

        let (deduped_headers, column_indices) =
            self.handle_duplicate_columns(&headers, &all_records);

        let mut final_columns = Vec::new();
        for (i, header) in deduped_headers.iter().enumerate() {
            let original_col_idx = column_indices[i];
            let column_chunk_stats: Vec<ChunkStats> = chunk_results
                .iter()
                .map(|chunk_result| chunk_result[original_col_idx].clone())
                .collect();
            let merged_column = self.merge_chunk_stats(header, column_chunk_stats);
            final_columns.push(merged_column);
        }

        self.logger.success(&format!(
            "{} analysis complete: {} rows, {} columns (after dedup)",
            source_label,
            total_rows,
            final_columns.len()
        ));

        Ok(CsvAnalysis {
            columns: final_columns,
            total_rows,
            file_path: file_path.to_string(),
        })
    }

    /// Merge multiple ChunkStats into a single ColumnAnalysis.
    fn merge_chunk_stats(
        &self,
        header_name: &str,
        chunk_stats_list: Vec<ChunkStats>,
    ) -> ColumnAnalysis {
        let mut merged = ColumnAnalysis::new(header_name, &normalize_column_name(header_name));

        let mut has_any_non_numeric = false;
        let mut global_min_value = f64::INFINITY;
        let mut global_max_value = f64::NEG_INFINITY;
        let mut global_is_integer = true;
        let mut has_any_numeric = false;

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
            merged.unique_count = merged.unique_count.max(chunk_stats.unique_count);

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
                if !numeric_stats.all_numeric {
                    has_any_non_numeric = true;
                } else {
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

        if has_any_non_numeric || !has_any_numeric {
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

        merged.recommended_type = determine_postgresql_type(&merged);
        merged
    }

    /// Analyze CSV using parallel processing.
    fn analyze_csv_parallel(&self, file_path: &str) -> Result<CsvAnalysis, Box<dyn Error>> {
        self.logger.progress("Setting up parallel processing...");

        let file = File::open(file_path)?;
        let mut reader = csv::ReaderBuilder::new().delimiter(b';').from_reader(file);

        let headers = reader.headers()?.clone();
        let column_count = headers.len();

        self.logger.data(&format!(
            "Found {} columns, processing in parallel chunks",
            column_count
        ));

        let mut all_records = Vec::new();

        self.logger.progress("Reading all records...");
        for (row_idx, result) in reader.records().enumerate() {
            let record = result?;
            all_records.push(record.iter().map(|s| s.to_string()).collect::<Vec<_>>());

            if row_idx > 0 && row_idx % 100000 == 0 {
                self.logger
                    .progress(&format!("Read {} records...", row_idx));
            }
        }

        let total_rows = all_records.len();
        self.logger
            .data(&format!("Processing {} records in parallel...", total_rows));

        // Use fixed thread count since IO is the bottleneck, not CPU
        let effective_threads = self.num_threads.min(total_rows / self.chunk_size).max(1);
        let chunk_size = (total_rows / effective_threads).max(self.chunk_size);
        let chunks: Vec<_> = all_records.chunks(chunk_size).collect();

        self.logger.data(&format!(
            "Processing {} chunks of ~{} records each (IO-optimized: {} threads)",
            chunks.len(),
            chunk_size,
            effective_threads
        ));

        let chunk_results: Vec<Vec<ChunkStats>> = chunks
            .par_iter()
            .map(|chunk| self.process_chunk(chunk, column_count))
            .collect();

        self.logger.progress("Merging parallel results...");

        // Handle duplicate columns - remove identical duplicates, keep different ones with suffix
        let (deduped_headers, column_indices) =
            self.handle_duplicate_columns(&headers, &all_records);

        let mut final_columns = Vec::new();
        for (i, header) in deduped_headers.iter().enumerate() {
            let original_col_idx = column_indices[i];
            let column_chunk_stats: Vec<ChunkStats> = chunk_results
                .iter()
                .map(|chunk_result| chunk_result[original_col_idx].clone())
                .collect();

            let merged_column = self.merge_chunk_stats(header, column_chunk_stats);
            final_columns.push(merged_column);
        }

        self.logger.success(&format!(
            "Parallel analysis complete: {} rows, {} columns (after dedup)",
            total_rows,
            final_columns.len()
        ));

        Ok(CsvAnalysis {
            columns: final_columns,
            total_rows,
            file_path: file_path.to_string(),
        })
    }

    /// Analyze CSV using sequential processing.
    fn analyze_csv_sequential(&self, file_path: &str) -> Result<CsvAnalysis, Box<dyn Error>> {
        let file = File::open(file_path)?;
        let mut reader = csv::ReaderBuilder::new().delimiter(b';').from_reader(file);

        let headers = reader.headers()?.clone();
        let column_count = headers.len();

        self.logger.data(&format!(
            "Found {} columns: {}",
            column_count,
            headers.iter().collect::<Vec<_>>().join(", ")
        ));

        let mut all_records = Vec::new();

        self.logger.progress("Reading all records...");
        for (row_idx, result) in reader.records().enumerate() {
            let record = result?;

            if row_idx > 0 && row_idx % 25000 == 0 {
                self.logger.progress(&format!("Read {} rows...", row_idx));
            }

            all_records.push(record.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        }

        let total_rows = all_records.len();

        self.logger.data(&format!(
            "Processing {} records sequentially...",
            total_rows
        ));

        let chunk_stats = self.process_chunk(&all_records, column_count);

        // Handle duplicate columns - remove identical duplicates, keep different ones with suffix
        let (deduped_headers, column_indices) =
            self.handle_duplicate_columns(&headers, &all_records);

        let mut final_columns = Vec::new();
        for (i, header) in deduped_headers.iter().enumerate() {
            let original_col_idx = column_indices[i];
            let merged_column =
                self.merge_chunk_stats(header, vec![chunk_stats[original_col_idx].clone()]);
            final_columns.push(merged_column);
        }

        self.logger.success(&format!(
            "Sequential analysis complete: {} rows, {} columns (after dedup)",
            total_rows,
            final_columns.len()
        ));

        Ok(CsvAnalysis {
            columns: final_columns,
            total_rows,
            file_path: file_path.to_string(),
        })
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
