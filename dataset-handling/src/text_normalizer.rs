//! Text normalization utilities for CSV processing.
//!
//! This module provides functions for normalizing text, especially column names,
//! for database compatibility. It handles diacritic removal, case conversion,
//! and special character replacement.

/// Mapping of accented characters to their ASCII equivalents (uppercase).
const DIACRITIC_MAP_UPPER: &[(char, char)] = &[
    // A variants
    ('À', 'A'),
    ('Á', 'A'),
    ('Â', 'A'),
    ('Ã', 'A'),
    ('Ä', 'A'),
    ('Å', 'A'),
    ('à', 'A'),
    ('á', 'A'),
    ('â', 'A'),
    ('ã', 'A'),
    ('ä', 'A'),
    ('å', 'A'),
    // E variants
    ('È', 'E'),
    ('É', 'E'),
    ('Ê', 'E'),
    ('Ë', 'E'),
    ('è', 'E'),
    ('é', 'E'),
    ('ê', 'E'),
    ('ë', 'E'),
    // I variants
    ('Ì', 'I'),
    ('Í', 'I'),
    ('Î', 'I'),
    ('Ï', 'I'),
    ('ì', 'I'),
    ('í', 'I'),
    ('î', 'I'),
    ('ï', 'I'),
    // O variants
    ('Ò', 'O'),
    ('Ó', 'O'),
    ('Ô', 'O'),
    ('Õ', 'O'),
    ('Ö', 'O'),
    ('ò', 'O'),
    ('ó', 'O'),
    ('ô', 'O'),
    ('õ', 'O'),
    ('ö', 'O'),
    // U variants
    ('Ù', 'U'),
    ('Ú', 'U'),
    ('Û', 'U'),
    ('Ü', 'U'),
    ('ù', 'U'),
    ('ú', 'U'),
    ('û', 'U'),
    ('ü', 'U'),
    // C and N variants
    ('Ç', 'C'),
    ('ç', 'C'),
    ('Ñ', 'N'),
    ('ñ', 'N'),
];

/// Remove diacritics from a character and convert to uppercase.
///
/// Returns the ASCII equivalent of accented characters, or the uppercase
/// version of non-accented characters.
#[inline]
pub fn remove_diacritic_upper(c: char) -> char {
    for &(from, to) in DIACRITIC_MAP_UPPER {
        if c == from {
            return to;
        }
    }
    c.to_ascii_uppercase()
}

/// Normalize a column name for database compatibility.
///
/// This function performs the following transformations:
/// 1. Removes diacritics/accents (e.g., É → E, ã → A)
/// 2. Converts to uppercase
/// 3. Replaces whitespace with underscores
/// 4. Removes non-alphanumeric characters (except underscores)
/// 5. Collapses multiple consecutive underscores
/// 6. Removes leading/trailing underscores
///
/// This matches the behavior of the NestJS StringUtils.normalizeColumnName function.
///
/// # Examples
///
/// ```
/// use dataset_handling::text_normalizer::normalize_column_name;
///
/// assert_eq!(normalize_column_name("MÊS ESTATÍSTICA"), "MES_ESTATISTICA");
/// assert_eq!(normalize_column_name("número__id"), "NUMERO_ID");
/// ```
pub fn normalize_column_name(name: &str) -> String {
    let normalized: String = name
        .chars()
        .map(|c| {
            if c.is_ascii() {
                c.to_ascii_uppercase()
            } else {
                remove_diacritic_upper(c)
            }
        })
        .collect();
    normalized
        .trim()
        .replace(char::is_whitespace, "_")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect::<String>()
        .split('_')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("_")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_column_name() {
        assert_eq!(normalize_column_name("MÊS ESTATISTICA"), "MES_ESTATISTICA");
        assert_eq!(
            normalize_column_name("NÚMERO LOGRADOURO"),
            "NUMERO_LOGRADOURO"
        );
        assert_eq!(normalize_column_name("ID_DELEGACIA"), "ID_DELEGACIA");
        assert_eq!(normalize_column_name("ano"), "ANO");
        assert_eq!(
            normalize_column_name("  múltiplas   espaços  "),
            "MULTIPLAS_ESPACOS"
        );
        assert_eq!(
            normalize_column_name("coluna@#$%especial"),
            "COLUNAESPECIAL"
        );
    }

    #[test]
    fn test_remove_diacritic_upper() {
        assert_eq!(remove_diacritic_upper('É'), 'E');
        assert_eq!(remove_diacritic_upper('ã'), 'A');
        assert_eq!(remove_diacritic_upper('ç'), 'C');
        assert_eq!(remove_diacritic_upper('a'), 'A');
    }

}
