import { getGlobalConfigDir, logger } from '@ottocode/sdk';

/**
 * Project registry — tracks otto projects this user has opened.
 * Stored at: ~/.config/otto/projects.json (XDG-aware).
 *
 * Each project record is a pointer to its local `.otto/otto.sqlite` DB so the
 * global usage dashboard can fan out reads across projects without keeping a
 * centralized rollup database.
 */

export interface RegisteredProject {
	id: string;
	name: string;
	path: string;
	dbPath: string;
	firstSeenAt: number;
	lastSeenAt: number;
}

interface RegistryFile {
	version: 1;
	projects: RegisteredProject[];
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

async function loadRegistry(): Promise<RegistryFile> {
	try {
		const file = Bun.file(registryPath());
		if (!(await file.exists())) return { version: 1, projects: [] };
		const text = await file.text();
		const parsed = JSON.parse(text);
		if (
			parsed &&
			typeof parsed === 'object' &&
			Array.isArray((parsed as RegistryFile).projects)
		) {
			return {
				version: 1,
				projects: (parsed as RegistryFile).projects.filter(
					(p) =>
						p && typeof p.path === 'string' && typeof p.dbPath === 'string',
				),
			};
		}
	} catch (error) {
		logger.warn('Failed to load projects registry', { error: String(error) });
	}
	return { version: 1, projects: [] };
}

async function saveRegistry(reg: RegistryFile): Promise<void> {
	try {
		await Bun.write(registryPath(), `${JSON.stringify(reg, null, 2)}\n`);
	} catch (error) {
		logger.warn('Failed to write projects registry', { error: String(error) });
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
		const now = Date.now();
		const last = touchedThisSession.get(projectRoot);
		if (last && now - last < TOUCH_DEBOUNCE_MS) return;
		touchedThisSession.set(projectRoot, now);

		const reg = await loadRegistry();
		const existing = reg.projects.find((p) => p.path === projectRoot);
		if (existing) {
			existing.lastSeenAt = now;
			existing.dbPath = dbPath;
			existing.name = projectName(projectRoot);
		} else {
			reg.projects.push({
				id:
					typeof crypto?.randomUUID === 'function'
						? crypto.randomUUID()
						: `${now}-${Math.random().toString(36).slice(2, 10)}`,
				name: projectName(projectRoot),
				path: projectRoot,
				dbPath,
				firstSeenAt: now,
				lastSeenAt: now,
			});
		}
		await saveRegistry(reg);
	} catch (error) {
		logger.warn('Failed to touch project registry', {
			error: String(error),
		});
	}
}

/**
 * Return all known projects, most-recently-seen first.
 */
export async function listProjects(): Promise<RegisteredProject[]> {
	const reg = await loadRegistry();
	return [...reg.projects].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
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
	if (next.length === reg.projects.length) return;
	reg.projects = next;
	for (const root of roots) touchedThisSession.delete(root);
	await saveRegistry(reg);
}
