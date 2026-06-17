//! Date value cleaning utilities.
//!
//! Handles date value cleaning and Excel serial date conversion.

use crate::date_time::{
    convert_excel_serial_if_needed, is_timestamp_format, normalize_date_to_iso,
};
use crate::logger::Logger;
use crate::patterns::{is_excel_overflow, is_nao_informado, is_null_pattern, is_whitespace_only};

/// Clean a date value, converting Excel serial dates if needed.
///
/// # Arguments
///
/// * `value` - The date value to clean
/// * `logger` - Logger for tracking cleaning operations
///
/// # Returns
///
/// A cleaned date string in YYYY-MM-DD format, or an empty string when invalid.
///
/// # Examples
///
/// ```
/// use dataset_handling::value_cleaners::clean_date_value;
/// use dataset_handling::logger::Logger;
///
/// let logger = Logger::new(true);
/// assert_eq!(clean_date_value("2024-01-15", &logger), "2024-01-15");
/// assert_eq!(clean_date_value("44927", &logger), "2022-12-31");
/// ```
pub fn clean_date_value(value: &str, logger: &Logger) -> String {
    if value.is_empty() {
        return String::new();
    }

    let original_value = value;
    let trimmed = value.trim();

    if is_whitespace_only(value) || is_nao_informado(trimmed) || is_null_pattern(trimmed) {
        logger.debug(&format!(
            "Empty-like pattern detected in date field: \"{}\" -> empty",
            original_value
        ));
        return String::new();
    }

    if is_excel_overflow(trimmed) {
        logger.warn(&format!(
            "Excel overflow/error pattern detected in date column: \"{}\", setting to empty",
            original_value
        ));
        return String::new();
    }

    if let Some(date) = normalize_date_to_iso(trimmed) {
        return date;
    }

    if is_timestamp_format(trimmed) {
        let date_part = trimmed
            .split([' ', 'T'])
            .next()
            .unwrap_or(trimmed)
            .to_string();
        logger.debug(&format!(
            "Converted timestamp in date column: \"{}\" -> \"{}\"",
            original_value, date_part
        ));
        return date_part;
    }

    let cleaned = convert_excel_serial_if_needed(trimmed);

    if cleaned != trimmed {
        logger.debug(&format!(
            "Converted Excel serial date: \"{}\" -> \"{}\"",
            original_value, cleaned
        ));
        return cleaned;
    }

    logger.warn(&format!(
        "Could not parse date value: \"{}\", setting to empty for database compatibility",
        original_value
    ));
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_date_value() {
        let logger = Logger::new(true);

        assert_eq!(clean_date_value("2024-01-15", &logger), "2024-01-15");
        assert_eq!(clean_date_value("15/01/2024", &logger), "2024-01-15");
        assert_eq!(clean_date_value("17/10/2024", &logger), "2024-10-17");
        assert_eq!(clean_date_value("15-01-2024", &logger), "2024-01-15");
        assert_eq!(clean_date_value("31/12/1999", &logger), "");
        assert_eq!(clean_date_value("31/12/2012", &logger), "");
        assert_eq!(clean_date_value("01/01/2013", &logger), "2013-01-01");
        assert_eq!(clean_date_value("0182-12-06", &logger), "");
        assert_eq!(clean_date_value("41274", &logger), "");
        assert_eq!(clean_date_value("41275", &logger), "2013-01-01");
        assert_eq!(clean_date_value("44927", &logger), "2023-01-01");
        assert_eq!(clean_date_value("45292.0", &logger), "2024-01-01");
        assert_eq!(clean_date_value("45292.5", &logger), "2024-01-01");
        assert_eq!(
            clean_date_value("2024-01-15 10:30:00", &logger),
            "2024-01-15"
        );
        assert_eq!(clean_date_value("REGISTRADO NA PF", &logger), "");
        assert_eq!(clean_date_value("hello", &logger), "");
    }
}
