import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

const LIB_RS = 'src-tauri/src/lib.rs';
const CLAIM_RS = 'src-tauri/src/startup_target.rs';

describe('CLI startup target survives repeated initialization', () => {
	test('the startup commands claim per window instead of consuming', async () => {
		const source = await readFile(LIB_RS, 'utf8');

		// React StrictMode double-invokes the desktop init effect in development,
		// and a webview reload re-runs it. A consuming read handed the CLI project
		// to the throwaway first pass, so the committed pass saw "no project" and
		// the window stayed on the picker.
		expect(source).not.toContain('.take()');

		expect(source).toContain(
			'fn get_initial_project(\n    window: WebviewWindow,',
		);
		expect(source).toContain(
			'fn get_initial_remote(\n    window: WebviewWindow,',
		);
		expect(source).toContain('state.0.claim_for(window.label())');
	});

	test('the claim is keyed by window label so new windows stay isolated', async () => {
		const source = await readFile(CLAIM_RS, 'utf8');

		expect(source).toContain(
			'pub fn claim_for(&self, window_label: &str) -> Option<T> {',
		);
		// First asker claims; the owner replays; everyone else gets None.
		expect(source).toContain(
			'state.claimed_by = Some(window_label.to_string());',
		);
		expect(source).toContain(
			'Some(owner) if owner == window_label => Some(value),',
		);
		expect(source).toContain('Some(_) => None,');
	});

	test('startup state is registered as a claimable target', async () => {
		const source = await readFile(LIB_RS, 'utf8');

		expect(source).toContain(
			'pub struct InitialProjectState(pub StartupTarget<String>);',
		);
		expect(source).toContain(
			'pub struct InitialRemoteState(pub StartupTarget<(String, String)>);',
		);
		expect(source).toContain(
			'.manage(InitialProjectState(StartupTarget::new(initial_project)))',
		);
		expect(source).toContain(
			'.manage(InitialRemoteState(StartupTarget::new(initial_remote)))',
		);
	});

	test('a remote without an explicit name still defaults its label', async () => {
		const source = await readFile(LIB_RS, 'utf8');

		// Previously defaulted inside the command; normalizing at construction
		// keeps the claimed value a single ready-to-use pair.
		expect(source).toContain(
			'.map(|url| (url, initial_remote_name.unwrap_or_else(|| "Remote".to_string())));',
		);
	});

	test('the renderer contract is unchanged and still reads on init', async () => {
		const [bridge, app] = await Promise.all([
			readFile('src/lib/tauri-bridge.ts', 'utf8'),
			readFile('src/App.tsx', 'utf8'),
		]);

		// The window is injected by Tauri, so the invoke signature takes no args.
		expect(bridge).toContain(
			"getInitialProject: () => invoke<string | null>('get_initial_project')",
		);
		expect(bridge).toContain(
			"getInitialRemote: () => invoke<[string, string] | null>('get_initial_remote')",
		);
		expect(app).toContain('tauriBridge.getInitialProject()');
		expect(app).toContain('tauriBridge.getInitialRemote()');
	});

	test('repeated init passes converge on one project open', async () => {
		const [app, router] = await Promise.all([
			readFile('src/App.tsx', 'utf8'),
			readFile('src/router.tsx', 'utf8'),
		]);

		// Both StrictMode passes now resolve the same project, so navigation has
		// to replace rather than push, and the workspace has to stay keyed by a
		// value that is identical across passes or it would remount.
		expect(app).toContain(
			'await router.navigate({ to: nextRoute, replace: true });',
		);
		expect(router).toContain('key={selectedProject.path}');
	});
});
