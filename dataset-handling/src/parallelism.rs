use rayon::ThreadPoolBuildError;

/// Hard cap for dataset-handling parallel work.
///
/// Production runs multiple server instances, so keep each dataset-handling
/// process intentionally conservative.
pub const DATASET_HANDLING_PARALLELISM: usize = 1;

pub fn configure_global_thread_pool() -> Result<(), ThreadPoolBuildError> {
    rayon::ThreadPoolBuilder::new()
        .num_threads(DATASET_HANDLING_PARALLELISM)
        .build_global()
}
