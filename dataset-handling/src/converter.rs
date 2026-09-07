use crate::utils::normalize_text;
use crate::{
    parquet_io,
    text_normalizer::normalize_unique_headers,
};
use calamine::{open_workbook_auto, DataType, Reader};
use chrono::NaiveDate;
use rayon::prelude::*;
use serde::Serialize;
use std::error::Error;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    Csv,
    Parquet,
}

impl OutputFormat {
    pub fn extension(self) -> &'static str {
        match self {
            OutputFormat::Csv => "csv",
            OutputFormat::Parquet => "parquet",
        }
    }
}

/// Check if a sheet name indicates it contains data rather than metadata
fn is_data_sheet(sheet_name: &str) -> bool {
    let normalized_name = normalize_text(sheet_name.trim());

    println!(
        "Checking sheet: '{}' -> normalized: '{}'",
        sheet_name, normalized_name
    );

    // Skip sheets that are known metadata sheets
    let metadata_sheet_names = [
        "metodologia",
        "dicionario de dados",
        "dicionario",
        "campos da tabela",
        "campos",
        "tabela",
    ];

    for metadata_name in &metadata_sheet_names {
        let normalized_metadata_name = normalize_text(metadata_name);
        let suffix = normalized_name.strip_prefix(&normalized_metadata_name);
        if suffix
            .map(|value| value.is_empty() || value.starts_with('_') || value.starts_with('-'))
            .unwrap_or(false)
        {
            println!(
                "Skipping metadata sheet: {} as it matches '{}' metadata",
                sheet_name, metadata_name
            );
            return false;
        }
    }

    // Accept all other sheets as data sheets
    println!("Processing data sheet: {}", sheet_name);
    true
}

/// Check if a row contains actual data (just basic empty row filtering)
fn is_data_row(row: &[DataType], _column_count: usize) -> bool {
    // Only skip completely empty rows
    !row.is_empty() && row.iter().any(|cell| !cell.to_string().trim().is_empty())
}

const MAX_HEADER_CANDIDATE_ROWS: usize = 25;
const MIN_HEADER_SIGNAL_COUNT: usize = 2;

/// Find a useful schema row without assuming every workbook has the same
/// number of title/banner rows. Generic workbooks retain the historical first
/// non-empty row behavior; a later row wins only when it has several
/// recognizable data-field labels.
fn find_header_row(
    range: &calamine::Range<DataType>,
) -> Result<(usize, Vec<String>), String> {
    let mut first_non_empty: Option<Vec<String>> = None;
    let mut best_candidate: Option<(usize, usize, Vec<String>)> = None;
    let mut ambiguous_best_candidate = false;

    for (row_index, row) in range.rows().enumerate().take(MAX_HEADER_CANDIDATE_ROWS) {
        if !is_data_row(row, 0) {
            continue;
        }

        let raw_headers = row.iter().map(DataType::to_string).collect::<Vec<_>>();
        let (normalized_headers, _) = normalize_unique_headers(&raw_headers);
        if normalized_headers.is_empty() {
            continue;
        }

        if first_non_empty.is_none() {
            first_non_empty = Some(normalized_headers.clone());
        }

        let signal_count = normalized_headers
            .iter()
            .filter(|header| is_header_signal(header))
            .count();
        match best_candidate.as_ref() {
            None => best_candidate = Some((row_index, signal_count, normalized_headers)),
            Some((_, best_score, _)) if signal_count > *best_score => {
                best_candidate = Some((row_index, signal_count, normalized_headers));
                ambiguous_best_candidate = false;
            }
            Some((_, best_score, _))
                if signal_count == *best_score && signal_count >= MIN_HEADER_SIGNAL_COUNT =>
            {
                ambiguous_best_candidate = true;
            }
            _ => {}
        }
    }

    if let Some((header_index, signal_count, headers)) = best_candidate.as_ref() {
        if *signal_count >= MIN_HEADER_SIGNAL_COUNT {
            if ambiguous_best_candidate {
                return Err("Ambiguous header rows matched the source-field signals".to_string());
            }
            return Ok((*header_index, headers.clone()));
        }
    }

    first_non_empty
        .map(|headers| {
            let header_index = range
                .rows()
                .enumerate()
                .take(MAX_HEADER_CANDIDATE_ROWS)
                .find_map(|(index, row)| is_data_row(row, 0).then_some(index))
                .unwrap_or_default();
            (header_index, headers)
        })
        .ok_or_else(|| "No header row found in sheet".to_string())
}

fn is_header_signal(header: &str) -> bool {
    const SIGNALS: [&str; 14] = [
        "BO",
        "NUM",
        "NUMERO",
        "ANO",
        "DATA",
        "LAT",
        "LATITUDE",
        "LON",
        "LONG",
        "LONGITUDE",
        "DELEGACIA",
        "MUNICIPIO",
        "CEP",
        "ID",
    ];

    SIGNALS.iter().any(|signal| {
        header == *signal
            || header.starts_with(&format!("{}_", signal))
            || header.ends_with(&format!("_{}", signal))
    })
}

#[derive(Debug, Serialize)]
struct SheetConversionReport {
    sheet: String,
    rows: usize,
    columns: usize,
    output_path: String,
}

#[derive(Debug, Serialize)]
struct SheetConversionFailure {
    sheet: String,
    error: String,
}

#[derive(Debug, Serialize)]
struct ConversionManifest {
    manifest_version: u8,
    input_path: String,
    format: String,
    complete: bool,
    sheets: Vec<SheetConversionReport>,
    skipped_sheets: Vec<SheetConversionFailure>,
}

pub fn convert_excel(
    excel_path: &Path,
    output_dir: &Path,
    output_format: OutputFormat,
    selected_sheet: Option<&str>,
) -> Result<(), Box<dyn Error>> {
    // Extract base filename
    let excel_filename = excel_path
        .file_stem()
        .and_then(|s: &std::ffi::OsStr| s.to_str())
        .ok_or("Invalid Excel filename")?;

    fs::create_dir_all(output_dir)?;

    // Use Arc to share the path between threads
    let excel_path: Arc<PathBuf> = Arc::new(excel_path.to_owned());
    let output_dir: Arc<PathBuf> = Arc::new(output_dir.to_owned());

    // Open workbook once to get sheet names
    let workbook: calamine::Sheets<std::io::BufReader<File>> = open_workbook_auto(&*excel_path)?;
    let sheet_names: Vec<String> = workbook.sheet_names().to_owned();
    drop(workbook); // Drop here to reopen it safely per thread below

    let data_sheets: Vec<String> = if let Some(selected_sheet) = selected_sheet {
        if !sheet_names.iter().any(|name| name == selected_sheet) {
            return Err(format!("Selected sheet '{}' was not found", selected_sheet).into());
        }
        if !is_data_sheet(selected_sheet) {
            return Err(format!("Selected sheet '{}' is not a data sheet", selected_sheet).into());
        }
        vec![selected_sheet.to_string()]
    } else {
        sheet_names
            .into_iter()
            .filter(|sheet_name| is_data_sheet(sheet_name))
            .collect()
    };

    if data_sheets.is_empty() {
        return Err("No eligible data sheets found in workbook".into());
    }

    println!("Found {} data sheets to process", data_sheets.len());

    let sheet_results: Vec<Result<SheetConversionReport, String>> = data_sheets
        .par_iter()
        .map(|sheet_name| {
        let excel_path: Arc<PathBuf> = Arc::clone(&excel_path);
        let output_dir: Arc<PathBuf> = Arc::clone(&output_dir);

        // Re-open workbook for each thread (calamine's Xlsx is not Sync/Send)
        let mut workbook: calamine::Sheets<std::io::BufReader<File>> =
            match open_workbook_auto(&*excel_path) {
                Ok(wb) => wb,
                Err(e) => {
                    return Err(format!("Failed to reopen workbook: {}", e));
                }
            };

        println!("Processing data sheet: {}", sheet_name);

        let range: calamine::Range<DataType> = match workbook.worksheet_range(sheet_name) {
            Some(Ok(r)) => r,
            Some(Err(e)) => {
                return Err(format!("Failed to read sheet {}: {}", sheet_name, e));
            }
            None => {
                return Err(format!("Sheet {} not found", sheet_name));
            }
        };

        let mut output_path: PathBuf = PathBuf::from(&*output_dir);

        let sanitized_sheet: String = sanitize_filename::sanitize(sheet_name);
        output_path.push(format!(
            "{}_{}.{}",
            excel_filename,
            sanitized_sheet,
            output_format.extension()
        ));

        let (header_index, column_names) =
            find_header_row(&range).map_err(|error| format!("{}: {}", sheet_name, error))?;
        if column_names.is_empty() {
            return Err(format!("Sheet {} has no columns", sheet_name));
        }

        let column_count = column_names.len();
        let row_iterator = range
            .rows()
            .enumerate()
            .filter(move |(index, row)| *index > header_index && is_data_row(row, column_count))
            .map(|(_, row)| row);
        let value_iterator = row_iterator.map(|row| extract_row_values(row, &column_names));
        let rows_written = match output_format {
            OutputFormat::Csv => write_csv_sheet(&output_path, &column_names, value_iterator)
                .map_err(|error| error.to_string())?,
            OutputFormat::Parquet => {
                let temporary_path = output_path.with_extension(format!(
                    "{}.{}.part",
                    OutputFormat::Parquet.extension(),
                    std::process::id()
                ));
                let rows_written = parquet_io::write_string_rows_to_parquet_iter(
                    &temporary_path,
                    &column_names,
                    value_iterator,
                )
                .map_err(|error| error.to_string())?;
                fs::rename(temporary_path, &output_path)
                    .map_err(|error| error.to_string())?;
                rows_written
            }
        };

        println!(
            "Saved sheet '{}' to {}",
            sheet_name,
            output_path.display()
        );
        Ok(SheetConversionReport {
            sheet: sheet_name.clone(),
            rows: rows_written,
            columns: column_names.len(),
            output_path: output_path.display().to_string(),
        })
    })
    .collect();

    let mut reports = Vec::new();
    let mut skipped_sheets = Vec::new();
    for (sheet_name, result) in data_sheets.iter().zip(sheet_results) {
        match result {
            Ok(report) => reports.push(report),
            Err(error) => skipped_sheets.push(SheetConversionFailure {
                sheet: sheet_name.clone(),
                error,
            }),
        }
    }
    cleanup_partial_outputs(&output_dir, excel_filename);

    if reports.is_empty() {
        let details = skipped_sheets
            .iter()
            .map(|failure| format!("{}: {}", failure.sheet, failure.error))
            .collect::<Vec<_>>()
            .join("; ");
        return Err(format!("No workbook sheets could be converted: {}", details).into());
    }
    if !skipped_sheets.is_empty() {
        for failure in &skipped_sheets {
            eprintln!(
                "Skipping unreadable external sheet '{}': {}",
                failure.sheet, failure.error
            );
        }
    }

    let manifest_path = output_dir.join(format!("{}_manifest.json", excel_filename));
    let temporary_manifest = output_dir.join(format!(
        "{}_manifest.{}.{}.part",
        excel_filename,
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default()
    ));
    let manifest = serde_json::to_vec_pretty(&ConversionManifest {
        manifest_version: 1,
        input_path: excel_path.display().to_string(),
        format: output_format.extension().to_string(),
        complete: skipped_sheets.is_empty(),
        sheets: reports,
        skipped_sheets,
    })?;
    {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_manifest)?;
        file.write_all(&manifest)?;
        file.sync_all()?;
    }
    fs::rename(temporary_manifest, manifest_path)?;

    Ok(())
}

fn cleanup_partial_outputs(output_dir: &Path, excel_filename: &str) {
    let Ok(entries) = fs::read_dir(output_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|value| value.to_str()).unwrap_or_default();
        if name.starts_with(excel_filename) && name.ends_with(".part") {
            let _ = fs::remove_file(path);
        }
    }
}

fn write_csv_sheet<I>(
    output_path: &Path,
    column_names: &[String],
    data_rows: I,
) -> Result<usize, Box<dyn Error>>
where
    I: IntoIterator<Item = Vec<String>>,
{
    let temporary_path = output_path.with_extension(format!(
        "{}.{}.part",
        OutputFormat::Csv.extension(),
        std::process::id()
    ));
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary_path)?;
    let mut writer: csv::Writer<File> = csv::WriterBuilder::new()
        .delimiter(b';')
        .quote_style(csv::QuoteStyle::Always)
        .from_writer(file);

    let escaped_column_names: Vec<String> = column_names
        .iter()
        .map(|value| escape_csv_formula_value(value))
        .collect();
    writer.write_record(&escaped_column_names)?;

    let mut rows_written = 0;
    for row in data_rows {
        let escaped_row: Vec<String> = row
            .iter()
            .map(|value| escape_csv_formula_value(value))
            .collect();
        writer.write_record(&escaped_row)?;
        rows_written += 1;
    }
    writer.flush()?;
    let file = writer.into_inner()?;
    file.sync_all()?;
    drop(file);
    fs::rename(temporary_path, output_path)?;

    Ok(rows_written)
}

fn escape_csv_formula_value(value: &str) -> String {
    let first_meaningful_character = value.trim_start().chars().next();

    let is_signed_number = value.trim().parse::<f64>().is_ok();
    if matches!(first_meaningful_character, Some('=' | '@'))
        || (matches!(first_meaningful_character, Some('+' | '-')) && !is_signed_number)
    {
        format!("'{}", value)
    } else {
        value.to_string()
    }
}

fn extract_row_values(row: &[DataType], column_names: &[String]) -> Vec<String> {
    (0..column_names.len())
        .map(|column_index| {
            let cell_str = row
                .get(column_index)
                .map(|cell| cell_to_string(cell, &column_names[column_index]))
                .unwrap_or_default();

            if cell_str.trim().to_uppercase() == "NULL" {
                String::new()
            } else {
                cell_str
            }
        })
        .collect()
}

fn cell_to_string(cell: &DataType, column_name: &str) -> String {
    match cell {
        DataType::DateTime(days) => {
            let days_integer_part: i64 = *days as i64;
            let days_fractional_part: f64 = *days - days_integer_part as f64;
            let normalized_column = column_name.to_lowercase();

            if normalized_column.contains("data") {
                if let Some(date) = NaiveDate::from_ymd_opt(1899, 12, 30).and_then(
                    |date: NaiveDate| {
                        date.checked_add_signed(chrono::Duration::days(days_integer_part))
                    },
                ) {
                    date.format("%Y-%m-%d").to_string()
                } else {
                    cell.to_string()
                }
            } else if normalized_column.contains("hora") {
                let total_seconds: u32 = (days_fractional_part * 86400.0).round() as u32;
                let hours: u32 = total_seconds / 3600;
                let minutes: u32 = (total_seconds % 3600) / 60;
                let seconds: u32 = total_seconds % 60;
                format!("{:02}:{:02}:{:02}", hours, minutes, seconds)
            } else {
                let date = NaiveDate::from_ymd_opt(1899, 12, 30)
                    .and_then(|date| {
                        date.checked_add_signed(chrono::Duration::days(days_integer_part))
                    });
                match date {
                    Some(date) if days_fractional_part > 0.0 => {
                        let total_seconds = (days_fractional_part * 86_400.0).round() as u32;
                        format!(
                            "{} {:02}:{:02}:{:02}",
                            date.format("%Y-%m-%d"),
                            total_seconds / 3600,
                            (total_seconds % 3600) / 60,
                            total_seconds % 60
                        )
                    }
                    Some(date) => date.format("%Y-%m-%d").to_string(),
                    None => cell.to_string(),
                }
            }
        }
        _ => cell.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{escape_csv_formula_value, find_header_row, is_data_sheet};
    use calamine::{Cell, DataType, Range};

    #[test]
    fn escapes_values_that_spreadsheets_can_interpret_as_formulas() {
        for dangerous_value in ["=2+3", "+2+3", "-10+20", "@A1"] {
            assert_eq!(
                escape_csv_formula_value(dangerous_value),
                format!("'{}", dangerous_value)
            );
        }
    }

    #[test]
    fn escapes_formula_values_after_leading_whitespace() {
        assert_eq!(escape_csv_formula_value("  =2+3"), "'  =2+3");
    }

    #[test]
    fn preserves_regular_values() {
        for safe_value in ["normal", "1+1", "", " NULL "] {
            assert_eq!(escape_csv_formula_value(safe_value), safe_value);
        }
    }

    #[test]
    fn recognizes_data_tab_named_tabela1() {
        assert!(is_data_sheet("Tabela1"));
        assert!(!is_data_sheet("Tabela"));
        assert!(is_data_sheet("TabelaDados"));
        assert!(!is_data_sheet("Campos da Tabela - MDIP"));
        assert!(!is_data_sheet("Campos da Tabela - Dados Criminais"));
        assert!(!is_data_sheet("Tabela - MDIP"));
    }

    #[test]
    fn skips_banner_rows_when_a_structured_header_follows() {
        let range = Range::from_sparse(vec![
            Cell::new(
                (0, 0),
                DataType::String("Boletim de ocorrências".to_string()),
            ),
            Cell::new((2, 0), DataType::String("NUM_BO".to_string())),
            Cell::new(
                (2, 1),
                DataType::String("DATA_OCORRENCIA".to_string()),
            ),
            Cell::new((2, 2), DataType::String("LATITUDE".to_string())),
            Cell::new((2, 3), DataType::String("LONGITUDE".to_string())),
            Cell::new((3, 0), DataType::String("123".to_string())),
            Cell::new((3, 1), DataType::String("2024-01-01".to_string())),
            Cell::new((3, 2), DataType::String("-23.5".to_string())),
            Cell::new((3, 3), DataType::String("-46.6".to_string())),
        ]);

        assert_eq!(
            find_header_row(&range).unwrap(),
            (2, vec![
                "NUM_BO".to_string(),
                "DATA_OCORRENCIA".to_string(),
                "LATITUDE".to_string(),
                "LONGITUDE".to_string(),
            ])
        );
    }

    #[test]
    fn manifest_marks_partial_conversion_incomplete() {
        let manifest = serde_json::to_value(super::ConversionManifest {
            manifest_version: 1,
            input_path: "source.xlsx".to_string(),
            format: "parquet".to_string(),
            complete: false,
            sheets: vec![super::SheetConversionReport {
                sheet: "A".to_string(),
                rows: 1,
                columns: 2,
                output_path: "source_A.parquet".to_string(),
            }],
            skipped_sheets: vec![super::SheetConversionFailure {
                sheet: "B".to_string(),
                error: "read error".to_string(),
            }],
        })
        .unwrap();

        assert_eq!(manifest["manifest_version"], 1);
        assert_eq!(manifest["complete"], false);
        assert_eq!(manifest["sheets"].as_array().unwrap().len(), 1);
        assert_eq!(manifest["skipped_sheets"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn rejects_ambiguous_structured_header_rows() {
        let range = Range::from_sparse(vec![
            Cell::new((0, 0), DataType::String("NUM_BO".to_string())),
            Cell::new((0, 1), DataType::String("DATA_FATO".to_string())),
            Cell::new((2, 0), DataType::String("NUM_BO".to_string())),
            Cell::new((2, 1), DataType::String("DATA_FATO".to_string())),
        ]);

        assert!(find_header_row(&range).is_err());
    }
}
