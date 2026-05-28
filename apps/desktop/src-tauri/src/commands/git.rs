use git2::{Cred, FetchOptions, PushOptions, RemoteCallbacks, Repository};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CloneProgress {
    received_objects: usize,
    total_objects: usize,
    received_bytes: u64,
    percent: u8,
    phase: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: String,
    pub ahead: usize,
    pub behind: usize,
    pub changed_files: Vec<ChangedFile>,
    pub has_changes: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub status: String,
}

#[tauri::command]
pub async fn git_clone(
    app: tauri::AppHandle,
    url: String,
    path: String,
    token: String,
) -> Result<String, String> {
    let path = if path.starts_with("~/") {
        let home = dirs::home_dir().ok_or_else(|| "No home directory".to_string())?;
        home.join(&path[2..]).to_string_lossy().to_string()
    } else {
        path
    };
    let token_clone = token.clone();
    let app_clone = app.clone();
    let last_pct = Arc::new(Mutex::new(0u8));

    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |_url, _username, _allowed| {
        Cred::userpass_plaintext("x-access-token", &token_clone)
    });

    callbacks.transfer_progress(move |stats| {
        let total = stats.total_objects();
        let received = stats.received_objects();
        let pct = if total > 0 {
            ((received as f64 / total as f64) * 100.0) as u8
        } else {
            0
        };
        let mut last = last_pct.lock().unwrap();
        if pct != *last {
            *last = pct;
            let phase = if stats.indexed_deltas() > 0 {
                "Resolving deltas".to_string()
            } else {
                "Receiving objects".to_string()
            };
            let _ = app_clone.emit(
                "clone-progress",
                CloneProgress {
                    received_objects: received,
                    total_objects: total,
                    received_bytes: stats.received_bytes() as u64,
                    percent: pct,
                    phase,
                },
            );
        }
        true
    });

    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);

    let mut builder = git2::build::RepoBuilder::new();
    builder.fetch_options(fetch_options);

    builder
        .clone(&url, std::path::Path::new(&path))
        .map_err(|e| format!("Clone failed: {}", e))?;

    Ok(path)
}

#[tauri::command]
pub async fn git_status(path: String) -> Result<GitStatus, String> {
    let repo = Repository::open(&path).map_err(|e| format!("Not a git repository: {}", e))?;

    let head = repo.head().map_err(|e| e.to_string())?;
    let branch = head.shorthand().unwrap_or("HEAD").to_string();

    let mut changed_files = Vec::new();
    let statuses = repo.statuses(None).map_err(|e| e.to_string())?;

    for entry in statuses.iter() {
        let status = entry.status();
        let file_path = entry.path().unwrap_or("").to_string();

        if file_path.is_empty() {
            continue;
        }

        let status_str = if status.is_index_new() || status.is_wt_new() {
            "added"
        } else if status.is_index_deleted() || status.is_wt_deleted() {
            "deleted"
        } else if status.is_index_renamed() || status.is_wt_renamed() {
            "renamed"
        } else if status.is_index_modified() || status.is_wt_modified() {
            "modified"
        } else {
            continue;
        };

        changed_files.push(ChangedFile {
            path: file_path,
            status: status_str.to_string(),
        });
    }

    let (ahead, behind) = calculate_ahead_behind(&repo).unwrap_or((0, 0));

    Ok(GitStatus {
        branch,
        ahead,
        behind,
        has_changes: !changed_files.is_empty(),
        changed_files,
    })
}

fn calculate_ahead_behind(repo: &Repository) -> Result<(usize, usize), git2::Error> {
    let head = repo.head()?;
    let local_oid = head
        .target()
        .ok_or_else(|| git2::Error::from_str("No local HEAD target"))?;

    let branch_name = head.shorthand().unwrap_or("main");
    let upstream_name = format!("refs/remotes/origin/{}", branch_name);

    let upstream_ref = match repo.find_reference(&upstream_name) {
        Ok(r) => r,
        Err(_) => return Ok((0, 0)),
    };

    let upstream_oid = upstream_ref
        .target()
        .ok_or_else(|| git2::Error::from_str("No upstream target"))?;

    repo.graph_ahead_behind(local_oid, upstream_oid)
}

#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<String, String> {
    let repo = Repository::open(&path).map_err(|e| e.to_string())?;

    let mut index = repo.index().map_err(|e| e.to_string())?;
    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;

    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;

    let head = repo.head().map_err(|e| e.to_string())?;
    let parent = repo
        .find_commit(head.target().ok_or("No HEAD target")?)
        .map_err(|e| e.to_string())?;

    let sig = repo.signature().map_err(|e| e.to_string())?;

    let commit_id = repo
        .commit(Some("HEAD"), &sig, &sig, &message, &tree, &[&parent])
        .map_err(|e| e.to_string())?;

    Ok(commit_id.to_string())
}

#[tauri::command]
pub async fn git_push(path: String, token: String) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(|e| e.to_string())?;

    let mut remote = repo.find_remote("origin").map_err(|e| e.to_string())?;

    let token_clone = token.clone();
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |_url, _username, _allowed| {
        Cred::userpass_plaintext("x-access-token", &token_clone)
    });

    let mut push_options = PushOptions::new();
    push_options.remote_callbacks(callbacks);

    let head = repo.head().map_err(|e| e.to_string())?;
    let branch = head.shorthand().unwrap_or("main");
    let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);

    remote
        .push(&[&refspec], Some(&mut push_options))
        .map_err(|e| format!("Push failed: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn git_pull(path: String, token: String) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(|e| e.to_string())?;

    let mut remote = repo.find_remote("origin").map_err(|e| e.to_string())?;

    let token_clone = token.clone();
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |_url, _username, _allowed| {
        Cred::userpass_plaintext("x-access-token", &token_clone)
    });

    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);

    let head = repo.head().map_err(|e| e.to_string())?;
    let branch = head.shorthand().unwrap_or("main");

    remote
        .fetch(&[branch], Some(&mut fetch_options), None)
        .map_err(|e| format!("Fetch failed: {}", e))?;

    let fetch_head = repo
        .find_reference("FETCH_HEAD")
        .map_err(|e| e.to_string())?;
    let fetch_commit = repo
        .reference_to_annotated_commit(&fetch_head)
        .map_err(|e| e.to_string())?;

    let (analysis, _) = repo
        .merge_analysis(&[&fetch_commit])
        .map_err(|e| e.to_string())?;

    if analysis.is_fast_forward() {
        let refname = format!("refs/heads/{}", branch);
        let mut reference = repo.find_reference(&refname).map_err(|e| e.to_string())?;
        reference
            .set_target(fetch_commit.id(), "Fast-forward")
            .map_err(|e| e.to_string())?;
        repo.set_head(&refname).map_err(|e| e.to_string())?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn git_is_repo(path: String) -> Result<bool, String> {
    Ok(Repository::open(&path).is_ok())
}
