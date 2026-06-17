//! PostgreSQL type inference from column analysis.
//!
//! This module provides functions to determine the optimal PostgreSQL data type
//! for a column based on its analyzed content.
//!
//! Note: Datetime format detection is now done during chunk processing in the analyzer,
//! where ALL rows are analyzed. The type inference uses pre-computed flags from that analysis.

use crate::types::{ColumnAnalysis, IntegerRange, NumericStats};

/// Configuration for type inference behavior.
#[derive(Debug, Clone)]
pub struct TypeInferenceConfig {
    /// Whether to be conservative with SMALLINT detection
    pub conservative_smallint: bool,
    /// Maximum sample count for confident SMALLINT
    pub smallint_max_rows: usize,
}

impl Default for TypeInferenceConfig {
    fn default() -> Self {
        Self {
            conservative_smallint: true,
            smallint_max_rows: 100000,
        }
    }
}

/// Determine the optimal PostgreSQL type for a column based on its analysis.
///
/// This function analyzes sample values and statistics to recommend the most
/// appropriate PostgreSQL data type.
///
/// # Arguments
///
/// * `column` - The column analysis containing statistics and samples
///
/// # Returns
///
/// A string representing the PostgreSQL data type (e.g., "INT", "TEXT", "DATE")
pub fn determine_postgresql_type(column: &ColumnAnalysis) -> String {
    determine_postgresql_type_with_config(column, &TypeInferenceConfig::default())
}

/// Determine the optimal PostgreSQL type with custom configuration.
pub fn determine_postgresql_type_with_config(
    column: &ColumnAnalysis,
    config: &TypeInferenceConfig,
) -> String {
    let non_null_count = column.non_null_count();

    if non_null_count == 0 {
        return "TEXT".to_string();
    }

    // Check for special identifier columns - use TEXT, not numeric
    if is_identifier_column(&column.normalized_name) {
        return determine_text_type();
    }

    // Check if column contains ZIP code patterns - treat as TEXT, not numeric
    if column.has_zip_code_pattern {
        return determine_text_type();
    }

    // Check if ALL non-null values are numeric
    let is_numeric = column.numeric_stats.is_some();
    let is_integer = column
        .numeric_stats
        .as_ref()
        .map(|s| s.is_integer)
        .unwrap_or(false);

    // Use pre-computed datetime format flags from full data analysis
    // These flags are set during chunk processing where ALL rows are analyzed,
    // not just samples, ensuring we catch any non-conforming values

    // Determine the best type based on analysis
    if column.all_timestamp_format {
        "TIMESTAMP".to_string()
    } else if column.all_date_format {
        "DATE".to_string()
    } else if column.all_time_format {
        "TIME".to_string()
    } else if is_numeric && is_integer {
        determine_integer_type(column.numeric_stats.as_ref(), column, config)
    } else if is_numeric {
        "NUMERIC".to_string()
    } else {
        determine_text_type()
    }
}

/// Check if a column name indicates an identifier field.
fn is_identifier_column(normalized_name: &str) -> bool {
    let lower = normalized_name.to_lowercase();
    lower.contains("cep")
        || lower.contains("zip")
        || lower.contains("postal")
        || lower.contains("codigo_postal")
}

/// Determine the appropriate integer type based on value range.
fn determine_integer_type(
    stats: Option<&NumericStats>,
    column: &ColumnAnalysis,
    config: &TypeInferenceConfig,
) -> String {
    if let Some(stats) = stats {
        if config.conservative_smallint {
            // Be very conservative with SMALLINT - need enough data to be confident
            let is_highly_confident_smallint = stats.min_value >= 0.0
                && stats.max_value <= 10000.0
                && column.non_null_count() >= 20
                && column.total_count < config.smallint_max_rows;

            if is_highly_confident_smallint {
                return "SMALLINT".to_string();
            }
        }

        if stats.min_value >= -2_147_483_648.0 && stats.max_value <= 2_147_483_647.0 {
            "INT".to_string()
        } else {
            "BIGINT".to_string()
        }
    } else {
        "INT".to_string() // Fallback
    }
}

/// Determine the appropriate string type for text content.
///
/// Always returns TEXT for string columns because:
/// 1. PostgreSQL TEXT has optimal performance for variable-length strings
/// 2. External data may have longer values in future imports
/// 3. TEXT has no length limit, making it safest for dynamic imports
fn determine_text_type() -> String {
    "TEXT".to_string()
}

/// Calculate the integer range from numeric statistics.
pub fn calculate_integer_range(min: f64, max: f64) -> IntegerRange {
    if min >= -32_768.0 && max <= 32_767.0 {
        IntegerRange::SmallInt
    } else if min >= -2_147_483_648.0 && max <= 2_147_483_647.0 {
        IntegerRange::Int
    } else {
        IntegerRange::BigInt
    }
}

/// Apply intelligent type correction based on column naming patterns.
///
/// This function corrects common misdetections, such as descriptive text
/// columns being typed as TIME.
///
/// # Arguments
///
/// * `column_name` - The original column name
/// * `db_type` - The detected database type
/// * `sample_value` - Optional sample value for content-based correction
///
/// # Returns
///
/// The corrected type if a correction is needed, otherwise the original type.
pub fn correct_column_type(column_name: &str, db_type: &str, sample_value: Option<&str>) -> String {
    let column_upper = column_name.to_uppercase();
    let db_type_lower = db_type.to_lowercase();

    // DESCR_* columns should be text, not time
    if (column_upper.contains("DESCR_PERIODO") || column_upper.contains("DESC_PERIODO"))
        && (db_type_lower == "time" || db_type_lower.contains("time"))
    {
        return "text".to_string();
    }

    // HORA columns that likely contain descriptive text should be treated as text
    if (db_type_lower == "time" || db_type_lower.contains("time")) && column_upper.contains("HORA") {
        // Check for patterns that suggest descriptive text rather than time values
        if column_upper.contains("DESCR")
            || column_upper.contains("DESC")
            || column_upper.contains("PERIODO")
            || column_upper.contains("TIPO")
        {
            return "text".to_string();
        }

        // Content-based correction: check if the sample value looks like descriptive text
        if let Some(value) = sample_value {
            if crate::utils::is_descriptive_text(value) {
                return "text".to_string();
            }
        }
    }

    // Only actual time columns should use time type
    if db_type_lower == "time" || db_type_lower.contains("time") {
        if !column_upper.contains("HORA")
            && !column_upper.contains("TIME")
            && !column_upper.contains("HORARIO")
        {
            return "text".to_string();
        }
    }

    db_type.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_identifier_column() {
        assert!(is_identifier_column("CEP"));
        assert!(is_identifier_column("ZIP_CODE"));
        assert!(is_identifier_column("CODIGO_POSTAL"));
        assert!(!is_identifier_column("NAME"));
        assert!(!is_identifier_column("AGE"));
    }

    #[test]
    fn test_determine_text_type() {
        // All string columns should use TEXT for safety with external data
        assert_eq!(determine_text_type(), "TEXT");
    }

    #[test]
    fn test_calculate_integer_range() {
        assert_eq!(calculate_integer_range(0.0, 100.0), IntegerRange::SmallInt);
        assert_eq!(
            calculate_integer_range(-50000.0, 50000.0),
            IntegerRange::Int
        );
        assert_eq!(
            calculate_integer_range(0.0, 3_000_000_000.0),
            IntegerRange::BigInt
        );
    }

    #[test]
    fn test_correct_column_type() {
        assert_eq!(correct_column_type("DESCR_PERIODO", "time", None), "text");
        assert_eq!(correct_column_type("HORA_FATO", "time", None), "time");
        assert_eq!(correct_column_type("HORA_DESCRICAO", "time", None), "text");
        assert_eq!(correct_column_type("RANDOM_COLUMN", "time", None), "text");
    }
}
