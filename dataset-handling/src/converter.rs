use crate::utils::normalize_text;
use crate::{parquet_io, text_normalizer::normalize_column_name};
use calamine::{open_workbook_auto, DataType, Reader};
use chrono::NaiveDate;
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use std::error::Error;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::Arc;

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

pub fn convert_excel_to_csv(excel_path: &Path, output_dir: &Path) -> Result<(), Box<dyn Error>> {
    convert_excel(excel_path, output_dir, OutputFormat::Csv)
}

pub fn convert_excel_to_parquet(
    excel_path: &Path,
    output_dir: &Path,
) -> Result<(), Box<dyn Error>> {
    convert_excel(excel_path, output_dir, OutputFormat::Parquet)
}

pub fn convert_excel(
    excel_path: &Path,
    output_dir: &Path,
    output_format: OutputFormat,
) -> Result<(), Box<dyn Error>> {
    // Extract base filename
    let excel_filename = excel_path
        .file_stem()
        .and_then(|s: &std::ffi::OsStr| s.to_str())
        .ok_or("Invalid Excel filename")?;

    // Use Arc to share the path between threads
    let excel_path: Arc<PathBuf> = Arc::new(excel_path.to_owned());
    let output_dir: Arc<PathBuf> = Arc::new(output_dir.to_owned());

    // Open workbook once to get sheet names
    let workbook: calamine::Sheets<std::io::BufReader<File>> = open_workbook_auto(&*excel_path)?;
    let sheet_names: Vec<String> = workbook.sheet_names().to_owned();
    drop(workbook); // Drop here to reopen it safely per thread below

    // Filter out metadata sheets before processing
    let data_sheets: Vec<String> = sheet_names
        .into_iter()
        .filter(|sheet_name| is_data_sheet(sheet_name))
        .collect();

    if data_sheets.is_empty() {
        println!("No data sheets found in workbook");
        return Ok(());
    }

    println!("Found {} data sheets to process", data_sheets.len());

    // Parallel iteration over filtered data sheets only
    data_sheets.par_iter().for_each(|sheet_name| {
        let excel_path: Arc<PathBuf> = Arc::clone(&excel_path);
        let output_dir: Arc<PathBuf> = Arc::clone(&output_dir);

        // Re-open workbook for each thread (calamine's Xlsx is not Sync/Send)
        let mut workbook: calamine::Sheets<std::io::BufReader<File>> =
            match open_workbook_auto(&*excel_path) {
                Ok(wb) => wb,
                Err(e) => {
                    eprintln!("Failed to reopen workbook: {}", e);
                    return;
                }
            };

        println!("Processing data sheet: {}", sheet_name);

        let range: calamine::Range<DataType> = match workbook.worksheet_range(sheet_name) {
            Some(Ok(r)) => r,
            Some(Err(e)) => {
                eprintln!("Failed to read sheet {}: {}", sheet_name, e);
                return;
            }
            None => {
                eprintln!("Sheet {} not found", sheet_name);
                return;
            }
        };

        let mut output_path: PathBuf = PathBuf::from(&*output_dir);
        if let Err(e) = std::fs::create_dir_all(&output_path) {
            eprintln!("Failed to create output directory {:?}: {}", output_path, e);
            return;
        }

        let sanitized_sheet: String = sanitize_filename::sanitize(sheet_name);
        output_path.push(format!(
            "{}_{}.{}",
            excel_filename,
            sanitized_sheet,
            output_format.extension()
        ));

        let mut rows: calamine::Rows<'_, DataType> = range.rows();

        // Use the first non-empty row as headers
        if let Some(headers) = rows.next() {
            let column_names: Vec<String> = headers
                .iter()
                .map(|cell: &DataType| cell.to_string())
                .collect();

            let mut data_rows = Vec::new();
            for row in rows {
                if !is_data_row(row, column_names.len()) {
                    continue;
                }
                data_rows.push(extract_row_values(row, &column_names));
            }

            match output_format {
                OutputFormat::Csv => {
                    if let Err(error) =
                        write_csv_sheet(&output_path, &column_names, &data_rows)
                    {
                        eprintln!("Failed to write CSV for {}: {}", sheet_name, error);
                        return;
                    }
                }
                OutputFormat::Parquet => {
                    let (final_headers, column_indices) =
                        dedupe_normalized_headers(&column_names, &data_rows);
                    let final_rows = select_columns(&data_rows, &column_indices);
                    if let Err(error) =
                        parquet_io::write_string_rows_to_parquet(
                            &output_path,
                            &final_headers,
                            &final_rows,
                        )
                    {
                        eprintln!("Failed to write Parquet for {}: {}", sheet_name, error);
                        return;
                    }
                }
            }
        } else {
            eprintln!("No rows found in sheet {}", sheet_name);
        }

        println!(
            "Saved sheet '{}' to {}",
            sheet_name,
            output_path.display()
        );
    });

    Ok(())
}

fn write_csv_sheet(
    output_path: &Path,
    column_names: &[String],
    data_rows: &[Vec<String>],
) -> Result<(), Box<dyn Error>> {
    let mut writer: csv::Writer<File> = csv::WriterBuilder::new()
        .delimiter(b';')
        .quote_style(csv::QuoteStyle::Always)
        .from_path(output_path)?;

    writer.write_record(column_names)?;
    for row in data_rows {
        writer.write_record(row)?;
    }
    writer.flush()?;

    Ok(())
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
                cell.to_string()
            }
        }
        _ => cell.to_string(),
    }
}

fn dedupe_normalized_headers(
    headers: &[String],
    rows: &[Vec<String>],
) -> (Vec<String>, Vec<usize>) {
    let mut normalized_to_indices: HashMap<String, Vec<usize>> = HashMap::new();

    for (index, header) in headers.iter().enumerate() {
        let normalized = normalize_column_name(header).to_uppercase();
        normalized_to_indices
            .entry(normalized)
            .or_default()
            .push(index);
    }

    let mut final_headers = Vec::new();
    let mut column_indices = Vec::new();
    let mut processed_indices = HashSet::new();

    for (index, header) in headers.iter().enumerate() {
        if processed_indices.contains(&index) {
            continue;
        }

        let normalized = normalize_column_name(header);
        let upper = normalized.to_uppercase();
        let indices = normalized_to_indices.get(&upper).unwrap();

        if indices.len() == 1 {
            final_headers.push(normalized);
            column_indices.push(index);
            processed_indices.insert(index);
            continue;
        }

        let first_index = indices[0];
        let all_identical = indices[1..]
            .iter()
            .all(|other_index| columns_have_identical_data(rows, first_index, *other_index));

        if all_identical {
            println!(
                "Duplicate column \"{}\" found {} times with identical data - keeping only one",
                normalized,
                indices.len()
            );
            final_headers.push(normalized);
            column_indices.push(first_index);
            for duplicate_index in indices {
                processed_indices.insert(*duplicate_index);
            }
        } else {
            println!(
                "Duplicate column \"{}\" found with different data - keeping all with suffixes",
                normalized
            );
            final_headers.push(normalized.clone());
            column_indices.push(first_index);
            processed_indices.insert(first_index);

            for (suffix_offset, other_index) in indices[1..].iter().enumerate() {
                final_headers.push(format!("{}_{}", normalized, suffix_offset + 2));
                column_indices.push(*other_index);
                processed_indices.insert(*other_index);
            }
        }
    }

    (final_headers, column_indices)
}

fn columns_have_identical_data(rows: &[Vec<String>], left_index: usize, right_index: usize) -> bool {
    rows.iter().all(|row| {
        row.get(left_index).map(|value| value.trim()).unwrap_or("")
            == row
                .get(right_index)
                .map(|value| value.trim())
                .unwrap_or("")
    })
}

fn select_columns(rows: &[Vec<String>], column_indices: &[usize]) -> Vec<Vec<String>> {
    rows.iter()
        .map(|row| {
            column_indices
                .iter()
                .map(|column_index| row.get(*column_index).cloned().unwrap_or_default())
                .collect()
        })
        .collect()
}
