import {
	getGlobalConfigDir,
	getProjectId,
	getProjectsStateRoot,
	logger,
} from '@ottocode/sdk';
import { mkdir, readdir, rename, unlink } from 'node:fs/promises';
import { toErrorLogPayload } from '../errors/handling.ts';
import { acquireRegistryLock } from './registry-lock.ts';

/**
 * Project registry — tracks otto projects this user has opened.
 * Stored at: ~/.config/otto/projects.json (XDG-aware).
 *
 * Each project record is a pointer to its project state `otto.sqlite` DB so the
 * global usage dashboard can fan out reads across projects without keeping a
 * centralized rollup database.
 */

export interface RegisteredProject {
	id: string;
	name: string;
	path: string;
	stateDir: string;
	dbPath: string;
	firstSeenAt: number;
	lastSeenAt: number;
	pinned: boolean;
}

interface RegistryFile {
	version: 1;
	projects: RegisteredProject[];
	forgottenRoots: string[];
}

interface ProjectMetadataFile {
	id?: unknown;
	name?: unknown;
	root?: unknown;
	createdAt?: unknown;
	lastSeenAt?: unknown;
}

interface RegistryStorage {
	configDir: string;
	projectsRoot: string;
	registryPath: string;
}

const TOUCH_DEBOUNCE_MS = 60_000;
const STATE_DISCOVERY_CACHE_TTL_MS = 5 * 60_000;
const touchedThisSession = new Map<string, number>();
const mutations = new Map<string, Promise<unknown>>();

async function mutateRegistry<T>(
	storage: RegistryStorage,
	mutate: () => Promise<T>,
): Promise<T> {
	const previous = mutations.get(storage.registryPath) ?? Promise.resolve();
	const pending = previous
		.catch(() => {})
		.then(async () => {
			await mkdir(storage.configDir, { recursive: true });
			const lock = await acquireRegistryLock(storage.registryPath);
			try {
				return await mutate();
			} finally {
				lock.release();
			}
		});
	mutations.set(storage.registryPath, pending);
	try {
		return await pending;
	} finally {
		if (mutations.get(storage.registryPath) === pending)
			mutations.delete(storage.registryPath);
	}
}
const stateDiscoveryCache = new Map<
	string,
	{ expiresAt: number; projects: RegisteredProject[] }
>();

function joinPath(...parts: string[]): string {
	return parts
		.filter(Boolean)
		.map((p) => p.replace(/\\/g, '/'))
		.join('/')
		.replace(/\/+/g, '/');
}

function resolveRegistryStorage(): RegistryStorage {
	const configDir = getGlobalConfigDir();
	return {
		configDir,
		projectsRoot: getProjectsStateRoot(),
		registryPath: joinPath(configDir, 'projects.json'),
	};
}

function getStoredProjectPaths(
	storage: RegistryStorage,
	projectId: string,
): { stateDir: string; dbPath: string } {
	const stateDir = joinPath(storage.projectsRoot, projectId);
	return { stateDir, dbPath: joinPath(stateDir, 'otto.sqlite') };
}

function projectName(projectRoot: string): string {
	const parts = projectRoot.split('/').filter(Boolean);
	return parts[parts.length - 1] || projectRoot;
}

function parseTime(value: unknown, fallback: number): number {
	if (typeof value !== 'string') return fallback;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

async function discoverStateProjects(
	storage: RegistryStorage,
	registered: RegisteredProject[],
	forgottenRoots: string[],
): Promise<RegisteredProject[]> {
	const existingRoots = new Set(registered.map((project) => project.path));
	const forgotten = new Set(forgottenRoots);
	const discovered: RegisteredProject[] = [];

	let entries: Array<{ isDirectory(): boolean; name: string }>;
	try {
		entries = await readdir(storage.projectsRoot, { withFileTypes: true });
	} catch {
		return discovered;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const stateDir = joinPath(storage.projectsRoot, entry.name);
		try {
			const metadataPath = joinPath(stateDir, 'project.json');
			if (!(await Bun.file(metadataPath).exists())) continue;
			const dbPathOnDisk = joinPath(stateDir, 'otto.sqlite');
			if (!(await Bun.file(dbPathOnDisk).exists())) continue;

			const metadata = (await Bun.file(
				metadataPath,
			).json()) as ProjectMetadataFile;
			if (!metadata || typeof metadata.root !== 'string') continue;
			if (existingRoots.has(metadata.root)) continue;
			if (forgotten.has(metadata.root)) continue;

			const now = Date.now();
			const root = metadata.root;
			const id = await getProjectId(root);
			const paths = getStoredProjectPaths(storage, id);
			existingRoots.add(root);
			discovered.push({
				id,
				name:
					typeof metadata.name === 'string' ? metadata.name : projectName(root),
				path: root,
				stateDir: paths.stateDir,
				dbPath: paths.dbPath,
				firstSeenAt: parseTime(metadata.createdAt, now),
				lastSeenAt: parseTime(metadata.lastSeenAt, now),
				pinned: false,
			});
		} catch (error) {
			logger.warn('Failed to load project metadata from state directory', {
				stateDir,
				error: toErrorLogPayload(error),
			});
		}
	}

	return discovered;
}

async function discoverStateProjectsCached(
	storage: RegistryStorage,
	registered: RegisteredProject[],
	forgottenRoots: string[],
): Promise<RegisteredProject[]> {
	const now = Date.now();
	const cached = stateDiscoveryCache.get(storage.projectsRoot);
	if (cached && cached.expiresAt > now) {
		const excludedRoots = new Set([
			...registered.map((project) => project.path),
			...forgottenRoots,
		]);
		return cached.projects.filter(
			(project) => !excludedRoots.has(project.path),
		);
	}
	const projects = await discoverStateProjects(
		storage,
		registered,
		forgottenRoots,
	);
	stateDiscoveryCache.set(storage.projectsRoot, {
		expiresAt: now + STATE_DISCOVERY_CACHE_TTL_MS,
		projects,
	});
	return projects;
}

async function loadRegistry(storage: RegistryStorage): Promise<RegistryFile> {
	try {
		const file = Bun.file(storage.registryPath);
		if (!(await file.exists()))
			return { version: 1, projects: [], forgottenRoots: [] };
		const text = await file.text();
		const parsed = JSON.parse(text);
		if (
			parsed &&
			typeof parsed === 'object' &&
			Array.isArray((parsed as RegistryFile).projects)
		) {
			const projects: RegisteredProject[] = [];
			for (const p of (parsed as RegistryFile).projects) {
				if (!p || typeof p.path !== 'string') continue;
				const id = await getProjectId(p.path);
				const paths = getStoredProjectPaths(storage, id);
				projects.push({
					id,
					name: typeof p.name === 'string' ? p.name : projectName(p.path),
					path: p.path,
					stateDir: paths.stateDir,
					dbPath: paths.dbPath,
					firstSeenAt:
						typeof p.firstSeenAt === 'number' ? p.firstSeenAt : Date.now(),
					lastSeenAt:
						typeof p.lastSeenAt === 'number' ? p.lastSeenAt : Date.now(),
					pinned: p.pinned === true,
				});
			}
			return {
				version: 1,
				projects,
				forgottenRoots: Array.isArray(
					(parsed as Partial<RegistryFile>).forgottenRoots,
				)
					? (parsed as RegistryFile).forgottenRoots.filter(
							(root): root is string => typeof root === 'string',
						)
					: [],
			};
		}
	} catch (error) {
		logger.warn('Failed to load projects registry', {
			error: toErrorLogPayload(error),
		});
		throw error;
	}
	throw new Error(`Invalid projects registry: ${storage.registryPath}`);
}

async function saveRegistry(
	storage: RegistryStorage,
	reg: RegistryFile,
): Promise<void> {
	const temporaryPath = `${storage.registryPath}.${crypto.randomUUID()}.tmp`;
	try {
		await Bun.write(temporaryPath, `${JSON.stringify(reg, null, 2)}\n`);
		await rename(temporaryPath, storage.registryPath);
	} finally {
		await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== 'ENOENT') throw error;
		});
	}
}

/**
 * Record that this project is known to otto. Debounced per-process so calling
 * it on every request is cheap.
 */
export async function touchProject(
	projectRoot: string,
	dbPath: string,
): Promise<void> {
	const storage = resolveRegistryStorage();
	await mutateRegistry(storage, async () => {
		void dbPath;
		const now = Date.now();
		const touchKey = `${storage.registryPath}:${projectRoot}`;
		const last = touchedThisSession.get(touchKey);
		if (last && now - last < TOUCH_DEBOUNCE_MS) return;

		const reg = await loadRegistry(storage);
		reg.forgottenRoots = reg.forgottenRoots.filter(
			(root) => root !== projectRoot,
		);
		const projectId = await getProjectId(projectRoot);
		const { stateDir, dbPath: projectDbPath } = getStoredProjectPaths(
			storage,
			projectId,
		);
		const existing = reg.projects.find((p) => p.path === projectRoot);
		if (existing) {
			existing.id = projectId;
			existing.lastSeenAt = now;
			existing.stateDir = stateDir;
			existing.dbPath = projectDbPath;
			existing.name = projectName(projectRoot);
		} else {
			reg.projects.push({
				id: projectId,
				name: projectName(projectRoot),
				path: projectRoot,
				stateDir,
				dbPath: projectDbPath,
				firstSeenAt: now,
				lastSeenAt: now,
				pinned: false,
			});
		}
		await saveRegistry(storage, reg);
		touchedThisSession.set(touchKey, now);
	});
}

/**
 * Return all known projects, most-recently-seen first.
 */
export async function listProjects(): Promise<RegisteredProject[]> {
	const storage = resolveRegistryStorage();
	const reg = await loadRegistry(storage);
	const discovered = await discoverStateProjectsCached(
		storage,
		reg.projects,
		reg.forgottenRoots,
	);
	return [...reg.projects, ...discovered].sort(
		(a, b) => b.lastSeenAt - a.lastSeenAt,
	);
}

/** Persist whether a known project is pinned in recent-project lists. */
export async function setProjectPinned(
	projectRoot: string,
	pinned: boolean,
): Promise<boolean> {
	const storage = resolveRegistryStorage();
	return mutateRegistry(storage, async () => {
		const reg = await loadRegistry(storage);
		const project = reg.projects.find((item) => item.path === projectRoot);
		if (!project) return false;
		project.pinned = pinned;
		await saveRegistry(storage, reg);
		return true;
	});
}

/**
 * Remove a project from the registry. Does not touch the project's DB.
 */
export async function forgetProject(projectRoot: string): Promise<void> {
	await forgetProjects([projectRoot]);
}

/**
 * Remove projects from the registry. Does not touch project DB files.
 */
export async function forgetProjects(projectRoots: string[]): Promise<void> {
	const roots = new Set(projectRoots);
	if (roots.size === 0) return;

	const storage = resolveRegistryStorage();
	await mutateRegistry(storage, async () => {
		const reg = await loadRegistry(storage);
		const next = reg.projects.filter((p) => !roots.has(p.path));
		reg.projects = next;
		reg.forgottenRoots = [...new Set([...reg.forgottenRoots, ...roots])];
		await saveRegistry(storage, reg);
		for (const root of roots)
			touchedThisSession.delete(`${storage.registryPath}:${root}`);
	});
}
