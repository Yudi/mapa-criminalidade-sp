use once_cell::sync::Lazy;
use regex::Regex;

pub static WHITESPACE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*$").unwrap());

pub static NAO_INFORMADO: Lazy<Regex> = Lazy::new(|| Regex::new(r"^n[ãa]o\s+informado$").unwrap());

pub static NULL_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(?i)(null)+$").unwrap());

pub static EXCEL_OVERFLOW: Lazy<Regex> = Lazy::new(|| Regex::new(r"^#+$").unwrap());

pub static NUMERIC: Lazy<Regex> = Lazy::new(|| Regex::new(r"^-?\d*\.?\d*$").unwrap());

pub static ZIP_CODE_BR: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\d{5}-\d{3}$").unwrap());

pub static IDENTIFIER_WITH_DASHES: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\d+(-\d+)+$").unwrap());

pub static INTEGER: Lazy<Regex> = Lazy::new(|| Regex::new(r"^-?\d+$").unwrap());

pub static DATE_ISO: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\d{4}-\d{2}-\d{2}$").unwrap());

pub static DATE_EU: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\d{1,2}/\d{1,2}/\d{4}$").unwrap());

pub static DATE_DASH: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\d{1,2}-\d{1,2}-\d{4}$").unwrap());

pub static TIME_HH_MM: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\d{1,2}:\d{2}$").unwrap());

pub static TIME_HH_MM_SS: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\d{1,2}:\d{2}:\d{2}$").unwrap());

pub static TIME_WITH_MICRO: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\d{1,2}:\d{2}:\d{2}\.\d+$").unwrap());

pub static TIME_H_FORMAT: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(\d{1,2})h(\d{2})$").unwrap());

pub static TIME_DOT_FORMAT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^(\d{1,2})\.(\d{2})$").unwrap());

pub static TIME_COMPACT: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(\d{3,4})$").unwrap());

pub static COMMA_DECIMAL: Lazy<Regex> = Lazy::new(|| Regex::new(r"(-?\d+),(\d+)").unwrap());

pub static PERIOD_COMMA_MIX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(-?\d+)\.(\d*),(\d+)").unwrap());

pub static MULTI_PERIOD: Lazy<Regex> = Lazy::new(|| Regex::new(r"\.{2,}").unwrap());

pub static MULTI_COMMA: Lazy<Regex> = Lazy::new(|| Regex::new(r",{2,}").unwrap());

pub static MIXED_SEPARATORS: Lazy<Regex> = Lazy::new(|| Regex::new(r"[,.][,.]").unwrap());

pub static TRAILING_SEPARATOR: Lazy<Regex> = Lazy::new(|| Regex::new(r"[,.]$").unwrap());

pub static LEADING_SEPARATOR_AFTER_MINUS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^(-)[,.]").unwrap());

pub static EXTRACT_NUMERIC: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(-?\d+)(?:[,.](\d+))?").unwrap());

pub static NON_DIGIT_EXCEPT_MINUS: Lazy<Regex> = Lazy::new(|| Regex::new(r"[^\d-]").unwrap());

#[inline]
pub fn is_nao_informado(value: &str) -> bool {
    NAO_INFORMADO.is_match(&value.to_lowercase())
}

#[inline]
pub fn is_null_pattern(value: &str) -> bool {
    NULL_PATTERN.is_match(value)
}

#[inline]
pub fn is_whitespace_only(value: &str) -> bool {
    WHITESPACE.is_match(value)
}

#[inline]
pub fn is_excel_overflow(value: &str) -> bool {
    value == "########" || EXCEL_OVERFLOW.is_match(value)
}

#[inline]
pub fn is_brazilian_zip_code(value: &str) -> bool {
    ZIP_CODE_BR.is_match(value)
}

#[inline]
pub fn is_dash_identifier(value: &str) -> bool {
    IDENTIFIER_WITH_DASHES.is_match(value)
}

#[inline]
pub fn is_valid_integer(value: &str) -> bool {
    INTEGER.is_match(value)
}

#[inline]
pub fn is_valid_numeric(value: &str) -> bool {
    NUMERIC.is_match(value) && !value.is_empty() && value != "-" && value != "."
}

#[inline]
pub fn matches_date_pattern(value: &str) -> bool {
    DATE_ISO.is_match(value) || DATE_EU.is_match(value) || DATE_DASH.is_match(value)
}

#[inline]
pub fn matches_time_pattern(value: &str) -> bool {
    TIME_HH_MM.is_match(value) || TIME_HH_MM_SS.is_match(value) || TIME_WITH_MICRO.is_match(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_nao_informado() {
        assert!(is_nao_informado("Não informado"));
        assert!(is_nao_informado("NAO INFORMADO"));
        assert!(is_nao_informado("nao informado"));
        assert!(!is_nao_informado("informado"));
    }

    #[test]
    fn test_is_null_pattern() {
        assert!(is_null_pattern("NULL"));
        assert!(is_null_pattern("null"));
        assert!(is_null_pattern("Null"));
        assert!(is_null_pattern("NULLNULL"));
        assert!(is_null_pattern("nullnull"));
        assert!(is_null_pattern("NULLNULLNULL"));
        assert!(!is_null_pattern("NULLVALUE"));
        assert!(!is_null_pattern("VALUE"));
        assert!(!is_null_pattern(""));
    }

    #[test]
    fn test_is_whitespace_only() {
        assert!(is_whitespace_only(""));
        assert!(is_whitespace_only("   "));
        assert!(is_whitespace_only("\t\n"));
        assert!(!is_whitespace_only("a"));
    }

    #[test]
    fn test_is_excel_overflow() {
        assert!(is_excel_overflow("########"));
        assert!(is_excel_overflow("####"));
        assert!(!is_excel_overflow("#test"));
    }

    #[test]
    fn test_is_brazilian_zip_code() {
        assert!(is_brazilian_zip_code("12345-678"));
        assert!(!is_brazilian_zip_code("12345678"));
        assert!(!is_brazilian_zip_code("1234-5678"));
    }

    #[test]
    fn test_is_valid_numeric() {
        assert!(is_valid_numeric("123"));
        assert!(is_valid_numeric("-123.45"));
        assert!(is_valid_numeric("0.5"));
        assert!(!is_valid_numeric("-"));
        assert!(!is_valid_numeric("."));
        assert!(!is_valid_numeric(""));
    }

    #[test]
    fn test_matches_date_pattern() {
        assert!(matches_date_pattern("2024-01-15"));
        assert!(matches_date_pattern("15/01/2024"));
        assert!(matches_date_pattern("15-01-2024"));
        assert!(!matches_date_pattern("2024/01/15"));
    }

    #[test]
    fn test_matches_time_pattern() {
        assert!(matches_time_pattern("14:30"));
        assert!(matches_time_pattern("14:30:45"));
        assert!(matches_time_pattern("14:30:45.123456"));
        assert!(!matches_time_pattern("1430"));
    }
}
