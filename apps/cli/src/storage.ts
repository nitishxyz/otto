import { execFile } from 'node:child_process';
import { Database } from 'bun:sqlite';
import {
	cp,
	copyFile,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import {
	getLegacyProjectDataDir,
	getProjectAttachmentsDir,
	getProjectCacheDir,
	getProjectConfigDir,
	getProjectDbPath,
	getProjectDebugDir,
	getProjectDebugDumpsDir,
	getProjectId,
	getProjectLogsDir,
	getProjectsStateRoot,
	getProjectStateDir,
	getProjectTmpDir,
} from '@ottocode/sdk';

const execFileAsync = promisify(execFile);
const SQLITE_FILES = [
	'otto.sqlite',
	'otto.sqlite-wal',
	'otto.sqlite-shm',
] as const;
const RUNTIME_DIRS = ['debug', 'debug-dumps', 'logs', 'tmp', 'cache'] as const;

type SqliteFileName = (typeof SQLITE_FILES)[number];
type RuntimeDirName = (typeof RUNTIME_DIRS)[number];

export type StorageItemStatus =
	| 'missing'
	| 'would-copy'
	| 'copied'
	| 'already-exists'
	| 'would-overwrite'
	| 'overwritten'
	| 'deleted'
	| 'skipped';

export type StorageMigrationItem = {
	kind:
		| 'sqlite'
		| 'attachments'
		| 'runtime-dir'
		| 'project-metadata'
		| 'migration-manifest';
	file?: SqliteFileName | RuntimeDirName;
	from?: string;
	to?: string;
	status: StorageItemStatus;
};

export type StorageMigrationPlan = {
	projectRoot: string;
	projectId: string;
	projectName: string;
	legacyDir: string;
	stateDir: string;
	projectConfigDir: string;
	dbPath: string;
	attachmentsDir: string;
	debugDir: string;
	debugDumpsDir: string;
	logsDir: string;
	tmpDir: string;
	cacheDir: string;
	projectJsonPath: string;
	migrationJsonPath: string;
	gitRemote?: string;
	legacySqliteFound: boolean;
	legacyAttachmentsFound: boolean;
	legacyRuntimeDirsFound: boolean;
	targetDbExists: boolean;
	targetAttachmentsExists: boolean;
	targetRuntimeDirsExists: boolean;
	migrationRecommended: boolean;
	items: StorageMigrationItem[];
};

export type StorageMigrationOptions = {
	projectRoot?: string;
	dryRun?: boolean;
	deleteLegacy?: boolean;
	force?: boolean;
};

type ProjectMetadata = {
	id: string;
	name: string;
	root: string;
	gitRemote?: string;
	createdAt: string;
	lastSeenAt: string;
};

type MigrationManifest = {
	version: 1;
	projectRoot: string;
	projectId: string;
	migratedAt: string;
	legacyDir: string;
	stateDir: string;
	items: StorageMigrationItem[];
};

export type ProjectStateMigrationStatus =
	| 'already-path'
	| 'would-move'
	| 'moved'
	| 'would-merge'
	| 'merged'
	| 'skipped'
	| 'error';

export type ProjectStateMigrationItem = {
	projectRoot?: string;
	projectId?: string;
	from: string;
	to?: string;
	status: ProjectStateMigrationStatus;
	sessions: number;
	reason?: string;
	archiveDir?: string;
};

export type ProjectStateMigrationReport = {
	projectsRoot: string;
	dryRun: boolean;
	items: ProjectStateMigrationItem[];
};

export type ProjectStateMigrationOptions = {
	projectRoot?: string;
	dryRun?: boolean;
};

/** Move or merge old project state directories into canonical path-based IDs. */
export async function migrateProjectStateStorage(
	options: ProjectStateMigrationOptions = {},
): Promise<ProjectStateMigrationReport> {
	const dryRun = options.dryRun === true;
	const filterRoot = options.projectRoot
		? await resolveProjectRoot(options.projectRoot)
		: undefined;
	const projectsRoot = getProjectsStateRoot();
	const planned = await planProjectStateDirectoryMigration(
		projectsRoot,
		filterRoot,
	);
	if (dryRun) return { projectsRoot, dryRun, items: planned };

	const items: ProjectStateMigrationItem[] = [];
	for (const item of planned) {
		if (item.status === 'would-move' && item.to && item.projectRoot) {
			try {
				await mkdir(projectsRoot, { recursive: true });
				await rename(item.from, item.to);
				await writeStateProjectMetadata(item.to, item.projectRoot);
				items.push({ ...item, status: 'moved' });
			} catch (error) {
				items.push({
					...item,
					status: 'error',
					reason: error instanceof Error ? error.message : String(error),
				});
			}
			continue;
		}

		if (item.status === 'would-merge' && item.to && item.projectRoot) {
			try {
				await mergeProjectStateDirectories(item.from, item.to);
				await writeStateProjectMetadata(item.to, item.projectRoot);
				const archiveDir = await archiveMigratedStateDir(item.from);
				items.push({ ...item, status: 'merged', archiveDir });
			} catch (error) {
				items.push({
					...item,
					status: 'error',
					reason: error instanceof Error ? error.message : String(error),
				});
			}
			continue;
		}

		items.push(item);
	}

	return { projectsRoot, dryRun, items };
}

export function formatProjectStateMigrationReport(
	report: ProjectStateMigrationReport,
): string {
	const counts = countProjectStateMigrationStatuses(report.items);
	const lines = [
		'Otto project state migration',
		`Mode: ${report.dryRun ? 'dry-run' : 'execute'}`,
		`Projects root: ${report.projectsRoot}`,
		'',
		`Moved: ${counts.moved}`,
		`Merged: ${counts.merged}`,
		`Already path-based: ${counts.alreadyPath}`,
		`Skipped: ${counts.skipped}`,
		`Errors: ${counts.error}`,
	];

	const actionable = report.items.filter((item) =>
		['would-move', 'would-merge', 'moved', 'merged', 'error'].includes(
			item.status,
		),
	);
	if (actionable.length > 0) {
		lines.push('', 'Actions:');
		for (const item of actionable) {
			lines.push(`  - ${formatProjectStateMigrationItem(item)}`);
		}
	}

	const skippedWithSessions = report.items.filter(
		(item) => item.status === 'skipped' && item.sessions > 0,
	);
	if (skippedWithSessions.length > 0) {
		lines.push('', 'Skipped items with sessions:');
		for (const item of skippedWithSessions) {
			lines.push(`  - ${formatProjectStateMigrationItem(item)}`);
		}
	}

	if (report.dryRun) {
		lines.push('', 'Run without --dry-run to apply these changes.');
	}
	return lines.join('\n');
}

function countProjectStateMigrationStatuses(
	items: ProjectStateMigrationItem[],
) {
	return {
		moved: items.filter((item) => ['would-move', 'moved'].includes(item.status))
			.length,
		merged: items.filter((item) =>
			['would-merge', 'merged'].includes(item.status),
		).length,
		alreadyPath: items.filter((item) => item.status === 'already-path').length,
		skipped: items.filter((item) => item.status === 'skipped').length,
		error: items.filter((item) => item.status === 'error').length,
	};
}

function formatProjectStateMigrationItem(
	item: ProjectStateMigrationItem,
): string {
	const root = item.projectRoot ? ` ${item.projectRoot}` : '';
	const target = item.to ? ` -> ${item.to}` : '';
	const sessions = ` (${item.sessions} sessions)`;
	const reason = item.reason ? `: ${item.reason}` : '';
	const archive = item.archiveDir ? ` archived at ${item.archiveDir}` : '';
	return `${item.status}${root}${sessions}: ${item.from}${target}${archive}${reason}`;
}

/** Build a SQLite-only storage migration plan without touching files. */
export async function planStorageMigration(
	options: StorageMigrationOptions = {},
): Promise<StorageMigrationPlan> {
	const projectRoot = await resolveProjectRoot(options.projectRoot);
	const projectId = await getProjectId(projectRoot);
	const projectName = basename(projectRoot);
	const legacyDir = getLegacyProjectDataDir(projectRoot);
	const stateDir = await getProjectStateDir(projectRoot);
	const dbPath = await getProjectDbPath(projectRoot);
	const projectConfigDir = getProjectConfigDir(projectRoot);
	const attachmentsDir = await getProjectAttachmentsDir(projectRoot);
	const debugDir = await getProjectDebugDir(projectRoot);
	const debugDumpsDir = await getProjectDebugDumpsDir(projectRoot);
	const logsDir = await getProjectLogsDir(projectRoot);
	const tmpDir = await getProjectTmpDir(projectRoot);
	const cacheDir = await getProjectCacheDir(projectRoot);
	const projectJsonPath = join(stateDir, 'project.json');
	const migrationJsonPath = join(stateDir, 'migration.json');
	const gitRemote = await readGitRemote(projectRoot);
	const legacyMainDb = join(legacyDir, 'otto.sqlite');
	const legacyAttachmentsDir = join(legacyDir, 'attachments');
	const legacySqliteFound = await exists(legacyMainDb);
	const legacyAttachmentsFound = await exists(legacyAttachmentsDir);
	const runtimeDirTargets: Record<RuntimeDirName, string> = {
		debug: debugDir,
		'debug-dumps': debugDumpsDir,
		logs: logsDir,
		tmp: tmpDir,
		cache: cacheDir,
	};
	const runtimeDirStates = await Promise.all(
		RUNTIME_DIRS.map(async (dir) => ({
			dir,
			legacyExists: await exists(join(legacyDir, dir)),
			targetExists: await exists(runtimeDirTargets[dir]),
		})),
	);
	const legacyRuntimeDirsFound = runtimeDirStates.some(
		(state) => state.legacyExists,
	);
	const targetRuntimeDirsExists = runtimeDirStates.some(
		(state) => state.targetExists,
	);
	const targetDbExists = await exists(dbPath);
	const targetAttachmentsExists = await exists(attachmentsDir);
	const force = options.force === true;
	const items: StorageMigrationItem[] = [];

	for (const file of SQLITE_FILES) {
		const from = join(legacyDir, file);
		const to = join(stateDir, file);
		const sourceExists = await exists(from);
		const targetExists = await exists(to);
		let status: StorageItemStatus = 'missing';
		if (sourceExists && targetExists) {
			status = force ? 'would-overwrite' : 'already-exists';
		} else if (sourceExists) {
			status = 'would-copy';
		}
		items.push({ kind: 'sqlite', file, from, to, status });
	}
	items.push({
		kind: 'attachments',
		from: legacyAttachmentsDir,
		to: attachmentsDir,
		status: getDirectoryPlanStatus(
			legacyAttachmentsFound,
			targetAttachmentsExists,
			force,
		),
	});
	for (const state of runtimeDirStates) {
		items.push({
			kind: 'runtime-dir',
			file: state.dir,
			from: join(legacyDir, state.dir),
			to: runtimeDirTargets[state.dir],
			status: getDirectoryPlanStatus(
				state.legacyExists,
				state.targetExists,
				force,
			),
		});
	}

	return {
		projectRoot,
		projectId,
		projectName,
		legacyDir,
		stateDir,
		projectConfigDir,
		dbPath,
		attachmentsDir,
		debugDir,
		debugDumpsDir,
		logsDir,
		tmpDir,
		cacheDir,
		projectJsonPath,
		migrationJsonPath,
		...(gitRemote ? { gitRemote } : {}),
		legacySqliteFound,
		legacyAttachmentsFound,
		legacyRuntimeDirsFound,
		targetDbExists,
		targetAttachmentsExists,
		targetRuntimeDirsExists,
		migrationRecommended:
			(legacySqliteFound && !targetDbExists) ||
			(legacyAttachmentsFound && !targetAttachmentsExists) ||
			runtimeDirStates.some(
				(state) => state.legacyExists && !state.targetExists,
			),
		items,
	};
}

/** Execute a SQLite-only storage migration, preserving legacy files by default. */
export async function migrateStorage(
	options: StorageMigrationOptions = {},
): Promise<StorageMigrationPlan> {
	const plan = await planStorageMigration(options);
	if (options.dryRun) return plan;

	await mkdir(plan.stateDir, { recursive: true });
	await writeProjectMetadata(plan);

	const force = options.force === true;
	const migratedItems: StorageMigrationItem[] = [];
	let copiedMainDb = false;
	let copiedAttachments = false;
	const copiedRuntimeDirs = new Set<RuntimeDirName>();

	for (const item of plan.items) {
		if (!item.from || !item.to) {
			migratedItems.push(item);
			continue;
		}
		if (!(await exists(item.from))) {
			migratedItems.push({ ...item, status: 'missing' });
			continue;
		}
		if ((await exists(item.to)) && !force) {
			migratedItems.push({ ...item, status: 'already-exists' });
			continue;
		}
		if (item.kind === 'attachments' || item.kind === 'runtime-dir') {
			if (await exists(item.to))
				await rm(item.to, { recursive: true, force: true });
			await cp(item.from, item.to, { recursive: true });
			if (!(await exists(item.to))) {
				throw new Error(`Failed to verify copied directory: ${item.to}`);
			}
			if (item.kind === 'attachments') copiedAttachments = true;
			if (item.kind === 'runtime-dir') {
				copiedRuntimeDirs.add(item.file as RuntimeDirName);
			}
			migratedItems.push({
				...item,
				status: item.status === 'would-overwrite' ? 'overwritten' : 'copied',
			});
			continue;
		}
		if (item.kind !== 'sqlite') {
			migratedItems.push(item);
			continue;
		}

		await copyFile(item.from, item.to);
		if (!(await exists(item.to))) {
			throw new Error(`Failed to verify copied SQLite file: ${item.to}`);
		}
		const status: StorageItemStatus =
			item.status === 'would-overwrite' ? 'overwritten' : 'copied';
		if (item.file === 'otto.sqlite') copiedMainDb = true;
		migratedItems.push({ ...item, status });
	}

	if (options.deleteLegacy && (copiedMainDb || (await exists(plan.dbPath)))) {
		for (const file of SQLITE_FILES) {
			const legacyFile = join(plan.legacyDir, file);
			const targetFile = join(plan.stateDir, file);
			if (!(await exists(legacyFile))) continue;
			if (!(await exists(targetFile))) continue;
			await rm(legacyFile, { force: true });
			migratedItems.push({
				kind: 'sqlite',
				file,
				from: legacyFile,
				to: targetFile,
				status: 'deleted',
			});
		}
	}
	if (
		options.deleteLegacy &&
		(copiedAttachments || (await exists(plan.attachmentsDir)))
	) {
		const legacyAttachmentsDir = join(plan.legacyDir, 'attachments');
		if (await exists(legacyAttachmentsDir)) {
			await rm(legacyAttachmentsDir, { recursive: true, force: true });
			migratedItems.push({
				kind: 'attachments',
				from: legacyAttachmentsDir,
				to: plan.attachmentsDir,
				status: 'deleted',
			});
		}
	}
	if (options.deleteLegacy) {
		for (const dir of RUNTIME_DIRS) {
			if (
				!copiedRuntimeDirs.has(dir) &&
				!(await exists(join(plan.stateDir, dir)))
			) {
				continue;
			}
			const legacyRuntimeDir = join(plan.legacyDir, dir);
			if (!(await exists(legacyRuntimeDir))) continue;
			await rm(legacyRuntimeDir, { recursive: true, force: true });
			migratedItems.push({
				kind: 'runtime-dir',
				file: dir,
				from: legacyRuntimeDir,
				to: join(plan.stateDir, dir),
				status: 'deleted',
			});
		}
	}

	const result: StorageMigrationPlan = {
		...plan,
		legacySqliteFound: await exists(join(plan.legacyDir, 'otto.sqlite')),
		legacyAttachmentsFound: await exists(join(plan.legacyDir, 'attachments')),
		legacyRuntimeDirsFound: await hasAnyRuntimeDir(plan.legacyDir),
		targetDbExists: await exists(plan.dbPath),
		targetAttachmentsExists: await exists(plan.attachmentsDir),
		targetRuntimeDirsExists: await hasAnyRuntimeDir(plan.stateDir),
		migrationRecommended:
			((await exists(join(plan.legacyDir, 'otto.sqlite'))) &&
				!(await exists(plan.dbPath))) ||
			((await exists(join(plan.legacyDir, 'attachments'))) &&
				!(await exists(plan.attachmentsDir))) ||
			(await hasAnyRuntimeDirNeedingMigration(plan.legacyDir, plan.stateDir)),
		items: [
			{ kind: 'project-metadata', to: plan.projectJsonPath, status: 'copied' },
			...migratedItems,
		],
	};

	await writeMigrationManifest(result);
	result.items.push({
		kind: 'migration-manifest',
		to: plan.migrationJsonPath,
		status: 'copied',
	});
	return result;
}

export function formatStorageDoctor(plan: StorageMigrationPlan): string {
	const lines = [
		`Project root:        ${plan.projectRoot}`,
		`Project ID:          ${plan.projectId}`,
		`Project config dir:  ${plan.projectConfigDir}`,
		`Project state dir:   ${plan.stateDir}`,
		`Database:            ${plan.dbPath}`,
		`Attachments:         ${plan.attachmentsDir}`,
		`Debug dumps:         ${plan.debugDumpsDir}`,
		'',
		'Legacy project runtime data:',
		`  .otto/otto.sqlite       ${plan.legacySqliteFound ? 'found' : 'missing'}`,
		`  .otto/attachments       ${plan.legacyAttachmentsFound ? 'found' : 'missing'}`,
		...RUNTIME_DIRS.map(
			(dir) =>
				`  .otto/${dir.padEnd(16, ' ')} ${plan.items.some((item) => item.kind === 'runtime-dir' && item.file === dir && item.status !== 'missing') ? 'found' : 'missing'}`,
		),
		'',
		`Status: ${plan.migrationRecommended ? 'migration recommended' : 'ok'}`,
	];
	if (plan.migrationRecommended) lines.push('Run:    otto storage migrate');
	return lines.join('\n');
}

export function formatStoragePlan(plan: StorageMigrationPlan): string {
	const lines = [
		'Stop any running Otto server before migrating SQLite data.',
		'',
		`Project root: ${plan.projectRoot}`,
		`State dir:    ${plan.stateDir}`,
	];

	lines.push('', ...formatSqliteSummary(plan));
	lines.push(...formatAttachmentSummary(plan));
	lines.push(...formatRuntimeDirSummary(plan));
	lines.push(...formatLegacyCleanupHint(plan));
	lines.push(`Status: ${getPlanStatus(plan)}`);
	return lines.join('\n');
}

function formatLegacyCleanupHint(plan: StorageMigrationPlan): string[] {
	const statuses = plan.items.map((item) => item.status);
	if (statuses.includes('deleted')) {
		return ['Legacy runtime files removed.'];
	}
	if (
		statuses.some((status) => ['copied', 'overwritten'].includes(status)) &&
		(plan.legacySqliteFound ||
			plan.legacyAttachmentsFound ||
			plan.legacyRuntimeDirsFound)
	) {
		return [
			'Legacy files preserved. Run otto storage migrate --delete-legacy to remove old .otto runtime files.',
		];
	}
	return [];
}

function formatSqliteSummary(plan: StorageMigrationPlan): string[] {
	const sqliteItems = plan.items.filter((item) => item.kind === 'sqlite');
	if (sqliteItems.every((item) => item.status === 'missing')) {
		return ['SQLite: none found in legacy .otto'];
	}
	if (sqliteItems.every((item) => item.status === 'already-exists')) {
		return [
			`SQLite: already migrated (${sqliteItems.length} files already exist)`,
			'  Target database already exists; run otto storage migrate --force to overwrite with legacy data.',
		];
	}

	const relevantItems = sqliteItems.filter((item) => item.status !== 'missing');
	const lines = [
		'SQLite:',
		...relevantItems.map(
			(item) => `  - ${formatItemStatus(item)} ${item.file}`,
		),
	];
	if (relevantItems.some((item) => item.status === 'already-exists')) {
		lines.push(
			'  Target database already exists; run otto storage migrate --force to overwrite with legacy data.',
		);
	}
	return lines;
}

function formatAttachmentSummary(plan: StorageMigrationPlan): string[] {
	const attachmentItem = plan.items.find((item) => item.kind === 'attachments');
	if (!attachmentItem || attachmentItem.status === 'missing') {
		return ['', 'Attachments: none found in legacy .otto'];
	}
	return [
		'',
		`Attachments: ${formatItemStatus(attachmentItem)} legacy attachments`,
	];
}

function formatRuntimeDirSummary(plan: StorageMigrationPlan): string[] {
	const runtimeItems = plan.items.filter((item) => item.kind === 'runtime-dir');
	const relevantItems = runtimeItems.filter(
		(item) => item.status !== 'missing',
	);
	if (relevantItems.length === 0) {
		return ['', 'Runtime dirs: none found in legacy .otto', ''];
	}
	return [
		'',
		'Runtime dirs:',
		...relevantItems.map(
			(item) => `  - ${formatItemStatus(item)} ${String(item.file)}`,
		),
		'',
	];
}

function formatItemStatus(item: StorageMigrationItem): string {
	switch (item.status) {
		case 'would-copy':
			return 'would copy';
		case 'copied':
			return 'copied';
		case 'already-exists':
			return 'already exists';
		case 'would-overwrite':
			return 'would overwrite';
		case 'overwritten':
			return 'overwritten';
		case 'deleted':
			return 'deleted legacy';
		case 'skipped':
			return 'skipped';
		case 'missing':
			return 'missing';
	}
}

function getPlanStatus(plan: StorageMigrationPlan): string {
	const statuses = plan.items.map((item) => item.status);
	if (
		statuses.some((status) =>
			['copied', 'overwritten', 'deleted'].includes(status),
		)
	) {
		return 'migration completed';
	}
	if (
		statuses.some((status) =>
			['would-copy', 'would-overwrite'].includes(status),
		)
	) {
		return 'migration recommended';
	}
	return 'nothing to migrate';
}

async function planProjectStateDirectoryMigration(
	projectsRoot: string,
	filterRoot?: string,
): Promise<ProjectStateMigrationItem[]> {
	let entries: Array<{ isDirectory(): boolean; name: string }>;
	try {
		entries = await readdir(projectsRoot, { withFileTypes: true });
	} catch {
		return [];
	}

	const items: ProjectStateMigrationItem[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const from = join(projectsRoot, entry.name);
		const sessions = await readSessionCount(from);
		const rootResult = await readProjectRootFromStateDir(from);
		if (!rootResult.root) {
			items.push({
				from,
				status: 'skipped',
				sessions,
				reason: rootResult.reason ?? 'could not resolve project root',
			});
			continue;
		}

		const projectRoot = await resolveProjectRoot(rootResult.root);
		if (filterRoot && projectRoot !== filterRoot) continue;

		const projectId = await getProjectId(projectRoot);
		const to = await getProjectStateDir(projectRoot);
		if (from === to) {
			items.push({
				projectRoot,
				projectId,
				from,
				to,
				status: 'already-path',
				sessions,
			});
			continue;
		}

		items.push({
			projectRoot,
			projectId,
			from,
			to,
			status: (await exists(to)) ? 'would-merge' : 'would-move',
			sessions,
		});
	}

	return items.sort((a, b) => {
		const priority = (item: ProjectStateMigrationItem) =>
			item.status === 'would-merge' || item.status === 'would-move' ? 0 : 1;
		return (
			priority(a) - priority(b) ||
			b.sessions - a.sessions ||
			a.from.localeCompare(b.from)
		);
	});
}

async function readProjectRootFromStateDir(
	stateDir: string,
): Promise<{ root?: string; reason?: string }> {
	const metadata = await readProjectMetadataLoose(
		join(stateDir, 'project.json'),
	);
	if (metadata?.root) return { root: metadata.root };

	const dbRoots = await readProjectRootsFromDb(join(stateDir, 'otto.sqlite'));
	if (dbRoots.length === 1) return { root: dbRoots[0] };
	if (dbRoots.length > 1) {
		return { reason: `ambiguous project roots: ${dbRoots.join(', ')}` };
	}
	return { reason: 'missing project metadata and session project paths' };
}

async function readProjectMetadataLoose(
	path: string,
): Promise<Partial<ProjectMetadata> | undefined> {
	try {
		const parsed = JSON.parse(
			await readFile(path, 'utf8'),
		) as Partial<ProjectMetadata>;
		return parsed && typeof parsed === 'object' ? parsed : undefined;
	} catch {
		return undefined;
	}
}

async function readProjectRootsFromDb(dbPath: string): Promise<string[]> {
	if (!(await exists(dbPath))) return [];
	try {
		const db = new Database(dbPath, { readonly: true });
		try {
			const rows = db
				.query(
					"SELECT DISTINCT project_path AS projectPath FROM sessions WHERE project_path IS NOT NULL AND project_path != '' LIMIT 3",
				)
				.all() as Array<{ projectPath: string }>;
			return rows.map((row) => row.projectPath).filter(Boolean);
		} finally {
			db.close();
		}
	} catch {
		return [];
	}
}

async function readSessionCount(stateDir: string): Promise<number> {
	const dbPath = join(stateDir, 'otto.sqlite');
	if (!(await exists(dbPath))) return 0;
	try {
		const db = new Database(dbPath, { readonly: true });
		try {
			const row = db.query('SELECT COUNT(*) AS count FROM sessions').get() as
				| { count: number }
				| undefined;
			return row?.count ?? 0;
		} finally {
			db.close();
		}
	} catch {
		return 0;
	}
}

async function writeStateProjectMetadata(
	stateDir: string,
	projectRoot: string,
): Promise<void> {
	const projectId = await getProjectId(projectRoot);
	const metadataPath = join(stateDir, 'project.json');
	const existing = await readProjectMetadataLoose(metadataPath);
	const now = new Date().toISOString();
	await writeJson(metadataPath, {
		id: projectId,
		name: basename(projectRoot),
		root: projectRoot,
		...(existing?.gitRemote ? { gitRemote: existing.gitRemote } : {}),
		createdAt: existing?.createdAt ?? now,
		lastSeenAt: now,
	});
	await writeJson(join(stateDir, 'migration.json'), {
		version: 2,
		projectRoot,
		projectId,
		migratedAt: now,
		stateDir,
		reason: 'path-based-project-state-id',
	});
}

async function mergeProjectStateDirectories(
	from: string,
	to: string,
): Promise<void> {
	await mkdir(to, { recursive: true });
	await mergeSqliteDatabases(
		join(from, 'otto.sqlite'),
		join(to, 'otto.sqlite'),
	);

	for (const entry of await readdir(from, { withFileTypes: true })) {
		if (SQLITE_FILES.includes(entry.name as SqliteFileName)) continue;
		if (entry.name === 'project.json' || entry.name === 'migration.json')
			continue;
		const sourcePath = join(from, entry.name);
		const targetPath = join(to, entry.name);
		if (entry.isDirectory()) {
			await copyDirectoryContents(sourcePath, targetPath);
			continue;
		}
		if (!(await exists(targetPath))) await copyFile(sourcePath, targetPath);
	}
}

async function mergeSqliteDatabases(
	fromDbPath: string,
	toDbPath: string,
): Promise<void> {
	if (!(await exists(fromDbPath))) return;
	if (!(await exists(toDbPath))) {
		for (const file of SQLITE_FILES) {
			const fromFile = join(fromDbPath, '..', file);
			const toFile = join(toDbPath, '..', file);
			if (await exists(fromFile)) await copyFile(fromFile, toFile);
		}
		return;
	}

	const db = new Database(toDbPath, { create: true });
	try {
		db.exec('PRAGMA busy_timeout = 5000');
		db.exec('PRAGMA foreign_keys = OFF');
		db.exec(`ATTACH DATABASE ${quoteSqlString(fromDbPath)} AS source`);
		try {
			const tables = db
				.query(
					"SELECT name FROM source.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
				)
				.all() as Array<{ name: string }>;
			db.exec('BEGIN TRANSACTION');
			try {
				for (const table of tables) {
					if (!(await tableExistsInMain(db, table.name))) continue;
					const columns = getCommonTableColumns(db, table.name);
					if (columns.length === 0) continue;
					const columnList = columns.map(quoteIdent).join(', ');
					db.exec(
						`INSERT OR IGNORE INTO ${quoteIdent(table.name)} (${columnList}) SELECT ${columnList} FROM source.${quoteIdent(table.name)}`,
					);
				}
				db.exec('COMMIT');
			} catch (error) {
				db.exec('ROLLBACK');
				throw error;
			}
		} finally {
			db.exec('DETACH DATABASE source');
		}
	} finally {
		db.close();
	}
}

async function tableExistsInMain(
	db: Database,
	table: string,
): Promise<boolean> {
	const row = db
		.query(
			"SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?",
		)
		.get(table) as { ok: number } | undefined;
	return row?.ok === 1;
}

function getCommonTableColumns(db: Database, table: string): string[] {
	const mainColumns = new Set(getTableColumns(db, 'main', table));
	return getTableColumns(db, 'source', table).filter((column) =>
		mainColumns.has(column),
	);
}

function getTableColumns(
	db: Database,
	schema: 'main' | 'source',
	table: string,
) {
	const rows = db
		.query(`PRAGMA ${schema}.table_info(${quoteIdent(table)})`)
		.all() as Array<{ name: string }>;
	return rows.map((row) => row.name);
}

async function copyDirectoryContents(from: string, to: string): Promise<void> {
	await mkdir(to, { recursive: true });
	for (const entry of await readdir(from, { withFileTypes: true })) {
		const sourcePath = join(from, entry.name);
		const targetPath = join(to, entry.name);
		if (entry.isDirectory()) {
			await copyDirectoryContents(sourcePath, targetPath);
			continue;
		}
		if (!(await exists(targetPath))) await copyFile(sourcePath, targetPath);
	}
}

async function archiveMigratedStateDir(sourceDir: string): Promise<string> {
	const backupRoot = join(getProjectsStateRoot(), '..', 'migrated-projects');
	await mkdir(backupRoot, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	let target = join(backupRoot, `${basename(sourceDir)}-${stamp}`);
	let index = 2;
	while (await exists(target)) {
		target = join(backupRoot, `${basename(sourceDir)}-${stamp}-${index}`);
		index += 1;
	}
	await rename(sourceDir, target);
	return target;
}

function quoteIdent(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

function quoteSqlString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

async function hasAnyRuntimeDir(root: string): Promise<boolean> {
	for (const dir of RUNTIME_DIRS) {
		if (await exists(join(root, dir))) return true;
	}
	return false;
}

async function hasAnyRuntimeDirNeedingMigration(
	legacyDir: string,
	stateDir: string,
): Promise<boolean> {
	for (const dir of RUNTIME_DIRS) {
		if (
			(await exists(join(legacyDir, dir))) &&
			!(await exists(join(stateDir, dir)))
		) {
			return true;
		}
	}
	return false;
}

function getDirectoryPlanStatus(
	sourceExists: boolean,
	targetExists: boolean,
	force: boolean,
): StorageItemStatus {
	if (sourceExists && targetExists)
		return force ? 'would-overwrite' : 'already-exists';
	if (sourceExists) return 'would-copy';
	return 'missing';
}

async function resolveProjectRoot(projectRoot?: string): Promise<string> {
	if (projectRoot) {
		return realpath(projectRoot).catch(() => projectRoot);
	}
	return realpath(process.cwd()).catch(() => process.cwd());
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function writeProjectMetadata(plan: StorageMigrationPlan): Promise<void> {
	const now = new Date().toISOString();
	const existing = await readProjectMetadata(plan.projectJsonPath);
	const metadata: ProjectMetadata = {
		id: plan.projectId,
		name: plan.projectName,
		root: plan.projectRoot,
		...(plan.gitRemote ? { gitRemote: plan.gitRemote } : {}),
		createdAt: existing?.createdAt ?? now,
		lastSeenAt: now,
	};
	await writeJson(plan.projectJsonPath, metadata);
}

async function writeMigrationManifest(
	plan: StorageMigrationPlan,
): Promise<void> {
	const manifest: MigrationManifest = {
		version: 1,
		projectRoot: plan.projectRoot,
		projectId: plan.projectId,
		migratedAt: new Date().toISOString(),
		legacyDir: plan.legacyDir,
		stateDir: plan.stateDir,
		items: plan.items,
	};
	await writeJson(plan.migrationJsonPath, manifest);
}

async function readProjectMetadata(
	path: string,
): Promise<ProjectMetadata | undefined> {
	try {
		const parsed = JSON.parse(
			await readFile(path, 'utf8'),
		) as Partial<ProjectMetadata>;
		return typeof parsed.createdAt === 'string'
			? (parsed as ProjectMetadata)
			: undefined;
	} catch {
		return undefined;
	}
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readGitRemote(projectRoot: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync('git', [
			'-C',
			projectRoot,
			'config',
			'--get',
			'remote.origin.url',
		]);
		const remote = String(stdout).trim();
		return remote || undefined;
	} catch {
		return undefined;
	}
}
