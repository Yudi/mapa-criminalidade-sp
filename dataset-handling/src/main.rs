//! Dataset handling CLI tool for CSV analysis and cleaning.
//!
//! This tool provides commands for analyzing tabular files, converting Excel files,
//! merging CSVs, and preparing data for PostgreSQL import.

use clap::{Parser, Subcommand};
use std::error::Error;
use std::path::Path;

// Core modules
mod analyzer;
mod cleaner;
mod converter;
mod headers;
mod logger;
mod merger;
mod parallelism;
mod parquet_io;
mod parquet_postgres;
mod sampler;
mod utils;

// New modular components
mod date_time;
mod patterns;
mod text_normalizer;
mod type_inference;
mod types;
mod value_cleaners;

// Re-export commonly used types for external use
pub use types::{ColumnAnalysis, CsvAnalysis, IntegerRange, NumericStats};

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug, Clone)]
enum Commands {
    /// Analyze a CSV or Parquet file and determine optimal PostgreSQL column types
    Analyze(AnalyzeArgs),
    /// Convert an Excel file to CSV or Parquet. Each sheet will be converted to a separate file.
    Convert(ConvertArgs),
    /// Merge multiple CSV files into one CSV. Headers must match.
    Merge(MergeArgs),
    /// Create a new CSV file with the first 5 rows of another CSV file
    Sample(SampleArgs),
    /// Clean and prepare CSV data for database import (handle malformed values, Excel errors)
    Prepare(PrepareArgs),
    /// Stream Parquet files into PostgreSQL using COPY FROM STDIN
    ImportParquet(ImportParquetArgs),
}

#[derive(Parser, Debug, Clone)]
struct AnalyzeArgs {
    /// Input CSV or Parquet file path
    #[arg(short, long)]
    input: String,

    /// Output JSON file path for analysis results
    #[arg(short, long)]
    output: Option<String>,

    /// Maximum sample values per column to display in output (for reference only, not used for type detection)
    #[arg(long, default_value = "10")]
    max_samples: usize,

    /// Enable parallel processing for large datasets
    #[arg(long, default_value = "true")]
    parallel: bool,

    /// Chunk size for parallel processing
    #[arg(long, default_value = "10000")]
    chunk_size: usize,

    /// Silent mode - output only JSON result without progress messages
    #[arg(long, default_value = "false")]
    silent: bool,
}

#[derive(Parser, Debug, Clone)]
struct ConvertArgs {
    /// Input Excel file path
    #[arg(short, long)]
    input: String,

    /// Output directory path
    #[arg(short, long)]
    output: String,

    /// Sheet name. If not provided, the first sheet is used.
    #[arg(short, long)]
    sheet: Option<String>,

    /// Output format for generated sheet files
    #[arg(long, default_value = "csv", value_parser = ["csv", "parquet"])]
    format: String,
}

#[derive(Parser, Debug, Clone)]
struct MergeArgs {
    /// Input CSV file paths
    #[arg(short, long, num_args = 1.., required = true)]
    inputs: Vec<String>,

    /// Output CSV file path
    #[arg(short, long)]
    output: String,
}

#[derive(Parser, Debug, Clone)]
struct SampleArgs {
    /// Input CSV file path
    #[arg(short, long)]
    input: String,

    /// Output CSV file path
    #[arg(short, long)]
    output: String,
}

#[derive(Parser, Debug, Clone)]
struct PrepareArgs {
    /// Input CSV file path
    #[arg(short, long)]
    input: String,

    /// Output cleaned CSV file path
    #[arg(short, long)]
    output: String,

    /// Column types JSON file (from analyze command) - optional if db-types is provided
    #[arg(short, long)]
    types: Option<String>,

    /// Database column types as JSON string (column_name:data_type pairs)
    #[arg(long)]
    db_types: Option<String>,

    /// Silent mode - output only errors
    #[arg(long, default_value = "false")]
    silent: bool,
}

#[derive(Parser, Debug, Clone)]
struct ImportParquetArgs {
    /// Input Parquet file paths
    #[arg(short, long, num_args = 1.., required = true)]
    inputs: Vec<String>,

    /// PostgreSQL connection string. Falls back to DATABASE_URL when omitted.
    #[arg(long)]
    connection: Option<String>,

    /// PostgreSQL schema containing the target table
    #[arg(long, default_value = "raw")]
    schema: String,

    /// Target table name
    #[arg(long)]
    table: String,

    /// Column type overrides as a JSON object of column_name:data_type pairs
    #[arg(long)]
    column_type_overrides: Option<String>,

    /// Truncate the target table before importing, inside the same transaction
    #[arg(long, default_value = "true")]
    truncate: bool,

    /// Silent mode - output only JSON result without progress messages
    #[arg(long, default_value = "false")]
    silent: bool,
}

fn main() -> Result<(), Box<dyn Error>> {
    parallelism::configure_global_thread_pool()?;

    let args: Args = Args::parse();

    match args.command {
        Commands::Analyze(analyze_args) => run_analyze(analyze_args),
        Commands::Convert(convert_args) => run_convert(convert_args),
        Commands::Merge(merge_args) => run_merge(merge_args),
        Commands::Sample(sample_args) => run_sample(sample_args),
        Commands::Prepare(prepare_args) => run_prepare(prepare_args),
        Commands::ImportParquet(import_args) => run_import_parquet(import_args),
    }
}

fn run_analyze(args: AnalyzeArgs) -> Result<(), Box<dyn Error>> {
    let logger = logger::Logger::new(args.silent);

    let analyzer = analyzer::CsvAnalyzer::with_settings(
        args.max_samples,
        args.chunk_size,
        args.parallel,
        logger,
    );

    let analysis = if is_parquet_path(&args.input) {
        analyzer.analyze_parquet(&args.input)?
    } else {
        analyzer.analyze_csv(&args.input)?
    };

    if let Some(output_path) = args.output {
        let json = serde_json::to_string_pretty(&analysis)?;
        std::fs::write(output_path, json)?;
        if !args.silent {
            eprintln!("Analysis written to file");
        }
    } else {
        let json = serde_json::to_string_pretty(&analysis)?;
        println!("{}", json);
    }

    Ok(())
}

fn run_convert(args: ConvertArgs) -> Result<(), Box<dyn Error>> {
    let excel_path = Path::new(&args.input);
    let output_dir = Path::new(&args.output);
    let output_format = match args.format.as_str() {
        "parquet" => converter::OutputFormat::Parquet,
        _ => converter::OutputFormat::Csv,
    };
    converter::convert_excel(excel_path, output_dir, output_format)?;
    Ok(())
}

fn run_merge(args: MergeArgs) -> Result<(), Box<dyn Error>> {
    let input_paths: Vec<_> = args.inputs.iter().map(|p| Path::new(p)).collect();
    let output_path = Path::new(&args.output);
    merger::merge_csv_files(input_paths, output_path)?;
    Ok(())
}

fn run_sample(args: SampleArgs) -> Result<(), Box<dyn Error>> {
    let input_path = Path::new(&args.input);
    let output_path = Path::new(&args.output);
    sampler::sample_csv(input_path, output_path)?;
    Ok(())
}

fn run_prepare(args: PrepareArgs) -> Result<(), Box<dyn Error>> {
    let mut column_types = std::collections::HashMap::new();

    if let Some(db_types_json) = &args.db_types {
        column_types = serde_json::from_str(db_types_json)?;
    } else if let Some(types_file) = &args.types {
        let types_content = std::fs::read_to_string(types_file)?;
        let analysis: types::CsvAnalysis = serde_json::from_str(&types_content)?;

        for column in &analysis.columns {
            column_types.insert(column.name.clone(), column.recommended_type.clone());
        }
    } else {
        return Err("Either --types or --db-types must be provided".into());
    }

    let csv_cleaner = cleaner::CsvCleaner::new(args.silent);
    let rows_processed = csv_cleaner.clean_csv(&args.input, &args.output, &column_types)?;

    if !args.silent {
        eprintln!(
            "CSV preparation complete: {} rows processed",
            rows_processed
        );
    }

    Ok(())
}

fn run_import_parquet(args: ImportParquetArgs) -> Result<(), Box<dyn Error>> {
    let connection_string = match args.connection {
        Some(connection) => connection,
        None => std::env::var("DATABASE_URL")
            .map_err(|_| "DATABASE_URL must be set when --connection is omitted")?,
    };
    let column_type_overrides = args
        .column_type_overrides
        .as_deref()
        .map(serde_json::from_str)
        .transpose()?
        .unwrap_or_default();
    let input_paths = args.inputs.iter().map(Path::new).map(Path::to_path_buf).collect();

    let records = parquet_postgres::import_parquet_files(
        parquet_postgres::ParquetImportOptions {
            connection_string,
            schema_name: args.schema,
            table_name: args.table,
            input_paths,
            column_type_overrides,
            truncate: args.truncate,
            silent: args.silent,
        },
    )?;

    println!("{}", serde_json::json!({ "records": records }));
    Ok(())
}

fn is_parquet_path(input: &str) -> bool {
    Path::new(input)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("parquet"))
        .unwrap_or(false)
}
