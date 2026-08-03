import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

describe('native browser window scoping', () => {
	test('webview labels and lookups include the owner window label', async () => {
		const source = await readFile(
			'src-tauri/src/commands/native_browser.rs',
			'utf8',
		);

		expect(source).toContain(
			'fn label_prefix_for_browser_tab(window_label: &str, id: &str) -> String {',
		);
		expect(source).toContain(
			'format!("browser_{}__{}__", safe_id(window_label), safe_id(id))',
		);
		expect(source).toContain('label_for_browser_tab(window.label(), &id)');
		expect(source).toContain(
			'label_prefix_for_browser_tab(window.label(), &id)',
		);
	});

	test('navigation events are emitted only to the owner window', async () => {
		const source = await readFile(
			'src-tauri/src/commands/native_browser.rs',
			'utf8',
		);

		expect(source).toContain('let event_target = window.label().to_string();');
		expect(source).toContain('event_window.emit_to(');
		expect(source).not.toContain('event_window.emit(');
	});

	test('the bridge listens for navigation scoped to this window and registers once', async () => {
		const source = await readFile('src/lib/native-browser.ts', 'utf8');

		expect(source).toContain('if (win.OTTO_NATIVE_BROWSER) return;');
		expect(source).toContain('{ target: getCurrentWindow().label }');
	});

	test('macOS browser tabs identify as Safari instead of a generic webview', async () => {
		const source = await readFile(
			'src-tauri/src/commands/native_browser.rs',
			'utf8',
		);

		expect(source).toContain('fn macos_browser_user_agent() -> String {');
		expect(source).toContain('.user_agent(&macos_browser_user_agent());');
		expect(source).toContain('Safari/605.1.15');
		expect(source).toContain('.data_store_identifier(*b"otto-browser-v2!")');
		expect(source).not.toContain('needs_webkit_compatibility_user_agent');
		expect(source).toContain('fn remove_initialization_scripts(');
		expect(source).toContain('.removeAllUserScripts();');
		expect(source).toContain(
			'WebviewUrl::External(url::Url::parse("about:blank").unwrap())',
		);
		expect(source).toContain('.navigate(parsed_url)');
	});

	test('the screenshot command is exposed without preloading page instrumentation', async () => {
		const [bridge, backend, registration] = await Promise.all([
			readFile('src/lib/native-browser.ts', 'utf8'),
			readFile('src-tauri/src/commands/native_browser.rs', 'utf8'),
			readFile('src-tauri/src/lib.rs', 'utf8'),
		]);

		expect(bridge).toContain(
			"invoke<string>('native_browser_screenshot', { id })",
		);
		expect(backend).toContain('pub async fn native_browser_screenshot(');
		expect(bridge).not.toContain('initScript: options.initScript');
		expect(backend).not.toContain('builder.initialization_script(script)');
		expect(registration).toContain(
			'commands::native_browser::native_browser_screenshot',
		);
	});

	test('new windows become tabs and downloads are allowed and reported', async () => {
		const [bridge, backend] = await Promise.all([
			readFile('src/lib/native-browser.ts', 'utf8'),
			readFile('src-tauri/src/commands/native_browser.rs', 'utf8'),
		]);

		expect(backend).toContain('.on_new_window(move |url, features|');
		expect(backend).toContain('"native-browser-new-tab"');
		expect(backend).toContain('NewWindowResponse::Deny');
		expect(backend).toContain('if url.scheme() != "about"');
		expect(backend).toContain('WebviewWindowBuilder::new(');
		expect(backend).toContain('NewWindowResponse::Create { window }');
		expect(backend).toContain('.on_download(move |_webview, event|');
		expect(backend).toContain('"native-browser-download"');
		expect(bridge).toContain('subscribeNewTab(id, listener)');
		expect(bridge).toContain('subscribeDownload(id, listener)');
	});
});
