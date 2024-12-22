// headers.rs
use csv::Reader;
use std::error::Error;
use std::fs::File;
use std::path::Path;

pub fn verify_matching_headers(paths: &[&Path]) -> Result<(), Box<dyn Error>> {
    if paths.is_empty() {
        return Ok(());
    }

    // Get reference headers from first file
    let reference_headers = get_headers(&paths[0])?;

    // Compare remaining files
    for path in &paths[1..] {
        let headers = get_headers(path)?;
        if headers != reference_headers {
            return Err(format!(
                "Headers mismatch in file {:?}. Expected: {:?}, Found: {:?}",
                path, reference_headers, headers
            )
            .into());
        }
    }
    Ok(())
}

pub fn get_headers(path: &Path) -> Result<Vec<String>, Box<dyn Error>> {
    let mut reader: Reader<File> = Reader::from_path(path)?;
    let headers: Vec<String> = reader
        .headers()?
        .iter()
        .map(|s: &str| s.to_string())
        .collect();
    Ok(headers)
}
