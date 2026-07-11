import {
	getGlobalConfigDir,
	getProjectDbPath,
	getProjectId,
	getProjectStateDir,
	getProjectsStateRoot,
	logger,
} from '@ottocode/sdk';
import { mkdir, readdir } from 'node:fs/promises';
import { toErrorLogPayload } from '../errors/handling.ts';

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

const TOUCH_DEBOUNCE_MS = 60_000;
const touchedThisSession = new Map<string, number>();

function joinPath(...parts: string[]): string {
	return parts
		.filter(Boolean)
		.map((p) => p.replace(/\\/g, '/'))
		.join('/')
		.replace(/\/+/g, '/');
}

function registryPath(): string {
	return joinPath(getGlobalConfigDir(), 'projects.json');
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
	registered: RegisteredProject[],
	forgottenRoots: string[],
): Promise<RegisteredProject[]> {
	const existingRoots = new Set(registered.map((project) => project.path));
	const forgotten = new Set(forgottenRoots);
	const discovered: RegisteredProject[] = [];
	const projectsRoot = getProjectsStateRoot();

	let entries: Array<{ isDirectory(): boolean; name: string }>;
	try {
		entries = await readdir(projectsRoot, { withFileTypes: true });
	} catch {
		return discovered;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const stateDir = joinPath(projectsRoot, entry.name);
		try {
			const dbPathOnDisk = joinPath(stateDir, 'otto.sqlite');
			if (!(await Bun.file(dbPathOnDisk).exists())) continue;
			const metadataPath = joinPath(stateDir, 'project.json');
			if (!(await Bun.file(metadataPath).exists())) continue;

			const metadata = (await Bun.file(
				metadataPath,
			).json()) as ProjectMetadataFile;
			if (!metadata || typeof metadata.root !== 'string') continue;
			if (existingRoots.has(metadata.root)) continue;
			if (forgotten.has(metadata.root)) continue;

			const now = Date.now();
			const root = metadata.root;
			existingRoots.add(root);
			discovered.push({
				id: await getProjectId(root),
				name:
					typeof metadata.name === 'string' ? metadata.name : projectName(root),
				path: root,
				stateDir: await getProjectStateDir(root),
				dbPath: await getProjectDbPath(root),
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

async function loadRegistry(): Promise<RegistryFile> {
	try {
		const file = Bun.file(registryPath());
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
				projects.push({
					id: await getProjectId(p.path),
					name: typeof p.name === 'string' ? p.name : projectName(p.path),
					path: p.path,
					stateDir: await getProjectStateDir(p.path),
					dbPath: await getProjectDbPath(p.path),
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
	}
	return { version: 1, projects: [], forgottenRoots: [] };
}

async function saveRegistry(reg: RegistryFile): Promise<void> {
	try {
		await mkdir(getGlobalConfigDir(), { recursive: true });
		await Bun.write(registryPath(), `${JSON.stringify(reg, null, 2)}\n`);
	} catch (error) {
		logger.warn('Failed to write projects registry', {
			error: toErrorLogPayload(error),
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
	try {
		void dbPath;
		const now = Date.now();
		const last = touchedThisSession.get(projectRoot);
		if (last && now - last < TOUCH_DEBOUNCE_MS) return;
		touchedThisSession.set(projectRoot, now);

		const reg = await loadRegistry();
		reg.forgottenRoots = reg.forgottenRoots.filter(
			(root) => root !== projectRoot,
		);
		const projectId = await getProjectId(projectRoot);
		const stateDir = await getProjectStateDir(projectRoot);
		const projectDbPath = await getProjectDbPath(projectRoot);
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
		await saveRegistry(reg);
	} catch (error) {
		logger.warn('Failed to touch project registry', {
			error: toErrorLogPayload(error),
		});
	}
}

/**
 * Return all known projects, most-recently-seen first.
 */
export async function listProjects(): Promise<RegisteredProject[]> {
	const reg = await loadRegistry();
	const discovered = await discoverStateProjects(
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
	const reg = await loadRegistry();
	const project = reg.projects.find((item) => item.path === projectRoot);
	if (!project) return false;
	project.pinned = pinned;
	await saveRegistry(reg);
	return true;
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

	const reg = await loadRegistry();
	const next = reg.projects.filter((p) => !roots.has(p.path));
	reg.projects = next;
	reg.forgottenRoots = [...new Set([...reg.forgottenRoots, ...roots])];
	for (const root of roots) touchedThisSession.delete(root);
	await saveRegistry(reg);
}
