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
    let range = match workbook.worksheet_range(&sheet_name) {
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

    // Check if there are rows in the range
    let mut rows: calamine::Rows<'_, DataType> = range.rows();
    if let Some(headers) = rows.next() {
        // Get the column names from the header row
        let column_names: Vec<String> = headers
            .iter()
            .map(|cell: &DataType| cell.to_string())
            .collect();

        // Write the header row to the CSV file
        wtr.write_record(&column_names)?;

        // Write each row from the Excel sheet to the CSV file
        for row in rows {
            let row_vec: Vec<String> = row
                .iter()
                .enumerate()
                .map(|(i, cell)| match cell {
                    DataType::DateTime(days) => {
                        let days_integer_part: i64 = *days as i64;
                        let days_fractional_part: f64 = *days - days_integer_part as f64;

                        if column_names[i].to_lowercase().contains("data") {
                            // Handle date values
                            if let Some(date) =
                                NaiveDate::from_ymd_opt(1899, 12, 30).and_then(|d| {
                                    d.checked_add_signed(chrono::Duration::days(days_integer_part))
                                })
                            {
                                date.format("%Y-%m-%d").to_string()
                            } else {
                                cell.to_string()
                            }
                        } else if column_names[i].to_lowercase().contains("hora") {
                            // Handle time values
                            let total_seconds: u32 =
                                (days_fractional_part * 86400.0).round() as u32;
                            let hours: u32 = total_seconds / 3600;
                            let minutes: u32 = (total_seconds % 3600) / 60;
                            let seconds: u32 = total_seconds % 60;
                            format!("{:02}:{:02}:{:02}", hours, minutes, seconds)
                        } else {
                            cell.to_string()
                        }
                    }
                    _ => cell.to_string(),
                })
                .collect();
            wtr.write_record(&row_vec)?;
        }
    } else {
        eprintln!("No rows found in the worksheet");
    }

    // Flush the writer to ensure all data is written
    wtr.flush()?;

    Ok(())
}
