use crate::logger::Logger;
use crate::parquet_io;
use crate::text_normalizer::normalize_column_name;
use crate::type_inference::correct_column_type;
use crate::value_cleaners::{
    clean_date_value, clean_general_value, clean_integer_value, clean_numeric_value,
    clean_time_value,
};
use arrow::record_batch::RecordBatch;
use postgres::{Client, NoTls, Transaction};
use std::collections::HashMap;
use std::error::Error;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct ParquetImportOptions {
    pub connection_string: String,
    pub schema_name: String,
    pub table_name: String,
    pub input_paths: Vec<PathBuf>,
    pub column_type_overrides: HashMap<String, String>,
    pub truncate: bool,
    pub silent: bool,
}

#[derive(Debug, Clone)]
struct TableColumn {
    name: String,
    data_type: String,
}

#[derive(Debug, Clone)]
struct ColumnMapping {
    source_index: usize,
    source_name: String,
    db_name: String,
    db_type: String,
}

pub fn import_parquet_files(options: ParquetImportOptions) -> Result<u64, Box<dyn Error>> {
    if options.input_paths.is_empty() {
        return Err("At least one Parquet input file must be provided".into());
    }

    let mut client = Client::connect(&options.connection_string, NoTls)?;
    let mut transaction = client.transaction()?;
    let qualified_table = qualified_table_name(&options.schema_name, &options.table_name);

    if options.truncate {
        transaction.batch_execute(&format!("TRUNCATE TABLE {}", qualified_table))?;
    }

    let logical_type_overrides = normalize_type_overrides(&options.column_type_overrides);
    let mut total_records = 0;
    for input_path in &options.input_paths {
        let imported = import_single_parquet_file(
            &mut transaction,
            input_path,
            &options.schema_name,
            &options.table_name,
            &qualified_table,
            &logical_type_overrides,
            options.silent,
        )?;
        total_records += imported;
    }

    transaction.commit()?;

    if !options.silent {
        eprintln!(
            "Parquet import complete: {} records imported into {}",
            total_records, qualified_table
        );
    }

    Ok(total_records)
}

fn import_single_parquet_file(
    transaction: &mut Transaction<'_>,
    input_path: &Path,
    schema_name: &str,
    table_name: &str,
    qualified_table: &str,
    logical_type_overrides: &HashMap<String, String>,
    silent: bool,
) -> Result<u64, Box<dyn Error>> {
    let source_headers = parquet_io::read_parquet_headers(input_path)?;
    let table_columns = load_table_columns(transaction, schema_name, table_name)?;
    let mappings = map_source_columns_to_table(
        &source_headers,
        &table_columns,
        logical_type_overrides,
        silent,
    );

    if mappings.is_empty() {
        return Err(format!(
            "No matching columns found between Parquet file {} and table {}",
            input_path.display(),
            qualified_table
        )
        .into());
    }

    let copy_columns = mappings
        .iter()
        .map(|mapping| quote_identifier(&mapping.db_name))
        .collect::<Vec<_>>()
        .join(", ");
    let copy_sql = format!(
        "COPY {} ({}) FROM STDIN WITH (FORMAT csv, HEADER false, DELIMITER ';', NULL '', QUOTE '\"', ESCAPE '\"')",
        qualified_table, copy_columns
    );

    if !silent {
        eprintln!(
            "Streaming Parquet {} into {} with {} mapped columns",
            input_path.display(),
            qualified_table,
            mappings.len()
        );
    }

    let copied_rows = {
        let mut copy_writer = transaction.copy_in(&copy_sql)?;
        parquet_io::for_each_parquet_batch(input_path, |batch| {
            write_batch_to_copy(&mut copy_writer, batch, &mappings)
        })?;
        copy_writer.finish()?
    };

    Ok(copied_rows)
}

fn load_table_columns(
    transaction: &mut Transaction<'_>,
    schema_name: &str,
    table_name: &str,
) -> Result<Vec<TableColumn>, Box<dyn Error>> {
    let rows = transaction.query(
        "
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
        ",
        &[&schema_name, &table_name],
    )?;

    Ok(rows
        .into_iter()
        .map(|row| TableColumn {
            name: row.get(0),
            data_type: row.get(1),
        })
        .collect())
}

fn map_source_columns_to_table(
    source_headers: &[String],
    table_columns: &[TableColumn],
    logical_type_overrides: &HashMap<String, String>,
    silent: bool,
) -> Vec<ColumnMapping> {
    let mut mappings = Vec::new();
    let mut unmatched_columns = Vec::new();

    for (source_index, source_name) in source_headers.iter().enumerate() {
        let normalized_source_name = normalize_column_name(source_name);
        let matching_column = table_columns
            .iter()
            .find(|column| column.name == *source_name)
            .or_else(|| {
                table_columns
                    .iter()
                    .find(|column| column.name == normalized_source_name)
            })
            .or_else(|| {
                table_columns
                    .iter()
                    .find(|column| normalize_column_name(&column.name) == normalized_source_name)
            })
            .or_else(|| {
                table_columns
                    .iter()
                    .find(|column| column.name.eq_ignore_ascii_case(source_name))
            });

        if let Some(column) = matching_column {
            let normalized_db_name = normalize_column_name(&column.name);
            let logical_type = logical_type_overrides
                .get(&normalized_source_name)
                .or_else(|| logical_type_overrides.get(&normalized_db_name))
                .cloned()
                .unwrap_or_else(|| column.data_type.clone());

            mappings.push(ColumnMapping {
                source_index,
                source_name: source_name.clone(),
                db_name: column.name.clone(),
                db_type: logical_type,
            });
        } else {
            unmatched_columns.push(source_name.clone());
        }
    }

    if !silent && !unmatched_columns.is_empty() {
        eprintln!(
            "Unmatched Parquet columns ({}): {}",
            unmatched_columns.len(),
            unmatched_columns.join(", ")
        );
    }

    mappings
}

fn write_batch_to_copy<W: Write>(
    copy_writer: &mut W,
    batch: &RecordBatch,
    mappings: &[ColumnMapping],
) -> Result<(), Box<dyn Error>> {
    let mut buffer = Vec::new();
    let logger = Logger::new(true);
    {
        let mut csv_writer = csv::WriterBuilder::new()
            .delimiter(b';')
            .quote_style(csv::QuoteStyle::Necessary)
            .has_headers(false)
            .from_writer(&mut buffer);

        for row_index in 0..batch.num_rows() {
            let mut row = Vec::with_capacity(mappings.len());
            for mapping in mappings {
                let value = parquet_io::array_value_to_string(
                    batch.column(mapping.source_index),
                    row_index,
                );
                let corrected_type =
                    correct_column_type(&mapping.source_name, &mapping.db_type, Some(&value));
                row.push(clean_value_by_type(
                    &value,
                    &corrected_type,
                    &mapping.source_name,
                    &logger,
                ));
            }
            csv_writer.write_record(&row)?;
        }
        csv_writer.flush()?;
    }

    copy_writer.write_all(&buffer)?;
    Ok(())
}

fn clean_value_by_type(value: &str, column_type: &str, header: &str, logger: &Logger) -> String {
    let normalized_type = column_type.to_lowercase();

    match normalized_type.as_str() {
        column_type
            if column_type.contains("double precision")
                || column_type.contains("real")
                || column_type.contains("float")
                || column_type.contains("numeric") =>
        {
            clean_numeric_value(value, logger)
        }
        column_type
            if column_type.contains("bigint")
                || column_type.contains("integer")
                || column_type.contains("smallint")
                || column_type.contains("int") =>
        {
            let header_lower = header.to_lowercase();
            if header_lower.contains("cep")
                || header_lower.contains("postal")
                || header_lower.contains("zip")
            {
                clean_general_value(value, logger)
            } else {
                clean_integer_value(value, logger)
            }
        }
        column_type if column_type.contains("date") => {
            clean_date_value(value, logger)
        }
        column_type if column_type.contains("time") => {
            clean_time_value(value, logger)
        }
        _ => clean_general_value(value, logger),
    }
}

fn normalize_type_overrides(
    column_type_overrides: &HashMap<String, String>,
) -> HashMap<String, String> {
    column_type_overrides
        .iter()
        .map(|(name, column_type)| (normalize_column_name(name), column_type.to_uppercase()))
        .collect()
}

fn qualified_table_name(schema_name: &str, table_name: &str) -> String {
    format!(
        "{}.{}",
        quote_identifier(schema_name),
        quote_identifier(table_name)
    )
}

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_raw_parquet_headers_to_normalized_table_columns() {
        let source_headers = vec![
            "Data Nascimento".to_string(),
            "HORA FATO".to_string(),
            "Descricao".to_string(),
        ];
        let table_columns = vec![
            TableColumn {
                name: "DATA_NASCIMENTO".to_string(),
                data_type: "date".to_string(),
            },
            TableColumn {
                name: "HORA_FATO".to_string(),
                data_type: "time without time zone".to_string(),
            },
            TableColumn {
                name: "DESCRICAO".to_string(),
                data_type: "text".to_string(),
            },
        ];

        let mappings =
            map_source_columns_to_table(&source_headers, &table_columns, &HashMap::new(), true);

        assert_eq!(mappings.len(), 3);
        assert_eq!(mappings[0].source_index, 0);
        assert_eq!(mappings[0].db_name, "DATA_NASCIMENTO");
        assert_eq!(mappings[1].source_index, 1);
        assert_eq!(mappings[1].db_name, "HORA_FATO");
        assert_eq!(mappings[2].source_index, 2);
        assert_eq!(mappings[2].db_name, "DESCRICAO");
    }

    #[test]
    fn uses_logical_type_overrides_without_changing_table_mapping() {
        let source_headers = vec!["Data Registro".to_string(), "Quantidade".to_string()];
        let table_columns = vec![
            TableColumn {
                name: "DATA_REGISTRO".to_string(),
                data_type: "text".to_string(),
            },
            TableColumn {
                name: "QUANTIDADE".to_string(),
                data_type: "text".to_string(),
            },
        ];
        let mut overrides = HashMap::new();
        overrides.insert("DATA_REGISTRO".to_string(), "DATE".to_string());
        overrides.insert("QUANTIDADE".to_string(), "NUMERIC".to_string());

        let mappings = map_source_columns_to_table(&source_headers, &table_columns, &overrides, true);

        assert_eq!(mappings[0].db_name, "DATA_REGISTRO");
        assert_eq!(mappings[0].db_type, "DATE");
        assert_eq!(mappings[1].db_name, "QUANTIDADE");
        assert_eq!(mappings[1].db_type, "NUMERIC");
    }
}
