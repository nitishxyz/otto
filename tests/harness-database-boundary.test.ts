import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');

function runIsolated(source: string): void {
	const result = Bun.spawnSync([process.execPath, '-e', source], {
		cwd: root,
		stdout: 'pipe',
		stderr: 'pipe',
	});
	expect(result.stderr.toString()).toBe('');
	expect(result.exitCode).toBe(0);
}

test('database package has no SDK dependency and preserves root exports', async () => {
	const manifest = await Bun.file(
		join(root, 'packages/database/package.json'),
	).json();
	expect(manifest.dependencies['@ottocode/sdk']).toBeUndefined();
	const database = await import('@ottocode/database');
	for (const name of [
		'getDb',
		'getDbForConfig',
		'getDbByPath',
		'getDbFilePath',
		'dbSchema',
		'setDatabasePathResolver',
	])
		expect(database).toHaveProperty(name);
});

test('standalone database requires explicit resolution without a cwd fallback', () => {
	runIsolated(`
		import { getDb } from '@ottocode/database';
		let rejected = false;
		try { await getDb(); } catch (error) {
			rejected = error.message.includes('registered database path resolver');
		}
		if (!rejected) throw new Error('Expected missing resolver rejection');
	`);
});

test('path core and injected resolver share the same database and marker', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'otto-db-boundary-'));
	try {
		runIsolated(`
			import { Database } from 'bun:sqlite';
			import { getDb, getDbByPath, getDbForConfig, getDbFilePath, setDatabasePathResolver } from '@ottocode/database';
			import { CACHE_USAGE_NORMALIZATION_MARKER } from '@ottocode/database/markers';
			const path = ${JSON.stringify(join(directory, 'database.sqlite'))};
			const direct = await getDbByPath(path);
			setDatabasePathResolver(async (project) => {
				if (project !== 'explicit-project') throw new Error('Project scope changed');
				return path;
			});
			if (await getDb('explicit-project') !== direct) throw new Error('Resolver cache differs');
			if (await getDbForConfig({ paths: { dbPath: path } }) !== direct) throw new Error('Config cache differs');
			if (getDbFilePath(direct) !== path) throw new Error('Worker path differs');
			const sqlite = new Database(path);
			if (!sqlite.query('SELECT name FROM otto_migrations WHERE name = ?').get(CACHE_USAGE_NORMALIZATION_MARKER)) throw new Error('Marker missing');
			sqlite.close();
		`);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('SDK config explicitly registers its existing project path policy', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'otto-db-config-'));
	try {
		runIsolated(`
			import { getDb, getDbFilePath } from '@ottocode/database';
			import { loadConfig, resolveDatabasePath } from '@ottocode/sdk/config';
			const project = ${JSON.stringify(directory)};
			const cfg = await loadConfig(project);
			if (await resolveDatabasePath(project) !== cfg.paths.dbPath) throw new Error('SDK path policy differs');
			if (getDbFilePath(await getDb(project)) !== cfg.paths.dbPath) throw new Error('Compatibility path differs');
		`);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
