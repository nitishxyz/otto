import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

describe('desktop close menu window scoping', () => {
	test('only the focused target window handles a viewer close request', async () => {
		const [hook, backend] = await Promise.all([
			readFile('src/hooks/useMenuCloseWindow.ts', 'utf8'),
			readFile('src-tauri/src/lib.rs', 'utf8'),
		]);

		expect(backend).toContain(
			'app.emit_to(window.label(), "menu-close-request", ())',
		);
		expect(hook).toContain('const currentWindow = getCurrentWindow();');
		expect(hook).toContain('{ target: currentWindow.label }');
		expect(hook).toContain('void currentWindow.close()');
	});
});
