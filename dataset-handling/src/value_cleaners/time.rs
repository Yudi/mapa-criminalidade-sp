//! Time value cleaning utilities.
//!
//! Handles cleaning and normalization of time values in various formats.

use crate::date_time::parse_time_flexible;
use crate::logger::Logger;
use crate::patterns::{
    is_excel_overflow, is_nao_informado, is_null_pattern, is_whitespace_only, matches_time_pattern,
};

/// Clean a time value, handling malformed formats and empty values.
///
/// Supports various time formats including:
/// - Standard: HH:MM, HH:MM:SS
/// - Malformed: 23h30, 23.30, 2330
///
/// # Arguments
///
/// * `value` - The time value to clean
/// * `logger` - Logger for tracking cleaning operations
///
/// # Returns
///
/// A normalized time string (HH:MM or HH:MM:SS), or empty string if invalid.
///
/// # Examples
///
/// ```
/// use dataset_handling::value_cleaners::clean_time_value;
/// use dataset_handling::logger::Logger;
///
/// let logger = Logger::new(true);
/// assert_eq!(clean_time_value("14:30", &logger), "14:30");
/// assert_eq!(clean_time_value("14h30", &logger), "14:30");
/// assert_eq!(clean_time_value("1430", &logger), "14:30");
/// ```
pub fn clean_time_value(value: &str, logger: &Logger) -> String {
    if value.is_empty() {
        return String::new();
    }

    let original_value = value;
    let cleaned = value.trim();

    // Handle whitespace-only values
    if is_whitespace_only(value) {
        if !original_value.is_empty() {
            logger.debug(&format!(
                "Whitespace-only time value: \"{}\" -> empty",
                original_value
            ));
        }
        return String::new();
    }

    // Handle "NÃO INFORMADO" and its variations
    if is_nao_informado(cleaned) {
        logger.debug(&format!(
            "\"NÃO INFORMADO\" pattern detected in time field: \"{}\" -> empty",
            original_value
        ));
        return String::new();
    }

    // Handle NULL-like patterns (NULL, NULLNULL, etc.)
    if is_null_pattern(cleaned) {
        logger.debug(&format!(
            "NULL pattern detected in time field: \"{}\" -> empty",
            original_value
        ));
        return String::new();
    }

    // Handle Excel overflow/error patterns
    if is_excel_overflow(cleaned) {
        logger.warn(&format!(
            "Excel overflow/error pattern detected in time column: \"{}\", setting to empty",
            original_value
        ));
        return String::new();
    }

    // Check if it's already a valid time format
    if matches_time_pattern(cleaned) {
        if let Some(normalized) = validate_and_normalize_time(cleaned) {
            if normalized != original_value {
                logger.debug(&format!(
                    "Cleaned time value: \"{}\" -> \"{}\"",
                    original_value, normalized
                ));
            }
            return normalized;
        }
    }

    // Try flexible parsing for malformed formats
    if let Some(normalized) = parse_time_flexible(cleaned) {
        logger.debug(&format!(
            "Converted malformed time: \"{}\" -> \"{}\"",
            original_value, normalized
        ));
        return normalized;
    }

    // If we can't parse the time, return empty for database compatibility
    logger.warn(&format!(
        "Could not parse time value: \"{}\", setting to empty for database compatibility",
        original_value
    ));
    String::new()
}

/// Validate and normalize a time string that matches a known pattern.
fn validate_and_normalize_time(value: &str) -> Option<String> {
    let parts: Vec<&str> = value.split(':').collect();
    if parts.is_empty() {
        return None;
    }

    let hours: u32 = parts[0].parse().ok()?;
    let minutes: u32 = parts.get(1)?.parse().ok()?;

    if hours > 23 || minutes > 59 {
        return None;
    }

    if parts.len() == 3 {
        // Handle seconds (and possible microseconds)
        let seconds_part = parts[2].split('.').next().unwrap_or(parts[2]);
        let seconds: u32 = seconds_part.parse().ok()?;

        if seconds > 59 {
            return None;
        }

        // Return with original precision
        Some(value.to_string())
    } else {
        // Just HH:MM format
        Some(value.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_time_value() {
        let logger = Logger::new(true);

        assert_eq!(clean_time_value("14:30", &logger), "14:30");
        assert_eq!(clean_time_value("14:30:45", &logger), "14:30:45");
        assert_eq!(clean_time_value("14h30", &logger), "14:30");
        assert_eq!(clean_time_value("1430", &logger), "14:30");
        assert_eq!(clean_time_value("230", &logger), "02:30");
        assert_eq!(clean_time_value("0.25", &logger), "06:00:00");
        assert_eq!(clean_time_value("########", &logger), "");
        assert_eq!(clean_time_value("", &logger), "");
    }

    #[test]
    fn test_validate_and_normalize_time() {
        assert_eq!(
            validate_and_normalize_time("14:30"),
            Some("14:30".to_string())
        );
        assert_eq!(
            validate_and_normalize_time("14:30:45"),
            Some("14:30:45".to_string())
        );
        assert_eq!(validate_and_normalize_time("25:00"), None);
        assert_eq!(validate_and_normalize_time("14:60"), None);
    }
}
