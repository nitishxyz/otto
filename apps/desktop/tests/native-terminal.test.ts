import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import {
	calculateNativeTerminalGrid,
	createNativeTerminalOutputBatcher,
	encodeNativeTerminalKeyLocally,
	resolveNativeTerminalShortcut,
	resolveNativeTerminalTheme,
	type NativeTerminalShortcutEvent,
} from '../src/lib/native-terminal';

function shortcutEvent(
	overrides: Partial<NativeTerminalShortcutEvent>,
): NativeTerminalShortcutEvent {
	return {
		code: '',
		key: '',
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		metaKey: false,
		...overrides,
	};
}

describe('native desktop terminal', () => {
	test('computes a positive terminal grid for any visible host', () => {
		expect(calculateNativeTerminalGrid(800, 340)).toEqual({
			cols: 100,
			rows: 20,
		});
		expect(calculateNativeTerminalGrid(0, 0)).toEqual({ cols: 1, rows: 1 });
	});

	test('registers every native terminal lifecycle command', async () => {
		const source = await readFile('src-tauri/src/lib.rs', 'utf8');
		for (const command of [
			'native_terminal_status',
			'native_terminal_create',
			'native_terminal_set_theme',
			'native_terminal_feed',
			'native_terminal_feed_gpu',
			'native_terminal_resize',
			'native_terminal_key',
			'native_terminal_scroll',
			'native_terminal_select',
			'native_terminal_reset',
			'native_terminal_destroy',
			'native_terminal_surface_create',
			'native_terminal_surface_update',
			'native_terminal_surface_set_font',
			'native_terminal_surface_destroy',
		]) {
			expect(source).toContain(`commands::native_terminal::${command}`);
		}
	});

	test('derives terminal colors from the active Otto application theme', () => {
		const dark = resolveNativeTerminalTheme('otto-dark');
		const light = resolveNativeTerminalTheme('otto-light');
		expect(dark.palette).toHaveLength(16);
		expect(light.palette).toHaveLength(16);
		expect(dark.background).not.toEqual(light.background);
		expect(dark.foreground).not.toEqual(light.foreground);
	});

	test('batches startup history but delivers live output immediately', () => {
		const delivered: string[] = [];
		const scheduled = new Map<number, () => void>();
		let nextId = 1;
		const batcher = createNativeTerminalOutputBatcher(
			(data) => delivered.push(data),
			(callback) => {
				const id = nextId++;
				scheduled.set(id, callback);
				return id;
			},
			(id) => scheduled.delete(id),
		);

		batcher.push('old-1');
		batcher.push('old-2');
		expect(delivered).toEqual([]);
		for (const callback of scheduled.values()) callback();
		expect(delivered).toEqual(['old-1old-2']);
		batcher.push('live');
		expect(delivered).toEqual(['old-1old-2', 'live']);
	});

	test('maps standard desktop terminal shortcuts', () => {
		expect(
			resolveNativeTerminalShortcut(
				shortcutEvent({ code: 'ArrowLeft', key: 'ArrowLeft', altKey: true }),
				true,
			),
		).toEqual({ action: 'send', data: '\x1bb' });
		expect(
			resolveNativeTerminalShortcut(
				shortcutEvent({ code: 'Backspace', key: 'Backspace', metaKey: true }),
				true,
			),
		).toEqual({ action: 'send', data: '\x15' });
		expect(
			resolveNativeTerminalShortcut(
				shortcutEvent({ code: 'KeyC', key: 'c', ctrlKey: true }),
				false,
			),
		).toEqual({ action: 'encode' });
		expect(
			resolveNativeTerminalShortcut(
				shortcutEvent({
					code: 'KeyV',
					key: 'v',
					ctrlKey: true,
					shiftKey: true,
				}),
				false,
			),
		).toEqual({ action: 'paste' });
		expect(
			encodeNativeTerminalKeyLocally(shortcutEvent({ code: 'KeyA', key: 'a' })),
		).toBe('a');
		expect(
			encodeNativeTerminalKeyLocally(
				shortcutEvent({ code: 'KeyC', key: 'c', ctrlKey: true }),
			),
		).toBe('\x03');
	});

	test('prepares the macOS surface on main without blocking GPU startup', async () => {
		const [commands, gpu, viewer] = await Promise.all([
			readFile('src-tauri/src/commands/native_terminal.rs', 'utf8'),
			readFile('src-tauri/src/commands/native_terminal/gpu.rs', 'utf8'),
			readFile('src/components/terminal/NativeTerminalViewer.tsx', 'utf8'),
		]);
		expect(commands).toContain('pub async fn native_terminal_surface_create(');
		expect(gpu).toContain('run_on_main_thread');
		expect(gpu).toContain('let renderer = prepared.finish(app).await?');
		expect(gpu).toContain('if self.render_latest(&session_id)');
		expect(gpu).toContain('did not present its initial frame');
		expect(gpu).toContain('surface.window.hide()');
		expect(gpu).toContain('NSWindowCollectionBehavior::Transient');
		expect(gpu).toContain('NSWindowCollectionBehavior::IgnoresCycle');
		expect(gpu).toContain('setExcludedFromWindowsMenu(true)');
		expect(viewer).toContain('createNativeTerminalOutputBatcher');
		expect(viewer).toContain("searchParams.set('historyMode', 'framed')");
		expect(viewer).toContain('feedNativeTerminalGpu');
		expect(viewer).toContain('hidden: true');
		expect(viewer).toContain('if (!overlayFollowsOwner)');
	});

	test('packages GPU and Nerd Font resources for desktop platforms', async () => {
		const [cargo, tauriConfig] = await Promise.all([
			readFile('src-tauri/Cargo.toml', 'utf8'),
			readFile('src-tauri/tauri.conf.json', 'utf8'),
		]);
		expect(cargo).toContain('wgpu = { version = "30.0.0"');
		expect(cargo).toContain('glyphon = "0.12.0"');
		expect(tauriConfig).toContain('"resources/fonts/*"');
	});

	test('desktop injects the native viewer without changing the web default', async () => {
		const [desktopLayout, sharedPanel, nativeViewer] = await Promise.all([
			readFile('src/components/workspace/DesktopAppLayout.tsx', 'utf8'),
			readFile(
				'../../packages/web-sdk/src/components/terminals/TerminalsPanel.tsx',
				'utf8',
			),
			readFile('src/components/terminal/NativeTerminalViewer.tsx', 'utf8'),
		]);
		expect(desktopLayout).toContain('Viewer={NativeTerminalViewer}');
		expect(desktopLayout).toContain('preserveViewerSessions');
		expect(sharedPanel).toContain('Viewer = TerminalViewer');
		expect(nativeViewer).toContain("NATIVE_FONT_FAMILY = 'JetBrainsMono NF'");
		expect(nativeViewer).not.toContain('usePreferences');
	});
});
