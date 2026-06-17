//! Shared types for CSV analysis and processing.
//!
//! This module contains all the data structures used across the CSV handling
//! pipeline, including column analysis results, numeric statistics, and
//! chunk-based processing statistics.

use serde::{Deserialize, Serialize};

/// Statistics for integer value ranges, used to determine the optimal PostgreSQL integer type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum IntegerRange {
    /// -32,768 to 32,767
    SmallInt,
    /// -2,147,483,648 to 2,147,483,647
    Int,
    /// Larger than INT
    BigInt,
}

/// Numeric statistics for a column.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NumericStats {
    pub min_value: f64,
    pub max_value: f64,
    pub is_integer: bool,
    pub integer_range: IntegerRange,
}

/// Analysis result for a single CSV column.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnAnalysis {
    /// Original column name from the CSV
    pub name: String,
    /// Normalized column name for database compatibility
    pub normalized_name: String,
    /// Recommended PostgreSQL type based on analysis
    pub recommended_type: String,
    /// Sample values from the column
    pub sample_values: Vec<String>,
    /// Count of null/empty values
    pub null_count: usize,
    /// Total number of values analyzed
    pub total_count: usize,
    /// Minimum string length of non-null values
    pub min_length: usize,
    /// Maximum string length of non-null values
    pub max_length: usize,
    /// Approximate count of unique values
    pub unique_count: usize,
    /// Numeric statistics if the column is numeric
    pub numeric_stats: Option<NumericStats>,
    /// Whether ALL non-null values match TIME format
    #[serde(default)]
    pub all_time_format: bool,
    /// Whether ALL non-null values match DATE format
    #[serde(default)]
    pub all_date_format: bool,
    /// Whether ALL non-null values match TIMESTAMP format
    #[serde(default)]
    pub all_timestamp_format: bool,
    /// Whether ANY value matches a ZIP code pattern
    #[serde(default)]
    pub has_zip_code_pattern: bool,
}

impl ColumnAnalysis {
    /// Create a new empty column analysis with default values.
    pub fn new(name: &str, normalized_name: &str) -> Self {
        Self {
            name: name.to_string(),
            normalized_name: normalized_name.to_string(),
            recommended_type: "TEXT".to_string(),
            sample_values: Vec::new(),
            null_count: 0,
            total_count: 0,
            min_length: usize::MAX,
            max_length: 0,
            unique_count: 0,
            numeric_stats: None,
            all_time_format: true,
            all_date_format: true,
            all_timestamp_format: true,
            has_zip_code_pattern: false,
        }
    }

    /// Get the number of non-null values in the column.
    #[inline]
    pub fn non_null_count(&self) -> usize {
        self.total_count.saturating_sub(self.null_count)
    }
}

/// Complete analysis result for a CSV file.
#[derive(Debug, Serialize, Deserialize)]
pub struct CsvAnalysis {
    /// Analysis results for each column
    pub columns: Vec<ColumnAnalysis>,
    /// Total number of data rows (excluding header)
    pub total_rows: usize,
    /// Path to the analyzed file
    pub file_path: String,
}

/// Numeric statistics tracked during chunk processing.
///
/// This is an internal structure used during parallel/sequential analysis
/// before being converted to the final `NumericStats`.
#[derive(Debug, Clone)]
pub struct ChunkNumericStats {
    pub min_value: f64,
    pub max_value: f64,
    pub is_integer: bool,
    /// Critical: tracks if ALL values in this chunk are numeric
    pub all_numeric: bool,
}

impl ChunkNumericStats {
    /// Create new chunk numeric stats for a numeric value.
    pub fn new_numeric(value: f64) -> Self {
        Self {
            min_value: value,
            max_value: value,
            is_integer: value.fract() == 0.0,
            all_numeric: true,
        }
    }

    /// Create new chunk numeric stats for a non-numeric value.
    pub fn new_non_numeric() -> Self {
        Self {
            min_value: 0.0,
            max_value: 0.0,
            is_integer: false,
            all_numeric: false,
        }
    }

    /// Update stats with a new numeric value.
    pub fn update(&mut self, value: f64) {
        self.min_value = self.min_value.min(value);
        self.max_value = self.max_value.max(value);
        if value.fract() != 0.0 {
            self.is_integer = false;
        }
    }

    /// Mark as containing non-numeric values.
    pub fn mark_non_numeric(&mut self) {
        self.all_numeric = false;
    }
}

/// Statistics tracked for a chunk of data during analysis.
///
/// Used in both sequential and parallel processing to aggregate
/// statistics before final merging.
#[derive(Debug, Clone)]
pub struct ChunkStats {
    pub null_count: usize,
    pub total_non_null: usize,
    pub min_length: usize,
    pub max_length: usize,
    pub numeric_stats: Option<ChunkNumericStats>,
    pub sample_values: Vec<String>,
    pub unique_count: usize,
    /// Whether ALL non-null values in this chunk match TIME format
    pub all_time_format: bool,
    /// Whether ALL non-null values in this chunk match DATE format
    pub all_date_format: bool,
    /// Whether ALL non-null values in this chunk match TIMESTAMP format
    pub all_timestamp_format: bool,
    /// Whether we've seen any non-null values yet
    pub has_non_null_values: bool,
    /// Whether ANY value in this chunk matches a ZIP code pattern
    pub has_zip_code_pattern: bool,
}

impl ChunkStats {
    /// Create new empty chunk statistics.
    pub fn new() -> Self {
        Self {
            null_count: 0,
            total_non_null: 0,
            min_length: usize::MAX,
            max_length: 0,
            numeric_stats: None,
            sample_values: Vec::new(),
            unique_count: 0,
            all_time_format: true,
            all_date_format: true,
            all_timestamp_format: true,
            has_non_null_values: false,
            has_zip_code_pattern: false,
        }
    }

    /// Record a null/empty value.
    #[inline]
    pub fn record_null(&mut self) {
        self.null_count += 1;
    }

    /// Update length statistics with a new value.
    #[inline]
    pub fn update_length(&mut self, len: usize) {
        self.min_length = self.min_length.min(len);
        self.max_length = self.max_length.max(len);
    }

    /// Record a numeric value.
    pub fn record_numeric(&mut self, value: f64) {
        match &mut self.numeric_stats {
            Some(stats) => stats.update(value),
            None => self.numeric_stats = Some(ChunkNumericStats::new_numeric(value)),
        }
    }

    /// Record a non-numeric value.
    pub fn record_non_numeric(&mut self) {
        match &mut self.numeric_stats {
            Some(stats) => stats.mark_non_numeric(),
            None => self.numeric_stats = Some(ChunkNumericStats::new_non_numeric()),
        }
    }

    /// Add a sample value if under the limit.
    pub fn add_sample(&mut self, value: String, max_samples: usize) {
        if self.sample_values.len() < max_samples {
            self.sample_values.push(value);
        }
    }

    /// Update datetime format tracking for a value.
    ///
    /// This should be called for every non-null value to track whether
    /// ALL values in the column match specific datetime formats.
    #[inline]
    pub fn update_datetime_format(&mut self, is_time: bool, is_date: bool, is_timestamp: bool) {
        self.has_non_null_values = true;
        if !is_time {
            self.all_time_format = false;
        }
        if !is_date {
            self.all_date_format = false;
        }
        if !is_timestamp {
            self.all_timestamp_format = false;
        }
    }

    /// Record that a ZIP code pattern was found.
    #[inline]
    pub fn record_zip_code_pattern(&mut self) {
        self.has_zip_code_pattern = true;
    }
}

impl Default for ChunkStats {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_stats_new() {
        let stats = ChunkStats::new();
        assert_eq!(stats.null_count, 0);
        assert_eq!(stats.total_non_null, 0);
        assert_eq!(stats.min_length, usize::MAX);
        assert_eq!(stats.max_length, 0);
        assert!(stats.numeric_stats.is_none());
    }

    #[test]
    fn test_chunk_numeric_stats() {
        let mut stats = ChunkNumericStats::new_numeric(10.0);
        assert!(stats.all_numeric);
        assert!(stats.is_integer);

        stats.update(5.5);
        assert!(!stats.is_integer);
        assert_eq!(stats.min_value, 5.5);
        assert_eq!(stats.max_value, 10.0);

        stats.mark_non_numeric();
        assert!(!stats.all_numeric);
    }

    #[test]
    fn test_column_analysis_non_null_count() {
        let mut analysis = ColumnAnalysis::new("test", "TEST");
        analysis.total_count = 100;
        analysis.null_count = 25;
        assert_eq!(analysis.non_null_count(), 75);
    }
}
