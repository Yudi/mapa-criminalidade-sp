use arrow::array::{Array, ArrayRef, LargeStringArray, StringArray, StringBuilder};
use arrow::datatypes::{DataType, Field, Schema};
use arrow::record_batch::RecordBatch;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use parquet::arrow::ArrowWriter;
use parquet::basic::Compression;
use parquet::file::properties::WriterProperties;
use std::error::Error;
use std::fs::File;
use std::path::Path;
use std::sync::Arc;

const DEFAULT_BATCH_SIZE: usize = 8_192;

pub fn write_string_rows_to_parquet_iter<I>(
    output_path: &Path,
    headers: &[String],
    rows: I,
) -> Result<usize, Box<dyn Error>>
where
    I: IntoIterator<Item = Vec<String>>,
{
    let file = File::create(output_path)?;
    let fields: Vec<Field> = headers
        .iter()
        .map(|header| Field::new(header, DataType::Utf8, true))
        .collect();
    let schema = Arc::new(Schema::new(fields));
    let props = WriterProperties::builder()
        .set_compression(Compression::SNAPPY)
        .build();
    let mut writer = ArrowWriter::try_new(file, Arc::clone(&schema), Some(props))?;

    let mut chunk: Vec<Vec<String>> = Vec::with_capacity(DEFAULT_BATCH_SIZE);
    let mut row_count = 0;
    for row in rows {
        chunk.push(row);
        if chunk.len() < DEFAULT_BATCH_SIZE {
            continue;
        }
        let mut builders: Vec<StringBuilder> = headers
            .iter()
            .map(|_| StringBuilder::with_capacity(chunk.len(), 1024))
            .collect();

        for row in &chunk {
            for (column_index, builder) in builders.iter_mut().enumerate() {
                match row.get(column_index).map(|value| value.trim()) {
                    Some(value) if !value.is_empty() => builder.append_value(value),
                    _ => builder.append_null(),
                }
            }
        }

        let arrays: Vec<ArrayRef> = builders
            .into_iter()
            .map(|mut builder| Arc::new(builder.finish()) as ArrayRef)
            .collect();
        let batch = RecordBatch::try_new(Arc::clone(&schema), arrays)?;
        writer.write(&batch)?;
        row_count += chunk.len();
        chunk.clear();
    }

    if !chunk.is_empty() {
        let mut builders: Vec<StringBuilder> = headers
            .iter()
            .map(|_| StringBuilder::with_capacity(chunk.len(), 1024))
            .collect();

        for row in &chunk {
            for (column_index, builder) in builders.iter_mut().enumerate() {
                match row.get(column_index).map(|value| value.trim()) {
                    Some(value) if !value.is_empty() => builder.append_value(value),
                    _ => builder.append_null(),
                }
            }
        }

        let arrays: Vec<ArrayRef> = builders
            .into_iter()
            .map(|mut builder| Arc::new(builder.finish()) as ArrayRef)
            .collect();
        let batch = RecordBatch::try_new(Arc::clone(&schema), arrays)?;
        writer.write(&batch)?;
        row_count += chunk.len();
    }

    writer.close()?;
    Ok(row_count)
}

pub fn read_parquet_headers(input_path: &Path) -> Result<Vec<String>, Box<dyn Error>> {
    let file = File::open(input_path)?;
    let builder = ParquetRecordBatchReaderBuilder::try_new(file)?;
    Ok(builder
        .schema()
        .fields()
        .iter()
        .map(|field| field.name().to_string())
        .collect())
}

pub fn for_each_parquet_batch<F>(input_path: &Path, mut callback: F) -> Result<(), Box<dyn Error>>
where
    F: FnMut(&RecordBatch) -> Result<(), Box<dyn Error>>,
{
    let file = File::open(input_path)?;
    let reader = ParquetRecordBatchReaderBuilder::try_new(file)?
        .with_batch_size(DEFAULT_BATCH_SIZE)
        .build()?;

    for batch_result in reader {
        callback(&batch_result?)?;
    }

    Ok(())
}

pub fn array_value_to_string(array: &ArrayRef, row_index: usize) -> String {
    if array.is_null(row_index) {
        return String::new();
    }

    match array.data_type() {
        DataType::Utf8 => array
            .as_any()
            .downcast_ref::<StringArray>()
            .map(|strings| strings.value(row_index).to_string())
            .unwrap_or_default(),
        DataType::LargeUtf8 => array
            .as_any()
            .downcast_ref::<LargeStringArray>()
            .map(|strings| strings.value(row_index).to_string())
            .unwrap_or_default(),
        _ => arrow::util::display::array_value_to_string(array.as_ref(), row_index)
            .unwrap_or_default(),
    }
}
