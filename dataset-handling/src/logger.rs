#[derive(Clone)]
pub struct Logger {
    silent: bool,
}

impl Logger {
    pub fn new(silent: bool) -> Self {
        Self { silent }
    }
    pub fn info(&self, message: &str) {
        if !self.silent {
            println!("{}", message);
        }
    }
    pub fn success(&self, message: &str) {
        if !self.silent {
            println!("{}", message);
        }
    }
    pub fn progress(&self, message: &str) {
        if !self.silent {
            println!("{}", message);
        }
    }
    pub fn processing(&self, message: &str) {
        if !self.silent {
            println!("{}", message);
        }
    }
    pub fn data(&self, message: &str) {
        if !self.silent {
            println!("{}", message);
        }
    }
    pub fn debug(&self, message: &str) {
        if !self.silent {
            println!("{}", message);
        }
    }
    pub fn warn(&self, message: &str) {
        eprintln!("{}", message);
    }
}
