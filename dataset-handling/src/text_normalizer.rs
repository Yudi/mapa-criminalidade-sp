//! Text normalization utilities for CSV processing.
//!
//! This module provides functions for normalizing text, especially column names,
//! for database compatibility. It handles diacritic removal, case conversion,
//! and special character replacement.

use std::collections::HashSet;

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

/// Normalize a list of source headers while keeping every output name unique.
///
/// The returned indexes preserve source column positions so values remain
/// attached to the right field after normalization. Generated suffixes avoid
/// names that occur elsewhere in the same input, preventing `COD, COD, COD_2`
/// from producing two `COD_2` columns.
pub fn normalize_unique_headers(headers: &[String]) -> (Vec<String>, Vec<usize>) {
    let input_names: HashSet<String> = headers
        .iter()
        .enumerate()
        .map(|(index, header)| {
            let normalized = normalize_column_name(header);
            if normalized.is_empty() {
                format!("COLUMN_{}", index + 1)
            } else {
                normalized
            }
        })
        .collect();

    let mut used = HashSet::with_capacity(headers.len());
    let mut normalized_headers = Vec::with_capacity(headers.len());
    let mut indexes = Vec::with_capacity(headers.len());

    for (index, header) in headers.iter().enumerate() {
        let normalized = normalize_column_name(header);
        let base = if normalized.is_empty() {
            format!("COLUMN_{}", index + 1)
        } else {
            normalized
        };

        let mut candidate = base.clone();
        let mut suffix = 2_usize;
        while used.contains(&candidate)
            || (candidate != base && input_names.contains(&candidate))
        {
            candidate = format!("{}_{}", base, suffix);
            suffix += 1;
        }

        used.insert(candidate.clone());
        normalized_headers.push(candidate);
        indexes.push(index);
    }

    (normalized_headers, indexes)
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

    #[test]
    fn normalized_headers_reserve_generated_names_and_keep_positions() {
        let headers = vec![
            "COD".to_string(),
            "COD".to_string(),
            "COD_2".to_string(),
            "Código".to_string(),
            "".to_string(),
            "COLUMN 5".to_string(),
        ];

        let (normalized, indexes) = normalize_unique_headers(&headers);

        assert_eq!(
            normalized,
            ["COD", "COD_3", "COD_2", "CODIGO", "COLUMN_5", "COLUMN_5_2"]
        );
        assert_eq!(indexes, [0, 1, 2, 3, 4, 5]);
        assert_eq!(
            normalized.iter().collect::<HashSet<_>>().len(),
            normalized.len()
        );
    }

}
