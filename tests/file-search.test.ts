import { describe, expect, it } from 'bun:test';
import { fuzzyMatchFilePath } from '@ottocode/sdk/search/file-rank';

describe('file search ranking', () => {
	it('ranks exact filenames above fuzzy path matches', () => {
		const exact = fuzzyMatchFilePath(
			'catalog.ts',
			'packages/sdk/src/providers/src/catalog.ts',
		);
		const loose = fuzzyMatchFilePath(
			'catalog.ts',
			'tests/ottorouter-catalog.test.ts',
		);

		expect(exact.match).toBe(true);
		expect(loose.match).toBe(true);
		expect(exact.score).toBeGreaterThan(loose.score);
	});

	it('respects explicit file extensions', () => {
		expect(
			fuzzyMatchFilePath(
				'catalog.ts',
				'apps/mobile/src/components/ui/update-dialog.tsx',
			).match,
		).toBe(false);
		expect(
			fuzzyMatchFilePath('catalog.ts', 'scripts/update-catalog.ts').match,
		).toBe(true);
	});

	it('supports fuzzy filename matches without broad path noise', () => {
		expect(
			fuzzyMatchFilePath(
				'confdiag',
				'packages/web-sdk/src/components/ui/ConfirmationDialog.tsx',
			).match,
		).toBe(true);
		expect(
			fuzzyMatchFilePath(
				'catalog',
				'apps/mobile/src/components/ui/update-dialog.tsx',
			).match,
		).toBe(false);
	});
});
