import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useOverlayStore } from '../apps/tui/src/stores/overlay.ts';

describe('TUI error routing', () => {
	beforeEach(() => {
		useOverlayStore.getState().cleanup();
		useOverlayStore.setState({
			status: { type: 'idle' },
			_statusTimer: null,
		});
	});

	afterEach(() => useOverlayStore.getState().cleanup());

	test('composer status ignores errors and clears an existing status', () => {
		const store = useOverlayStore.getState();
		store.showStatus({ type: 'loading', label: 'working' });
		expect(useOverlayStore.getState().status).toEqual({
			type: 'loading',
			label: 'working',
		});

		store.showStatus({ type: 'error', label: 'request failed' }, 5000);

		expect(useOverlayStore.getState().status).toEqual({ type: 'idle' });
		expect(useOverlayStore.getState()._statusTimer).toBeNull();
	});

	test('only the dimensions provider subscribes to OpenTUI resize state', async () => {
		const sourceRoot = join(import.meta.dir, '../apps/tui');
		const sourceFiles = await Array.fromAsync(
			new Bun.Glob('**/*.{ts,tsx}').scan({ cwd: sourceRoot }),
		);
		const directImports: string[] = [];
		for (const file of sourceFiles) {
			const source = await readFile(join(sourceRoot, file), 'utf8');
			if (
				source.includes("from '@opentui/react'") &&
				source.includes('useTerminalDimensions')
			) {
				directImports.push(file);
			}
		}

		expect(directImports.sort()).toEqual(['src/terminal-dimensions.tsx']);
	});
});
