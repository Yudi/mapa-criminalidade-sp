//! Integer value cleaning utilities.
//!
//! Handles cleaning of integer values, preserving special patterns like
//! ZIP codes while removing invalid characters.

use crate::logger::Logger;
use crate::patterns::{
    is_brazilian_zip_code, is_dash_identifier, is_excel_overflow, is_nao_informado,
    is_valid_integer, is_whitespace_only, NON_DIGIT_EXCEPT_MINUS,
};

/// Clean an integer value, handling Excel overflow and preserving special patterns.
///
/// This function preserves ZIP codes and identifier patterns with dashes,
/// while cleaning malformed integer values.
///
/// # Arguments
///
/// * `value` - The value to clean
/// * `logger` - Logger for tracking cleaning operations
///
/// # Returns
///
/// A cleaned integer string, or the original value if it's a special pattern,
/// or empty string if the value cannot be cleaned.
///
/// # Examples
///
/// ```
/// use dataset_handling::value_cleaners::clean_integer_value;
/// use dataset_handling::logger::Logger;
///
/// let logger = Logger::new(true);
/// assert_eq!(clean_integer_value("12345", &logger), "12345");
/// assert_eq!(clean_integer_value("12345-678", &logger), "12345-678"); // ZIP code preserved
/// assert_eq!(clean_integer_value("########", &logger), "");
/// ```
pub fn clean_integer_value(value: &str, logger: &Logger) -> String {
    if value.is_empty() {
        return String::new();
    }

    let original_value = value;
    let cleaned = value.trim().to_string();

    // Handle whitespace-only values
    if is_whitespace_only(value) {
        if !original_value.is_empty() {
            logger.debug(&format!(
                "Whitespace-only integer value: \"{}\" -> empty",
                original_value
            ));
        }
        return String::new();
    }

    // Handle "NÃO INFORMADO" and its variations
    if is_nao_informado(&cleaned) {
        logger.debug(&format!(
            "\"NÃO INFORMADO\" pattern detected in integer field: \"{}\" -> empty",
            original_value
        ));
        return String::new();
    }

    // Detect patterns that should be preserved as strings (not cleaned as integers)
    // Brazilian ZIP codes: XXXXX-XXX
    if is_brazilian_zip_code(&cleaned) {
        logger.debug(&format!(
            "Detected Brazilian ZIP code pattern, preserving as string: \"{}\"",
            original_value
        ));
        return original_value.to_string();
    }

    // Other identifier patterns with dashes
    if is_dash_identifier(&cleaned) {
        logger.debug(&format!(
            "Detected identifier with dashes, preserving as string: \"{}\"",
            original_value
        ));
        return original_value.to_string();
    }

    // Handle Excel overflow/error patterns
    if is_excel_overflow(&cleaned) {
        logger.warn(&format!(
            "Excel overflow/error pattern detected in integer column: \"{}\", setting to empty",
            original_value
        ));
        return String::new();
    }

    // Remove non-numeric characters except minus sign
    let mut result = NON_DIGIT_EXCEPT_MINUS.replace_all(&cleaned, "").to_string();

    // Handle minus signs
    result = normalize_minus_sign(&result, original_value);

    // Final validation
    if result.is_empty() || is_valid_integer(&result) {
        // Don't allow just a minus sign by itself
        if result == "-" {
            logger.warn(&format!(
                "Invalid integer value (just minus sign): \"{}\", setting to empty",
                original_value
            ));
            return String::new();
        }

        if result != original_value {
            logger.debug(&format!(
                "Cleaned integer value: \"{}\" -> \"{}\"",
                original_value, result
            ));
        }
        return result;
    }

    // If cleaning failed, return empty and log warning
    logger.warn(&format!(
        "Could not clean malformed integer value: \"{}\", setting to empty",
        original_value
    ));
    String::new()
}

/// Normalize minus sign placement in a value.
///
/// Ensures the minus sign is only at the beginning of the number.
fn normalize_minus_sign(value: &str, original_value: &str) -> String {
    if !value.contains('-') {
        return value.to_string();
    }

    let minus_count = value.matches('-').count();

    if minus_count == 1 && value.starts_with('-') {
        // Valid negative number
        return value.to_string();
    }

    // Invalid pattern - remove all minus signs and add one at start if original was negative
    let without_minus = value.replace('-', "");
    if original_value.starts_with('-') {
        format!("-{}", without_minus)
    } else {
        without_minus
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_integer_value() {
        let logger = Logger::new(true);

        assert_eq!(clean_integer_value("12345", &logger), "12345");
        assert_eq!(clean_integer_value("-12345", &logger), "-12345");
        assert_eq!(clean_integer_value("12345-678", &logger), "12345-678");
        assert_eq!(clean_integer_value("123-456-789", &logger), "123-456-789");
        assert_eq!(clean_integer_value("########", &logger), "");
        assert_eq!(clean_integer_value("", &logger), "");
        assert_eq!(clean_integer_value("-", &logger), "");
    }

    #[test]
    fn test_normalize_minus_sign() {
        assert_eq!(normalize_minus_sign("-123", "-123"), "-123");
        assert_eq!(normalize_minus_sign("123", "123"), "123");
        assert_eq!(normalize_minus_sign("1-2-3", "-123"), "-123");
        assert_eq!(normalize_minus_sign("1-2-3", "123"), "123");
    }
}
