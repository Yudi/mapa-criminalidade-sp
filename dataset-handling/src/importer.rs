use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::path::Path;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;

type BoxError = Box<dyn Error + Send + Sync>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataCategory {
    pub name: String,
    pub base_url: String,
    pub years: Vec<u16>,
    pub table_prefix: String,
    pub has_schema: bool,
}

pub struct DataImporter {
    client: Client,
    temp_dir: String,
}

impl DataImporter {
    pub fn new(temp_dir: String) -> Self {
        Self {
            client: Client::new(),
            temp_dir,
        }
    }

    pub async fn download_file(&self, url: &str, file_path: &Path) -> Result<(), BoxError> {
        println!("Downloading: {}", url);

        let response = self.client.get(url).send().await?;

        if !response.status().is_success() {
            return Err(format!("Failed to download file: {}", response.status()).into());
        }

        let mut file = File::create(file_path).await?;
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            file.write_all(&chunk).await?;
        }

        file.flush().await?;
        println!("Downloaded: {}", file_path.display());
        Ok(())
    }

    pub async fn process_data_category(&self, category: &DataCategory) -> Result<(), BoxError> {
        println!("Processing category: {}", category.name);

        for &year in &category.years {
            if let Err(e) = self.process_year(category, year).await {
                eprintln!(
                    "Failed to process {} for year {}: {}",
                    category.name, year, e
                );
                continue;
            }
        }

        Ok(())
    }

    async fn process_year(&self, category: &DataCategory, year: u16) -> Result<(), BoxError> {
        let url = format!("{}{}.xlsx", category.base_url, year);
        let filename = format!("{}_{}.xlsx", category.table_prefix, year);
        let file_path = Path::new(&self.temp_dir).join(&filename);

        // Ensure temp directory exists
        tokio::fs::create_dir_all(&self.temp_dir).await?;

        // Download file
        self.download_file(&url, &file_path).await?;

        // Convert Excel to CSV
        let csv_dir =
            Path::new(&self.temp_dir).join(format!("{}_{}_csv", category.table_prefix, year));
        self.convert_excel_to_csv(&file_path, &csv_dir).await?;

        // Return paths for further processing by Node.js
        println!(
            "Processed {} {} - CSV files in: {}",
            category.name,
            year,
            csv_dir.display()
        );

        Ok(())
    }

    async fn convert_excel_to_csv(
        &self,
        excel_path: &Path,
        output_dir: &Path,
    ) -> Result<(), BoxError> {
        tokio::fs::create_dir_all(output_dir).await?;

        // Use existing converter but in async context
        let result = tokio::task::spawn_blocking({
            let excel_path = excel_path.to_owned();
            let output_dir = output_dir.to_owned();
            move || crate::converter::convert_excel_to_csv(&excel_path, &output_dir)
        })
        .await;

        match result {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(format!("Converter failed: {}", e).into()),
            Err(e) => Err(format!("Task failed: {}", e).into()),
        }
    }

    pub fn get_data_categories() -> Vec<DataCategory> {
        vec![
            DataCategory {
                name: "Dados Criminais".to_string(),
                base_url: "https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados/SPDadosCriminais_".to_string(),
                years: vec![2022, 2023, 2024, 2025],
                table_prefix: "dados_criminais".to_string(),
                has_schema: true,
            },
            DataCategory {
                name: "Dados de Produtividade".to_string(),
                base_url: "https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados/DadosProdutividade_".to_string(),
                years: vec![2024, 2025],
                table_prefix: "produtividade".to_string(),
                has_schema: true,
            },
            DataCategory {
                name: "MDIP".to_string(),
                base_url: "https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados/MDIP_".to_string(),
                years: vec![2025],
                table_prefix: "mdip".to_string(),
                has_schema: true,
            },
            DataCategory {
                name: "Celulares Subtraídos".to_string(),
                base_url: "https://www.ssp.sp.gov.br/assets/estatistica/transparencia/baseDados/celularesSub/CelularesSubtraidos_".to_string(),
                years: vec![2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
                table_prefix: "celulares".to_string(),
                has_schema: true,
            },
            DataCategory {
                name: "Veículos Subtraídos".to_string(),
                base_url: "https://www.ssp.sp.gov.br/assets/estatistica/transparencia/baseDados/veiculosSub/VeiculosSubtraidos_".to_string(),
                years: vec![2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
                table_prefix: "veiculos".to_string(),
                has_schema: true,
            },
            DataCategory {
                name: "Objetos Subtraídos".to_string(),
                base_url: "https://www.ssp.sp.gov.br/assets/estatistica/transparencia/baseDados/objetosSub/ObjetosSubtraidos_".to_string(),
                years: vec![2022, 2023, 2024, 2025],
                table_prefix: "objetos".to_string(),
                has_schema: true,
            },
        ]
    }
}
