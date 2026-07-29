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
});
