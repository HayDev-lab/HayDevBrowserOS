fn main() {
    for name in ["HAYDEV_BUILD_INPUT_SHA256", "HAYDEV_BUILD_HEAD"] {
        println!("cargo:rerun-if-env-changed={name}");
        let value = std::env::var(name).unwrap_or_else(|_| "unrecorded".into());
        println!("cargo:rustc-env={name}={value}");
    }
    tauri_build::build()
}
