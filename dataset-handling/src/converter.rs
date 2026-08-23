use crate::utils::normalize_text;
use crate::{parquet_io, text_normalizer::normalize_column_name};
use calamine::{open_workbook_auto, DataType, Reader};
use chrono::NaiveDate;
use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
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
        if normalized_name.contains(&normalized_metadata_name) {
            println!(
                "Skipping metadata sheet: {} as it contains '{}'",
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

fn normalize_blank_headers(headers: &[String]) -> Vec<String> {
    let mut seen = HashMap::<String, usize>::new();
    headers
        .iter()
        .enumerate()
        .map(|(index, header)| {
            let base = if header.trim().is_empty() {
                format!("column_{}", index + 1)
            } else {
                header.trim().to_string()
            };
            let count = seen.entry(base.clone()).or_insert(0);
            *count += 1;
            if *count == 1 {
                base
            } else {
                format!("{}_{}", base, count)
            }
        })
        .collect()
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
    input_path: String,
    format: String,
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

        let mut rows: calamine::Rows<'_, DataType> = range.rows();
        let headers = rows
            .find(|row| is_data_row(row, 0))
            .ok_or_else(|| format!("No header row found in sheet {}", sheet_name))?;
        let column_names = normalize_blank_headers(
            &headers
                .iter()
                .map(|cell: &DataType| cell.to_string())
                .collect::<Vec<_>>(),
        );
        if column_names.is_empty() {
            return Err(format!("Sheet {} has no columns", sheet_name));
        }

        let row_iterator = rows.filter(|row| is_data_row(row, column_names.len()));
        let value_iterator = row_iterator.map(|row| extract_row_values(row, &column_names));
        let rows_written = match output_format {
            OutputFormat::Csv => write_csv_sheet(&output_path, &column_names, value_iterator)
                .map_err(|error| error.to_string())?,
            OutputFormat::Parquet => {
                let (final_headers, column_indices) = dedupe_normalized_headers(&column_names);
                let selected_rows = value_iterator.map(|row| {
                    column_indices
                        .iter()
                        .map(|column_index| row.get(*column_index).cloned().unwrap_or_default())
                        .collect::<Vec<_>>()
                });
                let temporary_path = output_path.with_extension(format!(
                    "{}.{}.part",
                    OutputFormat::Parquet.extension(),
                    std::process::id()
                ));
                let rows_written = parquet_io::write_string_rows_to_parquet_iter(
                    &temporary_path,
                    &final_headers,
                    selected_rows,
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
        input_path: excel_path.display().to_string(),
        format: output_format.extension().to_string(),
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

fn dedupe_normalized_headers(headers: &[String]) -> (Vec<String>, Vec<usize>) {
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut final_headers = Vec::new();
    let mut column_indices = Vec::new();

    for (index, header) in headers.iter().enumerate() {
        let normalized = normalize_column_name(header);
        let count = seen.entry(normalized.clone()).or_insert(0);
        *count += 1;
        final_headers.push(if *count == 1 {
            normalized
        } else {
            format!("{}_{}", normalized, count)
        });
        column_indices.push(index);
    }

    (final_headers, column_indices)
}

#[cfg(test)]
mod tests {
    use super::escape_csv_formula_value;

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
}
