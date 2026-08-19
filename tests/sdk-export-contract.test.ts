import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type ExportTarget = string | Record<string, string>;

const sdkDirectory = join(import.meta.dir, '..', 'packages', 'sdk');

function packageSpecifier(exportPath: string): string {
	return exportPath === '.'
		? '@ottocode/sdk'
		: `@ottocode/sdk${exportPath.slice(1)}`;
}

describe('@ottocode/sdk export contract', () => {
	test('every local export target exists and imports through Bun', async () => {
		const packageJson = JSON.parse(
			await readFile(join(sdkDirectory, 'package.json'), 'utf8'),
		) as { exports: Record<string, ExportTarget> };

		for (const [exportPath, targetValue] of Object.entries(
			packageJson.exports,
		)) {
			const targets =
				typeof targetValue === 'string'
					? [targetValue]
					: [...new Set(Object.values(targetValue))];

			for (const target of targets) {
				expect(target.startsWith('./')).toBe(true);

				if (!target.includes('*')) {
					expect(existsSync(join(sdkDirectory, target))).toBe(true);
					await import(packageSpecifier(exportPath));
					continue;
				}

				const [targetPrefix, targetSuffix = ''] = target.split('*');
				const [exportPrefix, exportSuffix = ''] = exportPath.split('*');
				const matches = Array.from(
					new Bun.Glob(target.slice(2)).scanSync({
						cwd: sdkDirectory,
						onlyFiles: true,
					}),
				);
				expect(matches.length).toBeGreaterThan(0);

				for (const match of matches) {
					const localTarget = `./${match}`;
					const wildcardValue = localTarget.slice(
						targetPrefix.length,
						targetSuffix ? -targetSuffix.length : undefined,
					);
					const resolvedExport = `${exportPrefix}${wildcardValue}${exportSuffix}`;
					await import(packageSpecifier(resolvedExport));
				}
			}
		}
	});
});
