#[derive(Clone)]
pub struct Logger {
    silent: bool,
}

impl Logger {
    pub fn new(silent: bool) -> Self {
        Self { silent }
    }
    pub fn println(&self, message: &str) {
        if !self.silent {
            println!("{}", message);
        }
    }
    pub fn print_fmt(&self, args: std::fmt::Arguments) {
        if !self.silent {
            println!("{}", args);
        }
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
    pub fn setup(&self, message: &str) {
        if !self.silent {
            println!("{}", message);
        }
    }
    pub fn analyze(&self, message: &str) {
        if !self.silent {
            println!("{}", message);
        }
    }
    pub fn data(&self, message: &str) {
        if !self.silent {
            println!("{}", message);
        }
    }
    pub fn reading(&self, message: &str) {
        if !self.silent {
            println!("{}", message);
        }
    }
    pub fn parallel(&self, message: &str) {
        if !self.silent {
            println!("{}", message);
        }
    }
    pub fn rocket(&self, message: &str) {
        if !self.silent {
            println!("{}", message);
        }
    }
    pub fn timer(&self, message: &str) {
        if !self.silent {
            println!("{}", message);
        }
    }
    pub fn measure(&self, message: &str) {
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
    pub fn error(&self, message: &str) {
        eprintln!("{}", message);
    }
}
#[macro_export]
macro_rules! log_fmt {
    ($logger:expr, $($arg:tt)*) => {
        $logger.print_fmt(format_args!($($arg)*))
    };
}