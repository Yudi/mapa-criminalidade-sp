use calamine::{open_workbook, Reader, Xlsx};
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
            .map(|cell: &calamine::DataType| cell.to_string())
            .collect();
        wtr.write_record(&row_vec)?;
    }

    // Flush the writer to ensure all data is written
    wtr.flush()?;

    Ok(())
}
