// src/sampler.rs
use csv::{Reader, Writer};
use std::error::Error;
use std::path::Path;

pub fn sample_csv(input_path: &Path, output_path: &Path) -> Result<(), Box<dyn Error>> {
    let mut reader: Reader<std::fs::File> = Reader::from_path(input_path)?;
    let mut writer: Writer<std::fs::File> = Writer::from_path(output_path)?;

    // Write headers
    let headers: &csv::StringRecord = reader.headers()?;
    writer.write_record(headers)?;

    // Write first 5 rows
    for (i, result) in reader.records().enumerate() {
        if i >= 5 {
            break;
        }
        let record: csv::StringRecord = result?;
        writer.write_record(&record)?;
    }

    writer.flush()?;
    Ok(())
}
