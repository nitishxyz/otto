use std::sync::Mutex;

/// A CLI startup value handed to exactly one window, replayable for that window.
///
/// The CLI can launch the app with `--project` / `--remote`, and the renderer
/// asks for that target while it boots. Consuming the value on the first read
/// looks right but is wrong: a window's initialization effect can run more than
/// once (React StrictMode double-invokes effects in development, and a webview
/// reload re-runs it). A consuming read hands the target to the throwaway first
/// pass, so the pass that actually commits sees "no project" and the window
/// stays on the picker.
///
/// Instead, the first window to ask *claims* the value and may then read it as
/// often as it likes, while every other window still gets `None` so windows
/// opened later never inherit the CLI target.
pub struct StartupTarget<T> {
    state: Mutex<ClaimState<T>>,
}

struct ClaimState<T> {
    value: Option<T>,
    claimed_by: Option<String>,
}

impl<T: Clone> StartupTarget<T> {
    pub fn new(value: Option<T>) -> Self {
        Self {
            state: Mutex::new(ClaimState {
                value,
                claimed_by: None,
            }),
        }
    }

    /// Returns the startup target for `window_label`.
    ///
    /// The first window to ask claims it and keeps receiving it on every later
    /// call; any other window gets `None`.
    pub fn claim_for(&self, window_label: &str) -> Option<T> {
        // A poisoned lock still holds valid claim state, and dropping the CLI
        // target would strand the window on the picker, so recover instead.
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        // Nothing was requested on the command line; never record a claim.
        let value = state.value.clone()?;

        match state.claimed_by.as_deref() {
            None => {
                state.claimed_by = Some(window_label.to_string());
                Some(value)
            }
            Some(owner) if owner == window_label => Some(value),
            Some(_) => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::StartupTarget;

    #[test]
    fn repeated_reads_from_the_claiming_window_return_the_same_target() {
        // React StrictMode double-invokes the desktop init effect in dev, so the
        // second pass must still see the CLI project; a consuming read left it
        // on the project picker instead.
        let target = StartupTarget::new(Some("/tmp/project".to_string()));

        assert_eq!(target.claim_for("main").as_deref(), Some("/tmp/project"));
        assert_eq!(target.claim_for("main").as_deref(), Some("/tmp/project"));
        assert_eq!(target.claim_for("main").as_deref(), Some("/tmp/project"));
    }

    #[test]
    fn other_windows_never_inherit_the_cli_target() {
        let target = StartupTarget::new(Some("/tmp/project".to_string()));

        assert_eq!(target.claim_for("main").as_deref(), Some("/tmp/project"));
        assert_eq!(target.claim_for("main-1"), None);
        assert_eq!(target.claim_for("machine-abc-2"), None);
        // The owner still replays after other windows have asked.
        assert_eq!(target.claim_for("main").as_deref(), Some("/tmp/project"));
    }

    #[test]
    fn the_first_window_to_ask_claims_the_target() {
        let target = StartupTarget::new(Some("/tmp/project".to_string()));

        assert_eq!(target.claim_for("main-2").as_deref(), Some("/tmp/project"));
        assert_eq!(target.claim_for("main"), None);
    }

    #[test]
    fn a_missing_cli_target_is_never_claimed() {
        let target: StartupTarget<String> = StartupTarget::new(None);

        assert_eq!(target.claim_for("main"), None);
        assert_eq!(target.claim_for("main-1"), None);
    }

    #[test]
    fn remote_targets_replay_as_a_url_and_name_pair() {
        let target = StartupTarget::new(Some((
            "https://example.test".to_string(),
            "Studio".to_string(),
        )));

        let first = target.claim_for("main");
        assert_eq!(
            first,
            Some((
                "https://example.test".to_string(),
                "Studio".to_string()
            ))
        );
        assert_eq!(target.claim_for("main"), first);
        assert_eq!(target.claim_for("main-1"), None);
    }
}
