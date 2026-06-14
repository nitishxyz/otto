import { execFile } from 'node:child_process';
import {
	cp,
	copyFile,
	mkdir,
	readFile,
	realpath,
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
