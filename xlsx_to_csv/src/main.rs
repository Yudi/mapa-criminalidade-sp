use calamine::{open_workbook, DataType, Reader, Xlsx};
use chrono::NaiveDate;
use std::error::Error;
use std::path::Path;

fn main() -> Result<(), Box<dyn Error>> {
    // Define the path to the input Excel file and output CSV file
    let excel_path: &Path = Path::new("example.xlsx");
    let csv_path: &Path = Path::new("example.csv");

    // Open the Excel file
    let mut workbook: Xlsx<_> = open_workbook(excel_path)?;

    // Get the first sheet name
    let sheet_name: String = match workbook.sheet_names().first() {
        Some(name) => name.to_string(),
        None => {
            eprintln!("No sheets found in the workbook");
            return Ok(());
        }
    };

    // Get the worksheet range for the first sheet
    let range: calamine::Range<calamine::DataType> = match workbook.worksheet_range(&sheet_name) {
        Some(Ok(r)) => r,
        Some(Err(e)) => {
            eprintln!("Failed to read the range for sheet {}: {}", sheet_name, e);
            return Ok(());
        }
        None => {
            eprintln!("Sheet {} not found", sheet_name);
            return Ok(());
        }
    };

    // Create a CSV writer
    let mut wtr: csv::Writer<std::fs::File> = csv::Writer::from_path(csv_path)?;

    // Write each row from the Excel sheet to the CSV file
    for row in range.rows() {
        let row_vec: Vec<String> = row
            .iter()
            .map(|cell: &DataType| match cell {
                DataType::DateTime(days) => {
                    let days_integer_part: i64 = *days as i64;
                    let days_fractional_part: f64 = *days - days_integer_part as f64;

                    if days_integer_part == 0 && days_fractional_part > 0.0 {
                        // Handle time-only values
                        let total_seconds = (days_fractional_part * 86400.0).round() as u32;
                        let hours: u32 = total_seconds / 3600;
                        let minutes: u32 = (total_seconds % 3600) / 60;
                        let seconds: u32 = total_seconds % 60;
                        format!("{:02}:{:02}:{:02}", hours, minutes, seconds)
                    } else {
                        // Handle date or datetime values
                        if let Some(date) =
                            NaiveDate::from_ymd_opt(1899, 12, 30).and_then(|d: NaiveDate| {
                                d.checked_add_signed(chrono::Duration::days(days_integer_part))
                            })
                        {
                            if days_fractional_part == 0.0 {
                                date.format("%Y/%m/%d").to_string()
                            } else {
                                let total_seconds = (days_fractional_part * 86400.0).round() as u32;
                                let hours: u32 = total_seconds / 3600;
                                let minutes: u32 = (total_seconds % 3600) / 60;
                                let seconds: u32 = total_seconds % 60;
                                format!(
                                    "{} {:02}:{:02}:{:02}",
                                    date.format("%Y/%m/%d"),
                                    hours,
                                    minutes,
                                    seconds
                                )
                            }
                        } else {
                            cell.to_string()
                        }
                    }
                }
                _ => cell.to_string(),
            })
            .collect();
        wtr.write_record(&row_vec)?;
    }

    // Flush the writer to ensure all data is written
    wtr.flush()?;

    Ok(())
}
