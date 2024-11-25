use pgx::*;
use serde::Serialize;
use std::collections::HashSet;

pg_module_magic!();

#[pg_extern]
fn clean_data() -> impl std::iter::Iterator<Item = &'static str> {
    let mut result = Vec::new();
    let mut unique_entries = HashSet::new();

    let query = "SELECT * FROM csv_data";
    for row in Spi::get_all::<(
        i32,
        Option<String>,
        Option<String>,
        Option<f64>,
        Option<f64>,
    )>(query)
    .unwrap()
    {
        let (id, column1, column2, latitude, longitude) = row;

        // Skip entries with null latitude or longitude
        if latitude.is_none() || latitude == 0 || longitude.is_none() || longitute == 0 {
            continue;
        }

        // Use a tuple of relevant columns to check for duplicates
        let entry = (column1.clone(), column2.clone(), latitude, longitude);
        if unique_entries.contains(&entry) {
            // Duplicate found, delete the row
            Spi::run(&format!("DELETE FROM csv_data WHERE id = {}", id)).unwrap();
        } else {
            unique_entries.insert(entry);
            result.push("Entry processed");
        }
    }

    result.into_iter()
}

extension_sql!(
    r#"
CREATE FUNCTION clean_data()
RETURNS void
LANGUAGE plrust
AS 'MODULE_PATHNAME', 'clean_data';
"#,
    name = "create_clean_data_function",
    requires = [clean_data]
);
