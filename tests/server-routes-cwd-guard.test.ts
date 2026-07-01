import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function routeFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			files.push(...routeFiles(path));
		} else if (path.endsWith('.ts')) {
			files.push(path);
		}
	}
	return files;
}

describe('server route project context guard', () => {
	it('keeps process.cwd fallback centralized in project-context resolver', () => {
		const routesRoot = 'packages/server/src/routes';
		const offenders = routeFiles(routesRoot)
			.filter((path) => !path.endsWith('project-context.ts'))
			.filter((path) => readFileSync(path, 'utf8').includes('process.cwd()'))
			.map((path) => relative('.', path));

		expect(offenders).toEqual([]);
	});
});
