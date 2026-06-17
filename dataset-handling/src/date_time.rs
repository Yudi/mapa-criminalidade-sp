//! Date and time format detection and conversion utilities.
//!
//! This module provides functions for detecting and parsing various date/time
//! formats, including Excel serial dates, and converting between formats.

use chrono::{Datelike, Days, NaiveDate, NaiveDateTime, NaiveTime};

/// Earliest supported occurrence year for imported crime data.
pub const MIN_VALID_DATE_YEAR: i32 = 2013;

/// Range for valid Excel serial dates.
///
/// Excel serial dates start from January 1, 1900 (day 1).
/// We use a conservative range to avoid false positives with regular numbers.
pub const EXCEL_SERIAL_MIN: i32 = 41275; // January 1, 2013
pub const EXCEL_SERIAL_MAX: i32 = 73050; // December 31, 2099

/// Check if a string represents a valid date in common formats.
///
/// Supported formats:
/// - `YYYY-MM-DD` (ISO 8601)
/// - `DD/MM/YYYY` (European)
/// - `MM/DD/YYYY` (American)
///
/// # Examples
///
/// ```
/// use dataset_handling::date_time::is_date_format;
///
/// assert!(is_date_format("2024-01-15"));
/// assert!(is_date_format("15/01/2024"));
/// assert!(!is_date_format("not a date"));
/// ```
pub fn is_date_format(value: &str) -> bool {
    parse_date_flexible(value).is_some()
}

/// Parse a date string using the formats found in SSP CSV files.
///
/// Brazilian day-first formats are tried before month-first formats so
/// ambiguous slash dates such as 01/02/2024 are treated as 1 February 2024.
pub fn parse_date_flexible(value: &str) -> Option<NaiveDate> {
    let trimmed = value.trim();
    const FORMATS: [&str; 5] = ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y", "%m-%d-%Y"];

    FORMATS
        .iter()
        .find_map(|format| NaiveDate::parse_from_str(trimmed, format).ok())
}

/// Check if a parsed date is inside the supported occurrence data range.
pub fn is_supported_occurrence_date(date: NaiveDate) -> bool {
    date.year() >= MIN_VALID_DATE_YEAR
}

/// Normalize a recognized date string to PostgreSQL-safe ISO date format.
///
/// Returns `None` when the value cannot be parsed as a supported date.
pub fn normalize_date_to_iso(value: &str) -> Option<String> {
    parse_date_flexible(value)
        .filter(|date| is_supported_occurrence_date(*date))
        .map(|date| date.format("%Y-%m-%d").to_string())
}

/// Check if a string represents a valid time in common formats.
///
/// Supported formats:
/// - `HH:MM:SS`
/// - `HH:MM`
///
/// # Examples
///
/// ```
/// use dataset_handling::date_time::is_time_format;
///
/// assert!(is_time_format("14:30:00"));
/// assert!(is_time_format("14:30"));
/// assert!(!is_time_format("not a time"));
/// ```
pub fn is_time_format(value: &str) -> bool {
    NaiveTime::parse_from_str(value, "%H:%M:%S").is_ok()
        || NaiveTime::parse_from_str(value, "%H:%M").is_ok()
}

/// Check if a string represents a valid timestamp in common formats.
///
/// Supported formats:
/// - `YYYY-MM-DD HH:MM:SS`
/// - `YYYY-MM-DDTHH:MM:SS` (ISO 8601)
///
/// # Examples
///
/// ```
/// use dataset_handling::date_time::is_timestamp_format;
///
/// assert!(is_timestamp_format("2024-01-15 14:30:00"));
/// assert!(is_timestamp_format("2024-01-15T14:30:00"));
/// assert!(!is_timestamp_format("2024-01-15"));
/// ```
pub fn is_timestamp_format(value: &str) -> bool {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S").is_ok()
        || NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S").is_ok()
}

/// Check if a value could be an Excel serial date.
///
/// Excel serial dates are integers where:
/// - 1 = January 1, 1900
/// - 41275 = January 1, 2013
/// - 44927 = December 31, 2022
///
/// We use a conservative range (41275-73050) to avoid false positives
/// with regular integers and to reject occurrence dates before 2013.
///
/// # Examples
///
/// ```
/// use dataset_handling::date_time::is_excel_serial_date;
///
/// assert!(is_excel_serial_date("44927")); // Valid Excel date
/// assert!(!is_excel_serial_date("100")); // Too small
/// assert!(!is_excel_serial_date("hello")); // Not a number
/// ```
pub fn is_excel_serial_date(value: &str) -> bool {
    if let Ok(serial) = value.parse::<i32>() {
        serial >= EXCEL_SERIAL_MIN && serial <= EXCEL_SERIAL_MAX
    } else {
        false
    }
}

/// Convert an Excel serial date to a NaiveDate.
///
/// Excel's epoch is January 1, 1900 (day 1), but Excel incorrectly treats
/// 1900 as a leap year (the Lotus 1-2-3 bug). We account for this by using
/// December 30, 1899 as the reference point.
///
/// Returns `None` if the serial number is out of range or conversion fails.
///
/// # Examples
///
/// ```
/// use dataset_handling::date_time::excel_serial_to_date;
///
/// let date = excel_serial_to_date(44927).unwrap();
/// assert_eq!(date.to_string(), "2023-01-01");
/// ```
pub fn excel_serial_to_date(serial: i32) -> Option<NaiveDate> {
    if serial < 1 {
        return None;
    }

    // Excel serial date conversion
    // Excel epoch: January 1, 1900 (but Excel incorrectly treats 1900 as leap year)
    // We use January 0, 1900 (December 31, 1899) and add serial days directly
    // For dates after Feb 28, 1900 (serial > 59), we need to subtract 1 for the bug
    let adjusted_serial = if serial > 59 { serial - 1 } else { serial };
    let excel_epoch = NaiveDate::from_ymd_opt(1899, 12, 31)?;

    excel_epoch.checked_add_days(Days::new(adjusted_serial as u64))
}

/// Convert an Excel serial date string to YYYY-MM-DD format.
///
/// If the input is already in a proper date format, returns it unchanged.
/// If it's an Excel serial date in the valid range, converts it.
/// Otherwise, returns the original value.
///
/// # Examples
///
/// ```
/// use dataset_handling::date_time::convert_excel_serial_if_needed;
///
/// assert_eq!(convert_excel_serial_if_needed("2024-01-15"), "2024-01-15");
/// assert_eq!(convert_excel_serial_if_needed("44927"), "2022-12-31");
/// assert_eq!(convert_excel_serial_if_needed("hello"), "hello");
/// ```
pub fn convert_excel_serial_if_needed(value: &str) -> String {
    // If it's already a recognized date format, normalize it to ISO.
    if let Some(date) = normalize_date_to_iso(value) {
        return date;
    }

    // Try to parse as Excel serial date
    if let Some(serial) = parse_excel_serial_number(value) {
        if serial >= EXCEL_SERIAL_MIN && serial <= EXCEL_SERIAL_MAX {
            if let Some(date) = excel_serial_to_date(serial) {
                return date.format("%Y-%m-%d").to_string();
            }
        }
    }

    // Return original if conversion not applicable
    value.to_string()
}

fn parse_excel_serial_number(value: &str) -> Option<i32> {
    if let Ok(serial) = value.parse::<i32>() {
        return Some(serial);
    }

    let serial = value.parse::<f64>().ok()?;
    if serial >= EXCEL_SERIAL_MIN as f64 && serial <= EXCEL_SERIAL_MAX as f64 {
        Some(serial.floor() as i32)
    } else {
        None
    }
}

/// Parse a time string, handling various malformed formats.
///
/// Supported formats:
/// - Standard: `HH:MM`, `HH:MM:SS`, `HH:MM:SS.microseconds`
/// - Malformed: `23h30`, `23.30`, `2330`, `230`
///
/// Returns `None` if the time cannot be parsed or is invalid.
///
/// # Examples
///
/// ```
/// use dataset_handling::date_time::parse_time_flexible;
///
/// assert_eq!(parse_time_flexible("14:30"), Some("14:30".to_string()));
/// assert_eq!(parse_time_flexible("14h30"), Some("14:30".to_string()));
/// assert_eq!(parse_time_flexible("1430"), Some("14:30".to_string()));
/// assert_eq!(parse_time_flexible("invalid"), None);
/// ```
pub fn parse_time_flexible(value: &str) -> Option<String> {
    let cleaned = value.trim();

    // Try standard formats first
    if let Ok(time) = NaiveTime::parse_from_str(cleaned, "%H:%M:%S") {
        return Some(time.format("%H:%M:%S").to_string());
    }
    if let Ok(time) = NaiveTime::parse_from_str(cleaned, "%H:%M") {
        return Some(time.format("%H:%M").to_string());
    }

    // Try 23h30 format
    if let Some(captures) = parse_hour_minute_pattern(cleaned, 'h') {
        return Some(captures);
    }

    if let Some(time) = parse_excel_time_fraction(cleaned) {
        return Some(time);
    }

    // Try 23.30 format (but not for times with colons)
    if !cleaned.contains(':') {
        if let Some(captures) = parse_hour_minute_pattern(cleaned, '.') {
            return Some(captures);
        }
    }

    // Try numeric format: 2330 or 230
    if let Ok(num) = cleaned.parse::<u32>() {
        return parse_numeric_time(num);
    }

    None
}

/// Parse an Excel fractional day time like 0.25 (06:00:00).
fn parse_excel_time_fraction(value: &str) -> Option<String> {
    let fraction = value.parse::<f64>().ok()?;
    if !(0.0..1.0).contains(&fraction) {
        return None;
    }

    let total_seconds = (fraction * 86_400.0).round() as u32;
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;

    if validate_time_components(hours, minutes, Some(seconds)) {
        Some(format!("{:02}:{:02}:{:02}", hours, minutes, seconds))
    } else {
        None
    }
}

/// Parse a time in format like "23h30" or "23.30".
fn parse_hour_minute_pattern(value: &str, separator: char) -> Option<String> {
    let parts: Vec<&str> = value.split(separator).collect();
    if parts.len() != 2 {
        return None;
    }

    let hours: u32 = parts[0].parse().ok()?;
    let minutes: u32 = parts[1].parse().ok()?;

    if hours <= 23 && minutes <= 59 {
        Some(format!("{:02}:{:02}", hours, minutes))
    } else {
        None
    }
}

/// Parse a numeric time like 2330 (23:30) or 230 (02:30).
fn parse_numeric_time(num: u32) -> Option<String> {
    if num > 2359 {
        return None;
    }

    let hours = num / 100;
    let minutes = num % 100;

    if hours <= 23 && minutes <= 59 {
        Some(format!("{:02}:{:02}", hours, minutes))
    } else {
        None
    }
}

/// Validate time components (hours, minutes, optional seconds).
///
/// Returns true if the time components are valid:
/// - Hours: 0-23
/// - Minutes: 0-59
/// - Seconds: 0-59 (if provided)
#[inline]
pub fn validate_time_components(hours: u32, minutes: u32, seconds: Option<u32>) -> bool {
    if hours > 23 || minutes > 59 {
        return false;
    }
    if let Some(secs) = seconds {
        if secs > 59 {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_date_format() {
        assert!(is_date_format("2024-01-15"));
        assert!(is_date_format("15/01/2024"));
        assert!(is_date_format("01/15/2024"));
        assert!(!is_date_format("2024/01/15"));
        assert!(!is_date_format("not a date"));
    }

    #[test]
    fn test_normalize_date_to_iso_rejects_dates_before_cutoff() {
        assert_eq!(
            normalize_date_to_iso("2013-01-01"),
            Some("2013-01-01".to_string())
        );
        assert_eq!(normalize_date_to_iso("2012-12-31"), None);
    }

    #[test]
    fn test_is_time_format() {
        assert!(is_time_format("14:30:00"));
        assert!(is_time_format("14:30"));
        assert!(is_time_format("00:00:00"));
        assert!(!is_time_format("25:00"));
        assert!(!is_time_format("not a time"));
    }

    #[test]
    fn test_is_timestamp_format() {
        assert!(is_timestamp_format("2024-01-15 14:30:00"));
        assert!(is_timestamp_format("2024-01-15T14:30:00"));
        assert!(!is_timestamp_format("2024-01-15"));
        assert!(!is_timestamp_format("14:30:00"));
    }

    #[test]
    fn test_is_excel_serial_date() {
        assert!(is_excel_serial_date("44927"));
        assert!(is_excel_serial_date("41275"));
        assert!(!is_excel_serial_date("41274"));
        assert!(!is_excel_serial_date("36526"));
        assert!(!is_excel_serial_date("100"));
        assert!(!is_excel_serial_date("30000"));
        assert!(!is_excel_serial_date("100000"));
        assert!(!is_excel_serial_date("hello"));
    }

    #[test]
    fn test_excel_serial_to_date() {
        // January 1, 2013 = 41275
        let date = excel_serial_to_date(41275).unwrap();
        assert_eq!(date.to_string(), "2013-01-01");

        // Invalid serial
        assert!(excel_serial_to_date(0).is_none());
        assert!(excel_serial_to_date(-1).is_none());
    }

    #[test]
    fn test_parse_time_flexible() {
        assert_eq!(parse_time_flexible("14:30"), Some("14:30".to_string()));
        assert_eq!(
            parse_time_flexible("14:30:45"),
            Some("14:30:45".to_string())
        );
        assert_eq!(parse_time_flexible("14h30"), Some("14:30".to_string()));
        assert_eq!(parse_time_flexible("1430"), Some("14:30".to_string()));
        assert_eq!(parse_time_flexible("230"), Some("02:30".to_string()));
        assert_eq!(parse_time_flexible("0.25"), Some("06:00:00".to_string()));
        assert_eq!(
            parse_time_flexible("0.5074652777777778"),
            Some("12:10:45".to_string())
        );
        assert_eq!(parse_time_flexible("invalid"), None);
        assert_eq!(parse_time_flexible("25:00"), None);
    }

    #[test]
    fn test_validate_time_components() {
        assert!(validate_time_components(14, 30, None));
        assert!(validate_time_components(14, 30, Some(45)));
        assert!(validate_time_components(0, 0, Some(0)));
        assert!(validate_time_components(23, 59, Some(59)));
        assert!(!validate_time_components(24, 0, None));
        assert!(!validate_time_components(14, 60, None));
        assert!(!validate_time_components(14, 30, Some(60)));
    }
}
