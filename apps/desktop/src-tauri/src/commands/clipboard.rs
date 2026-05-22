use std::io::Write;
use std::process::{Command, Stdio};

#[tauri::command]
pub fn copy_to_clipboard(text: String) -> Result<(), String> {
    copy_text(&text)
}

fn run_clipboard_command(program: &str, args: &[&str], text: &str) -> Result<(), String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to start {program}: {err}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|err| format!("Failed to write to {program}: {err}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|err| format!("Failed to run {program}: {err}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!("{program} exited with {}: {stderr}", output.status))
}

#[cfg(target_os = "macos")]
fn copy_text(text: &str) -> Result<(), String> {
    run_clipboard_command("pbcopy", &[], text)
}

#[cfg(target_os = "windows")]
fn copy_text(text: &str) -> Result<(), String> {
    run_clipboard_command(
        "powershell",
        &[
            "-NoProfile",
            "-Command",
            "Set-Clipboard -Value ([Console]::In.ReadToEnd())",
        ],
        text,
    )
}

#[cfg(target_os = "linux")]
fn copy_text(text: &str) -> Result<(), String> {
    let attempts = [
        ("wl-copy", Vec::<&str>::new()),
        ("xclip", vec!["-selection", "clipboard"]),
        ("xsel", vec!["--clipboard", "--input"]),
    ];

    let mut errors = Vec::new();
    for (program, args) in attempts {
        match run_clipboard_command(program, &args, text) {
            Ok(()) => return Ok(()),
            Err(err) => errors.push(err),
        }
    }

    Err(format!(
        "No clipboard command succeeded. Install wl-copy, xclip, or xsel. {}",
        errors.join("; ")
    ))
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn copy_text(_text: &str) -> Result<(), String> {
    Err("Clipboard is not supported on this platform".to_string())
}
