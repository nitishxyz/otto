import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

type ExportTarget =
	| string
	| null
	| { [condition: string]: ExportTarget }
	| ExportTarget[];

function targets(value: ExportTarget): string[] {
	if (value === null) return [];
	if (typeof value === 'string') return [value];
	return Object.values(value).flatMap(targets);
}

const root = resolve(import.meta.dir, '..');

test('every published workspace package export target exists and resolves', async () => {
	for (const manifest of new Bun.Glob(
		'{packages,apps}/*/package.json',
	).scanSync({ cwd: root, onlyFiles: true })) {
		const directory = join(root, dirname(manifest));
		const pkg = JSON.parse(await readFile(join(root, manifest), 'utf8')) as {
			private?: boolean;
			name: string;
			exports?: Record<string, ExportTarget>;
		};
		if (pkg.private || !pkg.exports) continue;
		for (const [exportPath, value] of Object.entries(pkg.exports)) {
			for (const target of new Set(targets(value))) {
				expect(target.startsWith('./')).toBe(true);
				if (!target.includes('*')) {
					expect(existsSync(join(directory, target))).toBe(true);
					expect(
						Bun.resolveSync(
							`${pkg.name}${exportPath === '.' ? '' : exportPath.slice(1)}`,
							root,
						),
					).toBeTruthy();
					continue;
				}
				const matches = Array.from(
					new Bun.Glob(target.slice(2)).scanSync({
						cwd: directory,
						onlyFiles: true,
					}),
				);
				expect(matches.length).toBeGreaterThan(0);
				const [prefix, suffix = ''] = target.split('*');
				for (const match of matches) {
					const wildcard = `./${match}`.slice(
						prefix.length,
						suffix ? -suffix.length : undefined,
					);
					const specifier = `${pkg.name}${exportPath.slice(1).replace('*', wildcard)}`;
					expect(Bun.resolveSync(specifier, root)).toBeTruthy();
				}
			}
		}
	}
});
