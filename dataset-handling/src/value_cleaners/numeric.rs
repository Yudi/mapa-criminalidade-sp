//! Numeric value cleaning utilities.
//!
//! Handles cleaning of decimal numbers, fixing malformed separators,
//! and handling Excel overflow patterns.

use crate::logger::Logger;
use crate::patterns::{
    is_excel_overflow, is_nao_informado, is_valid_numeric, is_whitespace_only, COMMA_DECIMAL,
    EXTRACT_NUMERIC, LEADING_SEPARATOR_AFTER_MINUS, MIXED_SEPARATORS, MULTI_COMMA, MULTI_PERIOD,
    PERIOD_COMMA_MIX, TRAILING_SEPARATOR,
};

/// Clean a numeric value, handling malformed decimal separators and Excel errors.
///
/// # Arguments
///
/// * `value` - The value to clean
/// * `logger` - Logger for tracking cleaning operations
///
/// # Returns
///
/// A cleaned numeric string, or empty string if the value cannot be cleaned.
///
/// # Examples
///
/// ```
/// use dataset_handling::value_cleaners::clean_numeric_value;
/// use dataset_handling::logger::Logger;
///
/// let logger = Logger::new(true);
/// assert_eq!(clean_numeric_value("123,45", &logger), "123.45");
/// assert_eq!(clean_numeric_value("-22,.8", &logger), "-22.8");
/// assert_eq!(clean_numeric_value("########", &logger), "");
/// ```
pub fn clean_numeric_value(value: &str, logger: &Logger) -> String {
    if value.is_empty() {
        return String::new();
    }

    let original_value = value;
    let mut cleaned = value.trim().to_string();

    // Handle whitespace-only values
    if is_whitespace_only(value) {
        if !original_value.is_empty() {
            logger.debug(&format!(
                "Whitespace-only numeric value: \"{}\" -> empty",
                original_value
            ));
        }
        return String::new();
    }

    // Handle "NÃO INFORMADO" and its variations
    if is_nao_informado(&cleaned) {
        logger.debug(&format!(
            "\"NÃO INFORMADO\" pattern detected in numeric field: \"{}\" -> empty",
            original_value
        ));
        return String::new();
    }

    // Handle Excel overflow/error patterns
    if is_excel_overflow(&cleaned) {
        logger.warn(&format!(
            "Excel overflow/error pattern detected: \"{}\", setting to empty",
            original_value
        ));
        return String::new();
    }

    // Apply cleaning transformations
    cleaned = apply_numeric_cleaning(&cleaned);

    // Final validation
    if is_valid_numeric(&cleaned) {
        if cleaned != original_value {
            logger.debug(&format!(
                "Cleaned numeric value: \"{}\" -> \"{}\"",
                original_value, cleaned
            ));
        }
        return cleaned;
    }

    // Try aggressive extraction
    if let Some(result) = extract_numeric_aggressively(&cleaned) {
        if result != original_value {
            logger.warn(&format!(
                "Aggressively cleaned malformed numeric: \"{}\" -> \"{}\"",
                original_value, result
            ));
        }
        return result;
    }

    // Complete failure
    logger.warn(&format!(
        "Could not clean malformed numeric value: \"{}\", setting to empty",
        original_value
    ));
    String::new()
}

/// Apply all numeric cleaning transformations.
fn apply_numeric_cleaning(value: &str) -> String {
    let mut cleaned = value.to_string();
    cleaned = COMMA_DECIMAL.replace_all(&cleaned, "$1.$2").to_string();
    cleaned = PERIOD_COMMA_MIX
        .replace_all(&cleaned, "$1.$2$3")
        .to_string();
    cleaned = MULTI_PERIOD.replace_all(&cleaned, ".").to_string();
    cleaned = MULTI_COMMA.replace_all(&cleaned, ".").to_string();
    cleaned = MIXED_SEPARATORS.replace_all(&cleaned, ".").to_string();
    cleaned = TRAILING_SEPARATOR.replace_all(&cleaned, "").to_string();
    cleaned = LEADING_SEPARATOR_AFTER_MINUS
        .replace_all(&cleaned, "$1")
        .to_string();

    cleaned
}

/// Try to extract numeric parts more aggressively from malformed values.
fn extract_numeric_aggressively(value: &str) -> Option<String> {
    EXTRACT_NUMERIC.captures(value).map(|captures| {
        let integer = captures.get(1).unwrap().as_str();
        match captures.get(2) {
            Some(decimal) => format!("{}.{}", integer, decimal.as_str()),
            None => integer.to_string(),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_numeric_value() {
        let logger = Logger::new(true);

        assert_eq!(clean_numeric_value("123.45", &logger), "123.45");
        assert_eq!(clean_numeric_value("123,45", &logger), "123.45");
        assert_eq!(clean_numeric_value("-22,.8", &logger), "-22.8");
        assert_eq!(clean_numeric_value("12..34", &logger), "12.34");
        assert_eq!(clean_numeric_value("12.", &logger), "12");
        assert_eq!(clean_numeric_value("########", &logger), "");
        assert_eq!(clean_numeric_value("", &logger), "");
        assert_eq!(clean_numeric_value("   ", &logger), "");
    }

    #[test]
    fn test_apply_numeric_cleaning() {
        assert_eq!(apply_numeric_cleaning("123,45"), "123.45");
        assert_eq!(apply_numeric_cleaning("-22,.8"), "-22.8");
        assert_eq!(apply_numeric_cleaning("12..34"), "12.34");
        assert_eq!(apply_numeric_cleaning("12."), "12");
    }
}
