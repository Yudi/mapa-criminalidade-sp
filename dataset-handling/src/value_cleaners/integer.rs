//! Integer value cleaning utilities.
//!
//! Handles cleaning of integer values, preserving special patterns like
//! ZIP codes while removing invalid characters.

use crate::logger::Logger;
use crate::patterns::{
    is_brazilian_zip_code, is_dash_identifier, is_excel_overflow, is_nao_informado,
    is_whitespace_only,
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

    if let Some(result) = parse_exact_integer(&cleaned) {
        if result != original_value {
            logger.debug(&format!(
                "Cleaned integer value: \"{}\" -> \"{}\"",
                original_value, result
            ));
        }
        return result;
    }

    // Keep the original dirty value in the TEXT raw table. Downstream
    // projections can reject it with a field-level reason without silently
    // turning punctuation or alphabetic text into a different integer.
    logger.warn(&format!(
        "Could not clean malformed integer value: \"{}\", preserving source text",
        original_value
    ));
    cleaned
}

fn parse_exact_integer(value: &str) -> Option<String> {
    let compact = value
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>();
    if compact.is_empty() {
        return None;
    }

    let (negative, unsigned) = match compact.as_bytes().first() {
        Some(b'-') => (true, &compact[1..]),
        Some(b'+') => (false, &compact[1..]),
        _ => (false, compact.as_str()),
    };
    if unsigned.is_empty() || unsigned.contains(['+', '-']) {
        return None;
    }

    let digits = if unsigned.contains('.') && unsigned.contains(',') {
        let decimal_separator = if unsigned.rfind('.') > unsigned.rfind(',') {
            '.'
        } else {
            ','
        };
        let grouping_separator = if decimal_separator == '.' { ',' } else { '.' };
        let (integer, fractional) = unsigned.rsplit_once(decimal_separator)?;
        if fractional.is_empty()
            || !fractional.chars().all(|character| character == '0')
            || !valid_grouped_integer(integer, grouping_separator)
        {
            return None;
        }
        integer
            .chars()
            .filter(|character| *character != grouping_separator)
            .collect::<String>()
    } else {
        let separator = if unsigned.contains('.') { '.' } else { ',' };
        let separator_count = unsigned.matches(separator).count();
        if separator_count == 0 {
            if !unsigned.chars().all(|character| character.is_ascii_digit()) {
                return None;
            }
            unsigned.to_string()
        } else if separator_count > 1 {
            if !valid_grouped_integer(unsigned, separator) {
                return None;
            }
            unsigned
                .chars()
                .filter(|character| *character != separator)
                .collect::<String>()
        } else {
            let (integer, fractional) = unsigned.split_once(separator)?;
            // A single three-digit separator is ambiguous between a locale
            // decimal ("1.234") and a thousands group ("1.234"). Reject it
            // rather than inventing either interpretation.
            if integer.is_empty()
                || fractional.is_empty()
                || fractional.len() == 3
                || !integer.chars().all(|character| character.is_ascii_digit())
                || !fractional.chars().all(|character| character.is_ascii_digit())
                || !fractional.chars().all(|character| character == '0')
            {
                return None;
            }
            integer.to_string()
        }
    };

    let digits = digits.trim_start_matches('0');
    let canonical = if digits.is_empty() { "0" } else { digits };
    if negative && canonical != "0" {
        Some(format!("-{}", canonical))
    } else {
        Some(canonical.to_string())
    }
}

fn valid_grouped_integer(value: &str, separator: char) -> bool {
    let groups = value.split(separator).collect::<Vec<_>>();
    groups.len() >= 2
        && !groups[0].is_empty()
        && groups[0].len() <= 3
        && groups.iter().all(|group| {
            !group.is_empty() && group.chars().all(|character| character.is_ascii_digit())
        })
        && groups.iter().skip(1).all(|group| group.len() == 3)
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
        assert_eq!(clean_integer_value("-", &logger), "-");
        assert_eq!(clean_integer_value("2026.0", &logger), "2026");
        assert_eq!(clean_integer_value("2026,0", &logger), "2026");
        assert_eq!(clean_integer_value("1,0", &logger), "1");
        assert_eq!(clean_integer_value("1.234", &logger), "1.234");
        assert_eq!(clean_integer_value("1,234", &logger), "1,234");
        assert_eq!(clean_integer_value("1.234.567", &logger), "1234567");
        assert_eq!(clean_integer_value("1,234,567", &logger), "1234567");
        assert_eq!(clean_integer_value("12abc", &logger), "12abc");
    }

    #[test]
    fn parse_exact_integer_rejects_non_integral_values() {
        assert_eq!(parse_exact_integer("1.5"), None);
        assert_eq!(parse_exact_integer("1,5"), None);
        assert_eq!(parse_exact_integer("1e3"), None);
        assert_eq!(parse_exact_integer("-1"), Some("-1".to_string()));
    }
}
