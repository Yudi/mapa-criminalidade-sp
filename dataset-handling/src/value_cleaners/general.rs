//! General value cleaning utilities.
//!
//! Handles cleaning of general text values.

use crate::logger::Logger;
use crate::patterns::{is_nao_informado, is_null_pattern};

/// Clean a general value, handling "NÃO INFORMADO" patterns.
///
/// # Arguments
///
/// * `value` - The value to clean
/// * `logger` - Logger for tracking cleaning operations
///
/// # Returns
///
/// A trimmed string, or empty string if the value represents "not informed".
///
/// # Examples
///
/// ```
/// use dataset_handling::value_cleaners::clean_general_value;
/// use dataset_handling::logger::Logger;
///
/// let logger = Logger::new(true);
/// assert_eq!(clean_general_value("  hello  ", &logger), "hello");
/// assert_eq!(clean_general_value("NÃO INFORMADO", &logger), "");
/// ```
pub fn clean_general_value(value: &str, logger: &Logger) -> String {
    if value.is_empty() {
        return String::new();
    }

    let cleaned = value.trim();

    // Handle "NÃO INFORMADO" and its variations
    if is_nao_informado(cleaned) {
        logger.debug(&format!(
            "ℹ️ \"NÃO INFORMADO\" pattern detected: \"{}\" -> empty",
            value
        ));
        return String::new();
    }

    // Handle NULL-like patterns (NULL, NULLNULL, etc.)
    if is_null_pattern(cleaned) {
        logger.debug(&format!("ℹ️ NULL pattern detected: \"{}\" -> empty", value));
        return String::new();
    }

    cleaned.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_general_value() {
        let logger = Logger::new(true);

        assert_eq!(clean_general_value("hello", &logger), "hello");
        assert_eq!(clean_general_value("  hello  ", &logger), "hello");
        assert_eq!(clean_general_value("NÃO INFORMADO", &logger), "");
        assert_eq!(clean_general_value("nao informado", &logger), "");
        assert_eq!(clean_general_value("", &logger), "");
    }
}
