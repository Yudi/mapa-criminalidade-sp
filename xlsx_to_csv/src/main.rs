use calamine::{open_workbook, Reader, Xlsx};
use std::error::Error;
use std::path::Path;

fn main() -> Result<(), Box<dyn Error>> {
    // Define the path to the input Excel file and output CSV file
    let excel_path = Path::new("example.xlsx");
    let csv_path = Path::new("example.csv");

    // Open the Excel file
    let mut workbook: Xlsx<_> = open_workbook(excel_path)?;

    // Get the first sheet name and clone it to avoid borrowing issues
    if let Some(sheet_name) = workbook.sheet_names().first().cloned() {
        // Get the worksheet range for the first sheet
        if let Some(Ok(range)) = workbook.worksheet_range(&sheet_name) {
            // Create a CSV writer
            let mut wtr = csv::Writer::from_path(csv_path)?;

            // Write each row from the Excel sheet to the CSV file
            for row in range.rows() {
                let row_vec: Vec<String> = row.iter()
                                              .map(|cell| cell.to_string())
                                              .collect();
                wtr.write_record(&row_vec)?;
            }

            // Flush the writer to ensure all data is written
            wtr.flush()?;
        } else {
            eprintln!("Failed to read the range for sheet: {}", sheet_name);
        }
    } else {
        eprintln!("No sheets found in the workbook");
    }

    Ok(())
}
