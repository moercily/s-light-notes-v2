#[cfg(desktop)]
mod desktop;
#[cfg(desktop)]
pub use desktop::run;

#[cfg(target_os = "android")]
mod android;
#[cfg(target_os = "android")]
pub use android::run;
