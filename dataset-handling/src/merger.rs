// merger.rs
use csv::{Reader, Writer};
use std::error::Error;
use std::fs::File;
use std::path::Path;

use crate::headers;

pub fn merge_csv_files(input_paths: Vec<&Path>, output_path: &Path) -> Result<(), Box<dyn Error>> {
    if input_paths.is_empty() {
        return Err("No input files provided".into());
    }

    // Read headers from first file to use as reference
    let reference_headers: Vec<String> = headers::get_headers(input_paths[0])?;

    // Verify all files have same headers
    headers::verify_matching_headers(&input_paths[1..])?;

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
