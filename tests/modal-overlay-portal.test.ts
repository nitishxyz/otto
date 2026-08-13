import { describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const WEB_SDK = 'packages/web-sdk/src/components';

async function collectTsx(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...(await collectTsx(path)));
		else if (entry.name.endsWith('.tsx')) files.push(path);
	}
	return files;
}

describe('viewport overlay containing block', () => {
	test('OverlayPortal mounts overlay content on document.body', async () => {
		const source = await Bun.file(`${WEB_SDK}/ui/OverlayPortal.tsx`).text();

		expect(source).toContain('createPortal(children, document.body)');
		expect(source).toContain("typeof document === 'undefined'");
	});

	test('Modal portals its fixed overlay out of the tree', async () => {
		const source = await Bun.file(`${WEB_SDK}/ui/Modal.tsx`).text();

		expect(source).toContain("import { OverlayPortal } from './OverlayPortal'");
		expect(source).toContain('<OverlayPortal>{overlay}</OverlayPortal>');
		// The opt-in `absolute` variant is scoped to its container by design.
		expect(source).toContain("if (position === 'absolute') return overlay;");
	});

	test('thread rows never render an unportalled full-screen overlay', async () => {
		// Thread rows live inside `@legendapp/list` item containers, which set
		// `contain: paint layout style` and therefore become the containing block
		// for `position: fixed` descendants.
		const files = await collectTsx(`${WEB_SDK}/messages`);
		const offenders: string[] = [];

		for (const file of files) {
			const source = await Bun.file(file).text();
			if (!source.includes('fixed inset-0')) continue;
			if (source.includes('OverlayPortal') || source.includes('createPortal('))
				continue;
			offenders.push(file);
		}

		expect(offenders).toEqual([]);
	});
});
