// merger.rs
use csv::{Reader, Writer};
use std::error::Error;
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::headers;

pub fn merge_csv_files(input_paths: Vec<&Path>, output_path: &Path) -> Result<(), Box<dyn Error>> {
    if input_paths.is_empty() {
        return Err("No input files provided".into());
    }

    // Read headers from first file to use as reference
    let reference_headers: Vec<String> = headers::get_headers(input_paths[0])?;

    // Verify every input against the actual first-file output header. Using
    // input_paths[1..] as the reference skips the first-vs-second check.
    headers::verify_matching_headers(&input_paths)?;
    ensure_output_is_distinct(&input_paths, output_path)?;

    let temporary_output = temporary_output_path(output_path)?;

    let result = (|| -> Result<(), Box<dyn Error>> {
        let output_file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_output)?;
        let mut writer: Writer<File> = csv::WriterBuilder::new()
            .delimiter(b';')
            .quote_style(csv::QuoteStyle::Always)
            .from_writer(output_file);
        writer.write_record(&reference_headers)?;

        // Merge content from all files.
        for path in &input_paths {
            let mut reader: Reader<File> =
                csv::ReaderBuilder::new().delimiter(b';').from_path(path)?;
            for result in reader.records() {
                let record: csv::StringRecord = result?;
                writer.write_record(&record)?;
            }
        }

        writer.flush()?;
        let output_file = writer.into_inner()?;
        output_file.sync_all()?;
        drop(output_file);
        fs::rename(&temporary_output, output_path)?;
        println!("Files merged successfully into {}", output_path.display());
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary_output);
    }
    result
}

fn ensure_output_is_distinct(
    input_paths: &[&Path],
    output_path: &Path,
) -> Result<(), Box<dyn Error>> {
    let output_identity = comparable_path(output_path)?;
    for input_path in input_paths {
        if comparable_path(input_path)? == output_identity {
            return Err(format!(
                "Output path {} must be different from every input file",
                output_path.display()
            )
            .into());
        }
    }
    Ok(())
}

fn comparable_path(path: &Path) -> Result<PathBuf, Box<dyn Error>> {
    if path.exists() {
        return Ok(fs::canonicalize(path)?);
    }

    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("Path has no file name: {}", path.display()))?;
    Ok(fs::canonicalize(parent)?.join(file_name))
}

fn temporary_output_path(output_path: &Path) -> Result<PathBuf, Box<dyn Error>> {
    let file_name = output_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid output path: {}", output_path.display()))?;
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    Ok(output_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!(".{}.{}.{}.part", file_name, std::process::id(), suffix)))
}

#[cfg(test)]
mod tests {
    use super::merge_csv_files;
    use std::fs;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_path(label: &str) -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("{}_{}.csv", label, suffix))
    }

    #[test]
    fn rejects_first_vs_second_header_mismatch_without_creating_output() {
        let first = temporary_path("merge_first");
        let second = temporary_path("merge_second");
        let output = temporary_path("merge_output");
        fs::write(&first, "A;B\nfirst;row\n").unwrap();
        fs::write(&second, "B;A\nsecond;row\n").unwrap();

        let result = merge_csv_files(vec![Path::new(&first), Path::new(&second)], &output);

        assert!(result.is_err());
        assert!(!output.exists());
        let _ = fs::remove_file(first);
        let _ = fs::remove_file(second);
        let _ = fs::remove_file(output);
    }

    #[test]
    fn merges_into_a_new_bare_output_filename() {
        let input = temporary_path("merge_bare_input");
        let output = temporary_path("merge_bare_output")
            .file_name().unwrap().to_owned();
        let output = Path::new(&output);
        fs::write(&input, "A;B\n1;2\n").unwrap();

        let result = merge_csv_files(vec![&input], output);
        let contents = fs::read_to_string(output);
        let _ = fs::remove_file(&input);
        let _ = fs::remove_file(output);

        result.unwrap();
        assert_eq!(contents.unwrap(), "\"A\";\"B\"\n\"1\";\"2\"\n");
    }

    #[test]
    fn rejects_output_aliasing_an_input() {
        let input = temporary_path("merge_alias");
        fs::write(&input, "A\nrow\n").unwrap();

        let result = merge_csv_files(vec![Path::new(&input)], &input);

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&input).unwrap(), "A\nrow\n");
        let _ = fs::remove_file(input);
    }
}
