// merger.rs
use csv::{Reader, Writer};
use std::error::Error;
use std::fs::File;
use std::path::Path;

pub fn merge_csv_files(input_paths: Vec<&Path>, output_path: &Path) -> Result<(), Box<dyn Error>> {
    if input_paths.is_empty() {
        return Err("No input files provided".into());
    }

    // Read headers from first file to use as reference
    let reference_headers: Vec<String> = get_headers(input_paths[0])?;

    // Verify all files have same headers
    for path in &input_paths[1..] {
        let headers: Vec<String> = get_headers(path)?;
        if headers != reference_headers {
            return Err(format!(
                "Headers mismatch in file {:?}. Expected: {:?}, Found: {:?}",
                path, reference_headers, headers
            )
            .into());
        }
    }

    // Create output file and write headers
    let mut writer: Writer<File> = Writer::from_path(output_path)?;
    writer.write_record(&reference_headers)?;

    // Merge content from all files
    for path in input_paths {
        let mut reader: Reader<File> = Reader::from_path(path)?;
        for result in reader.records() {
            let record: csv::StringRecord = result?;
            writer.write_record(&record)?;
        }
    }

    writer.flush()?;
    Ok(())
}

fn get_headers(path: &Path) -> Result<Vec<String>, Box<dyn Error>> {
    let mut reader: Reader<File> = Reader::from_path(path)?;
    let headers: Vec<String> = reader
        .headers()?
        .iter()
        .map(|s: &str| s.to_string())
        .collect();
    Ok(headers)
}
