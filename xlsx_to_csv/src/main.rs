use calamine::{open_workbook, DataType, Reader, Xlsx};
use chrono::NaiveDate;
use std::error::Error;
use std::path::Path;
use clap::{App, Arg};

fn main() -> Result<(), Box<dyn Error>> {
    // Define command-line arguments using clap
    let matches = App::new("program")
        .version("1.0")
        .author("Renan Yudi <https://github.com/Yudi>")
        .about("Converts an Excel file to CSV and optionally outputs a sample with 5 rows")
        .arg(
            Arg::new("input")
                .short('i')
                .long("input")
                .takes_value(true)
                .value_name("FILE")
                .help("Sets the input Excel file"),
        )
        .arg(
            Arg::new("output")
                .short('o')
                .long("output")
                .takes_value(true)
                .value_name("FILE")
                .help("Sets the output CSV file"),
        )
        .arg(
            Arg::new("sample")
                .short('s')
                .long("sample")
                .takes_value(false)
                .help("Indicates whether to output a sample of the data"),
        )
        .get_matches();

    // Retrieve input and output file paths
    let input_file = matches.value_of("input").unwrap_or_else(|| {
        eprintln!("Input file is required");
        std::process::exit(1);
    });
    let output_file = matches.value_of("output").unwrap_or_else(|| {
        eprintln!("Output file is required");
        std::process::exit(1);
    });

    let should_output_sample = matches.is_present("sample");

    // Convert to Path type
    let excel_path: &Path = Path::new(input_file);
    let csv_path: &Path = Path::new(output_file);
    let sample_csv_path = if should_output_sample {
        Some(Path::new(&format!("{}-sample.csv", output_file)))
    } else {
        None
    };

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

    // Create the CSV writer for full output
    let mut wtr: csv::Writer<std::fs::File> = csv::Writer::from_path(csv_path)?;

    // Create the CSV writer for the sample output if needed
    let mut sample_wtr: Option<csv::Writer<std::fs::File>> = if let Some(sample_path) = sample_csv_path {
        Some(csv::Writer::from_path(sample_path)?)
    } else {
        None
    };

    // Check if there are rows in the range
    let mut rows: calamine::Rows<'_, DataType> = range.rows();
    if let Some(headers) = rows.next() {
        // Get the column names from the header row
        let column_names: Vec<String> = headers
            .iter()
            .map(|cell: &DataType| cell.to_string())
            .collect();

        // Write the header row to both CSV files
        wtr.write_record(&column_names)?;
        if let Some(ref mut sample_writer) = sample_wtr {
            sample_writer.write_record(&column_names)?;
        }

        // Write each row from the Excel sheet to the CSV files
        let mut row_count = 0;
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
            // Write the row to the full CSV
            wtr.write_record(&row_vec)?;

            // Write the row to the sample CSV (if applicable)
            if let Some(ref mut sample_writer) = sample_wtr {
                sample_writer.write_record(&row_vec)?;
            }

            // Stop writing to the sample CSV after 5 rows
            row_count += 1;
            if should_output_sample && row_count >= 5 {
                break;
            }
        }
    } else {
        eprintln!("No rows found in the worksheet");
    }

    // Flush both writers to ensure all data is written
    wtr.flush()?;
    if let Some(ref mut sample_writer) = sample_wtr {
        sample_writer.flush()?;
    }

    Ok(())
}
