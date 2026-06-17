//! Value cleaning utilities for CSV data processing.
//!
//! This module provides functions for cleaning and normalizing values
//! in different column types: numeric, integer, time, date, and general text.

mod date;
mod general;
mod integer;
mod numeric;
mod time;

pub use date::clean_date_value;
pub use general::clean_general_value;
pub use integer::clean_integer_value;
pub use numeric::clean_numeric_value;
pub use time::clean_time_value;

use crate::logger::Logger;

/// A cleaner context that holds shared state for value cleaning operations.
///
/// This struct is used to pass logging and configuration to cleaning functions.
#[derive(Clone)]
pub struct CleanerContext {
    logger: Logger,
}

impl CleanerContext {
    /// Create a new cleaner context.
    pub fn new(silent: bool) -> Self {
        Self {
            logger: Logger::new(silent),
        }
    }

    /// Get a reference to the logger.
    pub fn logger(&self) -> &Logger {
        &self.logger
    }
}
