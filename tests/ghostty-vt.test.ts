import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
	GHOSTTY_VT_SHA256,
	GhosttyVtTerminal,
	loadGhosttyVt,
} from '../packages/web-sdk/src/lib/ghostty-vt';
import ghosttyVtMetadata from '../packages/web-sdk/src/assets/ghostty/ghostty-vt.json';

const assetPath = resolve(
	import.meta.dir,
	'../packages/web-sdk/src/assets/ghostty/ghostty-vt.wasm',
);

async function loadPinnedModule() {
	const bytes = await Bun.file(assetPath).arrayBuffer();
	return loadGhosttyVt(bytes);
}

describe('official ghostty-vt wasm', () => {
	test('loads the freestanding pinned module and dynamic type layout', async () => {
		const bytes = await Bun.file(assetPath).arrayBuffer();
		const digest = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
		expect(digest).toBe(GHOSTTY_VT_SHA256);
		expect(digest).toBe(ghosttyVtMetadata.sha256);
		expect(bytes.byteLength).toBe(ghosttyVtMetadata.size);
		const module = await loadGhosttyVt(bytes);
		expect(
			WebAssembly.Module.imports(await WebAssembly.compile(bytes)),
		).toEqual([]);
		expect(module.layout.GhosttyStyle.size).toBeGreaterThan(0);
		expect(module.layout.GhosttyStyle.fields.bold.offset).toBeNumber();
	});

	test('parses text, SGR styles, graphemes, alternate screen, and resize', async () => {
		const terminal = new GhosttyVtTerminal(await loadPinnedModule(), 12, 3);
		try {
			terminal.write('\x1b[1;31mHi\x1b[0m 😀');
			const first = terminal.getLine(0);
			expect(first).not.toBeNull();
			expect(terminal.lineText(0)).toBe('Hi 😀');
			expect((first?.[0]?.flags ?? 0) & 1).toBe(1);
			expect(first?.[0]?.fg_r ?? 0).toBeGreaterThan(first?.[0]?.fg_g ?? 255);
			expect(terminal.getGraphemeString(0, 3)).toBe('😀');

			terminal.write('\x1b[?1049hALT\x1b[?1049l');
			expect(terminal.lineText(0)).toBe('Hi 😀');
			terminal.write(
				Array.from({ length: 10 }, (_, index) => `line ${index}\r\n`).join(''),
			);
			expect(() => terminal.scroll(-2)).not.toThrow();
			terminal.resize(20, 4, 8, 16);
			expect(terminal.getDimensions()).toEqual({ cols: 20, rows: 4 });
		} finally {
			terminal.free();
		}
	});

	test('exposes cursor visibility, blink mode, and DECSCUSR style', async () => {
		const terminal = new GhosttyVtTerminal(await loadPinnedModule(), 20, 5);
		try {
			// DECSCUSR 5 = blinking bar; 2 = steady block.
			terminal.write('\x1b[5 q');
			const bar = terminal.getCursor();
			expect(bar.visible).toBe(true);
			expect(bar.style === 'bar' || bar.style === 'block').toBe(true);
			expect(typeof bar.blinking).toBe('boolean');

			terminal.write('\x1b[2 q');
			const block = terminal.getCursor();
			expect(block.visible).toBe(true);
			expect(block.style).toBe('block');
		} finally {
			terminal.free();
		}
	});
});
