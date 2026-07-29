import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const COMPONENT_ROOT = 'src/components';

async function listTsxFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listTsxFiles(path)));
		} else if (entry.name.endsWith('.tsx')) {
			files.push(path);
		}
	}
	return files;
}

/**
 * Major/full-page loading surfaces: daemon/bootstrap gate, workspace open,
 * and onboarding. These must render the branded OttoRouterLoader (the square
 * Otto wordmark inside the existing spinning ring), never StableSpinner.
 */
const MAJOR_LOADER_SITES = [
	'src/router.tsx',
	'src/components/Workspace.tsx',
	'src/components/onboarding/NativeOnboarding.tsx',
];

/**
 * Compact loading surfaces (buttons, badges, inline list/status rows,
 * modal steps). These must use the shared StableSpinner, never the branded
 * full-page loader.
 */
const COMPACT_SPINNER_CONSUMERS = [
	'src/components/OttoRouterAccountControl.tsx',
	'src/components/MachineLauncher.tsx',
	'src/components/LocalTunnelPanel.tsx',
	'src/components/ConnectedProjectPicker.tsx',
	'src/components/ProjectPicker.tsx',
	'src/components/CloneModal.tsx',
	'src/components/DeviceCodeModal.tsx',
];

describe('desktop loading UI standardization', () => {
	test('major full-page loaders use the branded OttoRouterLoader', async () => {
		for (const path of MAJOR_LOADER_SITES) {
			const source = await readFile(path, 'utf8');
			expect(source).toContain('OttoRouterLoader');
			// Full-page loading never falls back to the compact spinner.
			expect(source).not.toContain('StableSpinner');
		}
	});

	test('the branded loader uses the square Otto wordmark inside its ring', async () => {
		const loader = await readFile(
			'src/components/OttoRouterLoader.tsx',
			'utf8',
		);
		expect(loader).toContain('/otto-wordmark-1x1.png');
		expect(loader).toContain('otto-wordmark-loader');
		expect(loader).toContain('ottorouter-loader-ring');
		expect(loader).toContain('aria-busy');
		expect(loader).toContain("aria-label={label ?? 'Loading'}");
		expect(loader).not.toContain('StableSpinner');

		const css = await readFile('src/index.css', 'utf8');
		expect(css).toContain('.otto-wordmark-loader');
		expect(css).toContain('.ottorouter-loader-ring');
		expect(css).toContain('@keyframes ottorouter-spin');
		expect(css).toContain('prefers-reduced-motion: reduce');
	});

	test('compact loading states use the shared StableSpinner', async () => {
		for (const path of COMPACT_SPINNER_CONSUMERS) {
			const source = await readFile(path, 'utf8');
			expect(source).toContain('StableSpinner');
			// Compact surfaces never mount the full-page branded loader.
			expect(source).not.toContain('OttoRouterLoader');
		}
	});

	test('no bespoke spin/pulse loaders remain in desktop components', async () => {
		for (const path of await listTsxFiles(COMPONENT_ROOT)) {
			const source = await readFile(path, 'utf8');
			expect(source).not.toContain('animate-spin');
			expect(source).not.toContain('animate-pulse');
			expect(source).not.toContain('border-t-foreground rounded-full');
		}
	});
});
