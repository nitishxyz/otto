import { execFile } from 'node:child_process';
import { Database } from 'bun:sqlite';
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { describe, expect, it } from 'bun:test';
import {
	formatProjectStateMigrationReport,
	formatStoragePlan,
	migrateProjectStateStorage,
	migrateStorage,
	planStorageMigration,
} from '../apps/cli/src/storage.ts';
import { getProjectStateDir } from '@ottocode/sdk';

const execFileAsync = promisify(execFile);

async function withProject(
	prefix: string,
	fn: (projectRoot: string, ottoHome: string) => Promise<void>,
) {
	const projectRoot = await mkdtemp(join(tmpdir(), prefix));
	const previousOttoHome = process.env.OTTO_HOME;
	const ottoHome = join(projectRoot, 'otto-home');
	process.env.OTTO_HOME = ottoHome;
	try {
		await fn(projectRoot, ottoHome);
	} finally {
		if (previousOttoHome === undefined) {
			delete process.env.OTTO_HOME;
		} else {
			process.env.OTTO_HOME = previousOttoHome;
		}
		await rm(projectRoot, { recursive: true, force: true });
	}
}

async function writeLegacySqlite(projectRoot: string) {
	const legacyDir = join(projectRoot, '.otto');
	await mkdir(legacyDir, { recursive: true });
	await writeFile(join(legacyDir, 'otto.sqlite'), 'main-db');
	await writeFile(join(legacyDir, 'otto.sqlite-wal'), 'wal-db');
	await writeFile(join(legacyDir, 'otto.sqlite-shm'), 'shm-db');
	return legacyDir;
}

async function writeLegacyAttachment(projectRoot: string) {
	const attachmentDir = join(projectRoot, '.otto', 'attachments', 'att_legacy');
	await mkdir(attachmentDir, { recursive: true });
	await writeFile(join(attachmentDir, 'original.txt'), 'legacy attachment');
	await writeFile(
		join(attachmentDir, 'metadata.json'),
		JSON.stringify(
			{
				id: 'att_legacy',
				filename: 'legacy.txt',
				mimeType: 'text/plain',
				size: 17,
				sha256: 'legacy-sha',
				kind: 'text',
				originalPath: '.otto/attachments/att_legacy/original.txt',
				createdAt: new Date().toISOString(),
			},
			null,
			2,
		),
	);
	return attachmentDir;
}

async function writeLegacyRuntimeDirs(projectRoot: string) {
	const legacyDir = join(projectRoot, '.otto');
	for (const dir of ['debug', 'debug-dumps', 'logs', 'tmp', 'cache']) {
		await mkdir(join(legacyDir, dir), { recursive: true });
		await writeFile(join(legacyDir, dir, `${dir}.txt`), dir);
	}
	return legacyDir;
}

async function writeProjectStateDir(
	stateDir: string,
	projectRoot: string,
	sessionIds: string[],
) {
	await mkdir(stateDir, { recursive: true });
	await writeFile(
		join(stateDir, 'project.json'),
		`${JSON.stringify(
			{
				id: stateDir.split('/').at(-1),
				name: projectRoot.split('/').at(-1),
				root: projectRoot,
				createdAt: new Date().toISOString(),
				lastSeenAt: new Date().toISOString(),
			},
			null,
			2,
		)}\n`,
	);
	const db = new Database(join(stateDir, 'otto.sqlite'), { create: true });
	try {
		db.exec(
			'CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL, project_path TEXT NOT NULL)',
		);
		const insert = db.query(
			'INSERT INTO sessions (id, project_path) VALUES (?, ?)',
		);
		for (const sessionId of sessionIds) insert.run(sessionId, projectRoot);
	} finally {
		db.close();
	}
}

function readSessionIds(stateDir: string): string[] {
	const db = new Database(join(stateDir, 'otto.sqlite'), { readonly: true });
	try {
		return (
			db.query('SELECT id FROM sessions ORDER BY id').all() as Array<{
				id: string;
			}>
		).map((row) => row.id);
	} finally {
		db.close();
	}
}

describe('project state ID migration', () => {
	it('moves old state dirs into path-based project IDs', async () => {
		await withProject('otto-state-move-', async (projectRoot, ottoHome) => {
			const oldStateDir = join(ottoHome, 'projects', 'example-aaaaaaaa');
			const targetStateDir = await getProjectStateDir(projectRoot);
			await writeProjectStateDir(oldStateDir, projectRoot, ['old-session']);

			const dryRun = await migrateProjectStateStorage({ dryRun: true });

			expect(
				dryRun.items.some(
					(item) => item.from === oldStateDir && item.status === 'would-move',
				),
			).toBe(true);
			expect(await Bun.file(targetStateDir).exists()).toBe(false);

			const result = await migrateProjectStateStorage();

			expect(
				result.items.some(
					(item) => item.from === oldStateDir && item.status === 'moved',
				),
			).toBe(true);
			expect(await Bun.file(oldStateDir).exists()).toBe(false);
			expect(readSessionIds(targetStateDir)).toEqual(['old-session']);
			const output = formatProjectStateMigrationReport(result);
			expect(output).toContain('Moved: 1');
		});
	});

	it('merges old state dirs when the path-based target already exists', async () => {
		await withProject('otto-state-merge-', async (projectRoot, ottoHome) => {
			const oldStateDir = join(ottoHome, 'projects', 'example-bbbbbbbb');
			const targetStateDir = await getProjectStateDir(projectRoot);
			await writeProjectStateDir(oldStateDir, projectRoot, ['source-session']);
			await writeProjectStateDir(targetStateDir, projectRoot, [
				'target-session',
			]);
			await mkdir(join(oldStateDir, 'attachments', 'att_source'), {
				recursive: true,
			});
			await writeFile(
				join(oldStateDir, 'attachments', 'att_source', 'original.txt'),
				'source attachment',
			);

			const result = await migrateProjectStateStorage();

			expect(
				result.items.some(
					(item) => item.from === oldStateDir && item.status === 'merged',
				),
			).toBe(true);
			expect(await Bun.file(oldStateDir).exists()).toBe(false);
			expect(readSessionIds(targetStateDir)).toEqual([
				'source-session',
				'target-session',
			]);
			expect(
				await readFile(
					join(targetStateDir, 'attachments', 'att_source', 'original.txt'),
					'utf8',
				),
			).toBe('source attachment');
			expect(
				result.items.find((item) => item.from === oldStateDir)?.archiveDir,
			).toContain('migrated-projects');
		});
	});
});

describe('storage SQLite migration', () => {
	it('plans SQLite migration without touching state files', async () => {
		await withProject('otto-storage-plan-', async (projectRoot, ottoHome) => {
			await writeLegacySqlite(projectRoot);

			const plan = await planStorageMigration({ projectRoot });

			expect(plan.legacySqliteFound).toBe(true);
			expect(plan.migrationRecommended).toBe(true);
			expect(plan.stateDir.startsWith(join(ottoHome, 'projects'))).toBe(true);
			expect(
				plan.items
					.filter((item) => item.kind === 'sqlite')
					.map((item) => item.status),
			).toEqual(['would-copy', 'would-copy', 'would-copy']);
			expect(await Bun.file(plan.projectJsonPath).exists()).toBe(false);
			expect(await Bun.file(plan.migrationJsonPath).exists()).toBe(false);
			expect(await Bun.file(plan.dbPath).exists()).toBe(false);
		});
	});

	it('formats already-migrated SQLite output without noisy paths', async () => {
		await withProject('otto-storage-clean-existing-', async (projectRoot) => {
			await writeLegacySqlite(projectRoot);
			const initialPlan = await planStorageMigration({ projectRoot });
			await mkdir(initialPlan.stateDir, { recursive: true });
			await writeFile(initialPlan.dbPath, 'existing-db');
			await writeFile(
				join(initialPlan.stateDir, 'otto.sqlite-wal'),
				'existing-wal',
			);
			await writeFile(
				join(initialPlan.stateDir, 'otto.sqlite-shm'),
				'existing-shm',
			);

			const output = formatStoragePlan(
				await planStorageMigration({ projectRoot }),
			);

			expect(output).toContain(
				'SQLite: already migrated (3 files already exist)',
			);
			expect(output).toContain(
				'Target database already exists; run otto storage migrate --force to overwrite with legacy data.',
			);
			expect(output).toContain('Attachments: none found in legacy .otto');
			expect(output).toContain('Runtime dirs: none found in legacy .otto');
			expect(output).toContain('Status: nothing to migrate');
			expect(output).not.toContain(' -> ');
			expect(output).not.toContain('otto.sqlite: already-exists');
		});
	});

	it('formats present migration items concisely', async () => {
		await withProject('otto-storage-clean-plan-', async (projectRoot) => {
			await writeLegacySqlite(projectRoot);
			await writeLegacyAttachment(projectRoot);
			await writeLegacyRuntimeDirs(projectRoot);

			const output = formatStoragePlan(
				await planStorageMigration({ projectRoot }),
			);

			expect(output).toContain('SQLite:\n  - would copy otto.sqlite');
			expect(output).toContain('  - would copy otto.sqlite-wal');
			expect(output).toContain('Attachments: would copy legacy attachments');
			expect(output).toContain('Runtime dirs:\n  - would copy debug');
			expect(output).toContain('Status: migration recommended');
			expect(output).not.toContain(' -> ');
			expect(output).not.toContain('missing');
		});
	});

	it('uses current working directory as implicit project root from subdirectories', async () => {
		await withProject(
			'otto-storage-cwd-root-',
			async (projectRoot, ottoHome) => {
				await execFileAsync('git', ['init'], { cwd: projectRoot });
				const subdir = join(projectRoot, 'apps', 'canvas');
				await mkdir(subdir, { recursive: true });
				const realSubdir = await realpath(subdir);
				const previousCwd = process.cwd();
				process.chdir(subdir);

				try {
					const implicitPlan = await planStorageMigration();
					const explicitPlan = await planStorageMigration({
						projectRoot: subdir,
					});

					expect(implicitPlan.projectRoot).toBe(realSubdir);
					expect(
						implicitPlan.stateDir.startsWith(join(ottoHome, 'projects')),
					).toBe(true);
					expect(explicitPlan.projectRoot).toBe(realSubdir);
					expect(explicitPlan.stateDir).toBe(implicitPlan.stateDir);
				} finally {
					process.chdir(previousCwd);
				}
			},
		);
	});

	it('plans attachment migration without touching state files', async () => {
		await withProject('otto-storage-attachment-plan-', async (projectRoot) => {
			await writeLegacyAttachment(projectRoot);

			const plan = await planStorageMigration({ projectRoot });
			const attachmentItem = plan.items.find(
				(item) => item.kind === 'attachments',
			);

			expect(plan.legacyAttachmentsFound).toBe(true);
			expect(attachmentItem?.status).toBe('would-copy');
			expect(await Bun.file(plan.attachmentsDir).exists()).toBe(false);
			expect(await Bun.file(plan.projectJsonPath).exists()).toBe(false);
		});
	});

	it('copies attachments and preserves legacy attachments by default', async () => {
		await withProject('otto-storage-attachment-copy-', async (projectRoot) => {
			const legacyAttachmentDir = await writeLegacyAttachment(projectRoot);

			const result = await migrateStorage({ projectRoot });

			expect(
				await readFile(
					join(result.attachmentsDir, 'att_legacy', 'original.txt'),
					'utf8',
				),
			).toBe('legacy attachment');
			expect(
				await Bun.file(join(legacyAttachmentDir, 'original.txt')).exists(),
			).toBe(true);
			expect(
				result.items.some(
					(item) => item.kind === 'attachments' && item.status === 'copied',
				),
			).toBe(true);
		});
	});

	it('deletes only legacy attachments when requested after copy', async () => {
		await withProject(
			'otto-storage-attachment-delete-',
			async (projectRoot) => {
				const legacyAttachmentDir = await writeLegacyAttachment(projectRoot);
				const legacyDir = join(projectRoot, '.otto');
				await writeFile(join(legacyDir, 'config.json'), '{}');

				const result = await migrateStorage({
					projectRoot,
					deleteLegacy: true,
				});

				expect(
					await readFile(
						join(result.attachmentsDir, 'att_legacy', 'original.txt'),
						'utf8',
					),
				).toBe('legacy attachment');
				expect(await Bun.file(legacyAttachmentDir).exists()).toBe(false);
				expect(await Bun.file(join(legacyDir, 'config.json')).exists()).toBe(
					true,
				);
				expect(
					result.items.some(
						(item) => item.kind === 'attachments' && item.status === 'deleted',
					),
				).toBe(true);
			},
		);
	});

	it('dry-run migration does not touch files', async () => {
		await withProject('otto-storage-dry-run-', async (projectRoot) => {
			await writeLegacySqlite(projectRoot);

			const plan = await migrateStorage({ projectRoot, dryRun: true });

			expect(plan.items[0]?.status).toBe('would-copy');
			expect(await Bun.file(plan.projectJsonPath).exists()).toBe(false);
			expect(await Bun.file(plan.migrationJsonPath).exists()).toBe(false);
			expect(await Bun.file(plan.dbPath).exists()).toBe(false);
		});
	});

	it('plans runtime directory migration without touching state files', async () => {
		await withProject('otto-storage-runtime-plan-', async (projectRoot) => {
			await writeLegacyRuntimeDirs(projectRoot);

			const plan = await planStorageMigration({ projectRoot });

			expect(plan.legacyRuntimeDirsFound).toBe(true);
			expect(
				plan.items
					.filter((item) => item.kind === 'runtime-dir')
					.map((item) => item.status),
			).toEqual([
				'would-copy',
				'would-copy',
				'would-copy',
				'would-copy',
				'would-copy',
			]);
			expect(await Bun.file(plan.debugDir).exists()).toBe(false);
			expect(await Bun.file(plan.debugDumpsDir).exists()).toBe(false);
			expect(await Bun.file(plan.logsDir).exists()).toBe(false);
			expect(await Bun.file(plan.tmpDir).exists()).toBe(false);
			expect(await Bun.file(plan.cacheDir).exists()).toBe(false);
		});
	});

	it('copies runtime directories and preserves legacy by default', async () => {
		await withProject('otto-storage-runtime-copy-', async (projectRoot) => {
			const legacyDir = await writeLegacyRuntimeDirs(projectRoot);

			const result = await migrateStorage({ projectRoot });

			expect(await readFile(join(result.debugDir, 'debug.txt'), 'utf8')).toBe(
				'debug',
			);
			expect(
				await readFile(join(result.debugDumpsDir, 'debug-dumps.txt'), 'utf8'),
			).toBe('debug-dumps');
			expect(await readFile(join(result.logsDir, 'logs.txt'), 'utf8')).toBe(
				'logs',
			);
			expect(await readFile(join(result.tmpDir, 'tmp.txt'), 'utf8')).toBe(
				'tmp',
			);
			expect(await readFile(join(result.cacheDir, 'cache.txt'), 'utf8')).toBe(
				'cache',
			);
			expect(
				await Bun.file(join(legacyDir, 'debug', 'debug.txt')).exists(),
			).toBe(true);
		});
	});

	it('deletes only known legacy runtime directories after copy when requested', async () => {
		await withProject('otto-storage-runtime-delete-', async (projectRoot) => {
			const legacyDir = await writeLegacyRuntimeDirs(projectRoot);
			await writeFile(join(legacyDir, 'config.json'), '{}');

			const result = await migrateStorage({ projectRoot, deleteLegacy: true });

			expect(await readFile(join(result.debugDir, 'debug.txt'), 'utf8')).toBe(
				'debug',
			);
			for (const dir of ['debug', 'debug-dumps', 'logs', 'tmp', 'cache']) {
				expect(await Bun.file(join(legacyDir, dir)).exists()).toBe(false);
			}
			expect(await Bun.file(join(legacyDir, 'config.json')).exists()).toBe(
				true,
			);
			expect(
				result.items.some(
					(item) => item.kind === 'runtime-dir' && item.status === 'deleted',
				),
			).toBe(true);
		});
	});

	it('copies SQLite files and preserves legacy files by default', async () => {
		await withProject('otto-storage-copy-', async (projectRoot) => {
			const legacyDir = await writeLegacySqlite(projectRoot);

			const result = await migrateStorage({ projectRoot });

			expect(await readFile(result.dbPath, 'utf8')).toBe('main-db');
			expect(
				await readFile(join(result.stateDir, 'otto.sqlite-wal'), 'utf8'),
			).toBe('wal-db');
			expect(
				await readFile(join(result.stateDir, 'otto.sqlite-shm'), 'utf8'),
			).toBe('shm-db');
			expect(await Bun.file(join(legacyDir, 'otto.sqlite')).exists()).toBe(
				true,
			);
			expect(await Bun.file(join(legacyDir, 'otto.sqlite-wal')).exists()).toBe(
				true,
			);
			expect(await Bun.file(join(legacyDir, 'otto.sqlite-shm')).exists()).toBe(
				true,
			);

			const projectJson = JSON.parse(
				await readFile(result.projectJsonPath, 'utf8'),
			);
			expect(projectJson.id).toBe(result.projectId);
			expect(projectJson.root).toBe(result.projectRoot);

			const manifest = JSON.parse(
				await readFile(result.migrationJsonPath, 'utf8'),
			);
			expect(manifest.projectId).toBe(result.projectId);
			expect(
				manifest.items.some(
					(item: { status: string }) => item.status === 'copied',
				),
			).toBe(true);
		});
	});

	it('does not overwrite an existing target database without force', async () => {
		await withProject('otto-storage-existing-', async (projectRoot) => {
			await writeLegacySqlite(projectRoot);
			const initialPlan = await planStorageMigration({ projectRoot });
			await mkdir(initialPlan.stateDir, { recursive: true });
			await writeFile(initialPlan.dbPath, 'existing-db');

			const result = await migrateStorage({ projectRoot });

			expect(await readFile(result.dbPath, 'utf8')).toBe('existing-db');
			expect(
				result.items.some(
					(item) =>
						item.file === 'otto.sqlite' && item.status === 'already-exists',
				),
			).toBe(true);
		});
	});

	it('delete-legacy cleans SQLite after a previous preserved migration', async () => {
		await withProject('otto-storage-later-delete-', async (projectRoot) => {
			const legacyDir = await writeLegacySqlite(projectRoot);

			await migrateStorage({ projectRoot });
			expect(await Bun.file(join(legacyDir, 'otto.sqlite')).exists()).toBe(
				true,
			);

			const cleanup = await migrateStorage({ projectRoot, deleteLegacy: true });

			expect(await readFile(cleanup.dbPath, 'utf8')).toBe('main-db');
			expect(await Bun.file(join(legacyDir, 'otto.sqlite')).exists()).toBe(
				false,
			);
			expect(await Bun.file(join(legacyDir, 'otto.sqlite-wal')).exists()).toBe(
				false,
			);
			expect(await Bun.file(join(legacyDir, 'otto.sqlite-shm')).exists()).toBe(
				false,
			);
			expect(
				cleanup.items.some(
					(item) => item.file === 'otto.sqlite' && item.status === 'deleted',
				),
			).toBe(true);
			const output = formatStoragePlan(cleanup);
			expect(output).toContain('Legacy runtime files removed.');
		});
	});

	it('force overwrites an existing target database with legacy SQLite data', async () => {
		await withProject('otto-storage-force-', async (projectRoot) => {
			await writeLegacySqlite(projectRoot);
			const initialPlan = await planStorageMigration({ projectRoot });
			await mkdir(initialPlan.stateDir, { recursive: true });
			await writeFile(initialPlan.dbPath, 'new-db-created-first');
			await writeFile(
				join(initialPlan.stateDir, 'otto.sqlite-wal'),
				'new-wal-created-first',
			);
			await writeFile(
				join(initialPlan.stateDir, 'otto.sqlite-shm'),
				'new-shm-created-first',
			);

			const planOutput = formatStoragePlan(
				await planStorageMigration({ projectRoot }),
			);
			expect(planOutput).toContain(
				'Target database already exists; run otto storage migrate --force to overwrite with legacy data.',
			);

			const result = await migrateStorage({ projectRoot, force: true });

			expect(await readFile(result.dbPath, 'utf8')).toBe('main-db');
			expect(
				await readFile(join(result.stateDir, 'otto.sqlite-wal'), 'utf8'),
			).toBe('wal-db');
			expect(
				await readFile(join(result.stateDir, 'otto.sqlite-shm'), 'utf8'),
			).toBe('shm-db');
			expect(
				result.items.some(
					(item) =>
						item.file === 'otto.sqlite' && item.status === 'overwritten',
				),
			).toBe(true);
		});
	});

	it('deletes only legacy SQLite files after successful copy when requested', async () => {
		await withProject('otto-storage-delete-', async (projectRoot) => {
			const legacyDir = await writeLegacySqlite(projectRoot);
			await writeFile(join(legacyDir, 'config.json'), '{}');
			await mkdir(join(legacyDir, 'agents'), { recursive: true });
			await writeFile(join(legacyDir, 'agents', 'build.md'), 'agent');

			const result = await migrateStorage({ projectRoot, deleteLegacy: true });

			expect(await readFile(result.dbPath, 'utf8')).toBe('main-db');
			expect(await Bun.file(join(legacyDir, 'otto.sqlite')).exists()).toBe(
				false,
			);
			expect(await Bun.file(join(legacyDir, 'otto.sqlite-wal')).exists()).toBe(
				false,
			);
			expect(await Bun.file(join(legacyDir, 'otto.sqlite-shm')).exists()).toBe(
				false,
			);
			expect(await Bun.file(join(legacyDir, 'config.json')).exists()).toBe(
				true,
			);
			expect(
				await Bun.file(join(legacyDir, 'agents', 'build.md')).exists(),
			).toBe(true);
			expect(result.items.some((item) => item.status === 'deleted')).toBe(true);
		});
	});
});
