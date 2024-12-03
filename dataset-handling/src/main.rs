use clap::{Parser, Subcommand};
use std::error::Error;
use std::path::Path;

mod converter;
mod merger;
mod sampler;

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug, Clone)]
enum Commands {
    /// Convert a single CSV file to CSV
    Convert(ConvertArgs),
    /// Merge multiple CSV files into one CSV. Headers must match.
    Merge(MergeArgs),
    /// Sample the first 5 rows of a CSV file
    Sample(SampleArgs),
}

#[derive(Parser, Debug, Clone)]
struct ConvertArgs {
    /// Input Excel file path
    #[arg(short, long)]
    input: String,

    /// Output CSV file path
    #[arg(short, long)]
    output: String,

    /// Sheet name. If not provided, the first sheet is used.
    #[arg(short, long)]
    sheet: Option<String>,
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

    /// Output CSV file path (optional)
    #[arg(short, long)]
    output: Option<String>,
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Args = Args::parse();

    match args.command {
        Commands::Convert(convert_args) => {
            let excel_path: &Path = Path::new(&convert_args.input);
            let csv_path: &Path = Path::new(&convert_args.output);

            converter::convert_excel_to_csv(excel_path, csv_path, convert_args.sheet)?;
        }
        Commands::Merge(merge_args) => {
            let input_paths: Vec<_> = merge_args
                .inputs
                .iter()
                .map(|p: &String| Path::new(p))
                .collect();
            let output_path: &Path = Path::new(&merge_args.output);

            merger::merge_csv_files(input_paths, output_path)?;
        }
        Commands::Sample(sample_args) => {
            let input_path = Path::new(&sample_args.input);
            let output_path = match sample_args.output {
                Some(path) => Path::new(&path).to_path_buf(),
                None => {
                    let stem = input_path.file_stem().unwrap_or_default();
                    let parent = input_path.parent().unwrap_or_else(|| Path::new(""));
                    parent.join(format!("{}-sample.csv", stem.to_string_lossy()))
                }
            };
            sampler::sample_csv(input_path, &output_path)?;
        }
    }
    Ok(())
}
