/// Normalize text by removing accents, converting to lowercase, and standardizing separators
/// This function is used for consistent text comparison across the codebase
pub fn normalize_text(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            // Convert spaces to underscores for consistent comparison
            ' ' => '_',
            // Uppercase accented characters
            'Á' | 'À' | 'Ã' | 'Â' | 'Ä' => 'a',
            'É' | 'È' | 'Ê' | 'Ë' => 'e',
            'Í' | 'Ì' | 'Î' | 'Ï' => 'i',
            'Ó' | 'Ò' | 'Õ' | 'Ô' | 'Ö' => 'o',
            'Ú' | 'Ù' | 'Û' | 'Ü' => 'u',
            'Ç' => 'c',
            'Ñ' => 'n',
            // Lowercase accented characters
            'á' | 'à' | 'ã' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'õ' | 'ô' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            // Convert uppercase to lowercase for non-accented characters
            other => other.to_lowercase().next().unwrap_or(other),
        })
        .collect()
}

/// Descriptive time period patterns that indicate a value is NOT a valid time
/// Used to prevent columns with values like "DE MADRUGADA", "NOITE", etc. from being typed as TIME
const DESCRIPTIVE_TIME_PATTERNS: &[&str] = &[
    "madrugada",      // matches: de madrugada, a madrugada
    "manha",          // matches: de manha, pela manha, manhã (normalized)
    "tarde",          // matches: de tarde, a tarde, pela tarde
    "noite",          // matches: de noite, a noite, pela noite
    "durante",        // matches: durante o dia, durante a noite
    "periodo",        // matches: periodo, período (normalized)
    "descr",          // matches: descr, descricao
    "hora_incerta",   // matches: em hora incerta
    "policia",        // matches: policia federal
    "militar",        // matches: militar
    "registrado",     // matches: registrado na pf
    "nao_informado",  // matches: não informado (normalized)
    "informado",      // matches: não informado, nao informado
];

/// Check if a value contains descriptive time text patterns
/// Returns true if the value looks like descriptive text (e.g., "DE MADRUGADA") rather than a time
pub fn is_descriptive_time_text(value: &str) -> bool {
    let normalized = normalize_text(value.trim());

    for pattern in DESCRIPTIVE_TIME_PATTERNS {
        if normalized.contains(pattern) {
            return true;
        }
    }

    false
}

/// Check if a value is likely descriptive text (for HORA columns that may contain text)
/// This is a more comprehensive check that also considers the character composition
pub fn is_descriptive_text(value: &str) -> bool {
    // First check for known descriptive patterns
    if is_descriptive_time_text(value) {
        return true;
    }

    let normalized = normalize_text(value.trim());

    // If it contains common time separators, it might be time
    if normalized.contains(':') {
        return false;
    }

    // If it's mostly letters and underscores (spaces become underscores after normalization), likely descriptive
    value
        .chars()
        .filter(|c| c.is_alphabetic() || c.is_whitespace())
        .count()
        > value.len() / 2
}
