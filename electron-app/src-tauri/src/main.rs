// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--build-identity") {
        println!("{}", app_lib::commands::build_identity());
        return;
    }
    if app_lib::documents::worker_main() { return; }
    app_lib::run();
}
