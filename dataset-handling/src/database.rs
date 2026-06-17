use csv::ReaderBuilder;
use std::collections::HashMap;
use std::error::Error;
use std::fs::File;
use std::path::Path;
use tokio_postgres::{Client, NoTls};

type BoxError = Box<dyn Error + Send + Sync>;

pub struct DatabaseImporter {
    client: Client,
}

impl DatabaseImporter {
    pub async fn new(connection_string: &str) -> Result<Self, BoxError> {
        let (client, connection) = tokio_postgres::connect(connection_string, NoTls).await?;

        // Spawn connection in background
        tokio::spawn(async move {
            if let Err(e) = connection.await {
                eprintln!("Database connection error: {}", e);
            }
        });

        Ok(Self { client })
    }

    pub async fn table_exists(&self, table_name: &str) -> Result<bool, BoxError> {
        let query = "SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
        )";

        let row = self.client.query_one(query, &[&table_name]).await?;
        let exists: bool = row.get(0);
        Ok(exists)
    }

    pub async fn get_table_count(&self, table_name: &str) -> Result<i64, BoxError> {
        let query = format!("SELECT COUNT(*) FROM {}", table_name);
        let row = self.client.query_one(&query, &[]).await?;
        let count: i64 = row.get(0);
        Ok(count)
    }

    pub async fn truncate_table(&self, table_name: &str) -> Result<(), BoxError> {
        let query = format!("TRUNCATE TABLE {}", table_name);
        self.client.execute(&query, &[]).await?;
        println!("Truncated table: {}", table_name);
        Ok(())
    }

    pub async fn import_csv_files(
        &self,
        csv_dir: &Path,
        table_prefix: &str,
        year: u16,
    ) -> Result<(), BoxError> {
        let table_name = format!("{}_{}", table_prefix, year);

        // Check if table exists
        if !self.table_exists(&table_name).await? {
            println!("Table {} does not exist, skipping import", table_name);
            return Ok(());
        }

        // Clear existing data
        self.truncate_table(&table_name).await?;

        // Find CSV files in the directory
        let entries = std::fs::read_dir(csv_dir)?;
        let csv_files: Vec<_> = entries
            .filter_map(|entry| {
                let entry = entry.ok()?;
                let path = entry.path();
                if path.extension()?.to_str()? == "csv" {
                    Some(path)
                } else {
                    None
                }
            })
            .collect();

        if csv_files.is_empty() {
            println!("No CSV files found in {}", csv_dir.display());
            return Ok(());
        }

        // Import each CSV file
        for csv_file in csv_files {
            self.import_single_csv(&csv_file, &table_name).await?;
        }

        Ok(())
    }

    async fn import_single_csv(&self, csv_path: &Path, table_name: &str) -> Result<(), BoxError> {
        println!("Importing {} to table {}", csv_path.display(), table_name);

        // Read CSV in chunks to avoid memory issues
        let file = File::open(csv_path)?;
        let mut rdr = ReaderBuilder::new()
            .delimiter(b';')
            .from_reader(file);

        // Get headers
        let headers: Vec<String> = rdr.headers()?.iter().map(|h| h.to_string()).collect();

        if headers.is_empty() {
            println!("No headers found in CSV file");
            return Ok(());
        }

        // Process records in batches
        let mut records = Vec::new();
        let batch_size = 1000;
        let mut total_imported = 0;

        for result in rdr.records() {
            let record = result?;
            let record_map: HashMap<String, String> = headers
                .iter()
                .zip(record.iter())
                .map(|(header, value)| (header.clone(), value.to_string()))
                .collect();

            records.push(record_map);

            if records.len() >= batch_size {
                self.insert_batch(table_name, &headers, &records).await?;
                total_imported += records.len();
                records.clear();

                if total_imported % 10000 == 0 {
                    println!("Imported {} records to {}", total_imported, table_name);
                }
            }
        }

        // Insert remaining records
        if !records.is_empty() {
            self.insert_batch(table_name, &headers, &records).await?;
            total_imported += records.len();
        }

        println!(
            "Imported {} total records to {}",
            total_imported, table_name
        );
        Ok(())
    }

    async fn insert_batch(
        &self,
        table_name: &str,
        headers: &[String],
        records: &[HashMap<String, String>],
    ) -> Result<(), BoxError> {
        if records.is_empty() {
            return Ok(());
        }

        // Create column list
        let columns: String = headers
            .iter()
            .map(|col| format!("\"{}\"", col))
            .collect::<Vec<_>>()
            .join(", ");

        // Create placeholder values
        let mut placeholders = Vec::new();
        let mut values = Vec::new();

        for (row_idx, record) in records.iter().enumerate() {
            let row_placeholders: Vec<String> = (0..headers.len())
                .map(|col_idx| format!("${}", row_idx * headers.len() + col_idx + 1))
                .collect();

            placeholders.push(format!("({})", row_placeholders.join(", ")));

            // Add values in the same order as headers
            for header in headers {
                values.push(record.get(header).map(|s| s.as_str()).unwrap_or(""));
            }
        }

        let query = format!(
            "INSERT INTO {} ({}) VALUES {}",
            table_name,
            columns,
            placeholders.join(", ")
        );

        // Convert values to the format expected by tokio_postgres
        let params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = values
            .iter()
            .map(|v| v as &(dyn tokio_postgres::types::ToSql + Sync))
            .collect();

        self.client.execute(&query, &params).await?;
        Ok(())
    }

    pub async fn get_import_status(
        &self,
        table_prefix: &str,
        years: &[u16],
    ) -> Result<HashMap<u16, (bool, i64)>, BoxError> {
        let mut status = HashMap::new();

        for &year in years {
            let table_name = format!("{}_{}", table_prefix, year);
            let exists = self.table_exists(&table_name).await?;

            let count = if exists {
                self.get_table_count(&table_name).await.unwrap_or(0)
            } else {
                0
            };

            status.insert(year, (exists, count));
        }

        Ok(status)
    }
}
