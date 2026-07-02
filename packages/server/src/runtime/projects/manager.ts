import type { DB } from '@ottocode/database';
import { getDb } from '@ottocode/database';
import {
	getGlobalConfigPath,
	getGlobalSkillsConfigPath,
	getProjectConfigPath,
	getProjectId,
	loadConfig,
	shutdownMCP,
	setTerminalManager,
	TerminalManager,
	unsetTerminalManager,
	type OttoConfig,
} from '@ottocode/sdk';
import { realpath, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { forgetProject, listProjects, touchProject } from './registry.ts';

export interface ProjectRef {
	id: string;
	root: string;
}

export interface ProjectRuntime {
	id: string;
	name: string;
	root: string;
	cfg: OttoConfig;
	db: DB;
	terminalManager: TerminalManager;
	openedAt: number;
	lastUsedAt: number;
	stopIdleResources(): Promise<void>;
}

export interface ProjectRuntimeSummary {
	id: string;
	name: string;
	path: string;
	stateDir: string;
	dbPath: string;
	openedAt?: number;
	lastUsedAt: number;
	open: boolean;
}

const CONFIG_STALENESS_CHECK_INTERVAL_MS = 2000;

interface ConfigCacheState {
	fingerprint: string;
	checkedAt: number;
}

export class ProjectManager {
	private readonly runtimesById = new Map<string, ProjectRuntime>();
	private readonly idsByRoot = new Map<string, string>();
	private readonly cfgCacheById = new Map<string, ConfigCacheState>();

	async openProject(input: { path: string }): Promise<ProjectRuntime> {
		const root = await canonicalizeProjectRoot(input.path);
		const existingId = this.idsByRoot.get(root);
		if (existingId) {
			return this.getProject({ id: existingId });
		}

		const cfg = await loadConfig(root);
		const db = await getDb(cfg.projectRoot);
		await touchProject(cfg.projectRoot, cfg.paths.dbPath);
		const terminalManager = new TerminalManager();

		const now = Date.now();
		const runtime: ProjectRuntime = {
			id: await getProjectId(cfg.projectRoot),
			name: projectName(cfg.projectRoot),
			root: cfg.projectRoot,
			cfg,
			db,
			terminalManager,
			openedAt: now,
			lastUsedAt: now,
			async stopIdleResources() {
				try {
					await terminalManager.killAll();
				} finally {
					unsetTerminalManager(cfg.projectRoot);
					await shutdownMCP(cfg.projectRoot);
				}
			},
		};

		setTerminalManager(terminalManager, cfg.projectRoot);
		this.runtimesById.set(runtime.id, runtime);
		this.idsByRoot.set(runtime.root, runtime.id);
		this.cfgCacheById.set(runtime.id, {
			fingerprint: await configFingerprint(runtime.root),
			checkedAt: Date.now(),
		});
		return runtime;
	}

	async getProject(input: {
		id?: string;
		path?: string;
	}): Promise<ProjectRuntime> {
		if (input.id) {
			const runtime = this.runtimesById.get(input.id);
			if (runtime) {
				this.touchProject(input.id);
				await this.maybeRefreshConfig(runtime);
				return runtime;
			}

			const registered = (await listProjects()).find(
				(project) => project.id === input.id,
			);
			if (registered) return this.openProject({ path: registered.path });
		}

		if (input.path) return this.openProject({ path: input.path });

		throw new Error('Project id or path is required');
	}

	listOpenProjects(): ProjectRuntimeSummary[] {
		return Array.from(this.runtimesById.values()).map((runtime) =>
			toProjectRuntimeSummary(runtime),
		);
	}

	async listProjects(): Promise<ProjectRuntimeSummary[]> {
		const openProjects = this.listOpenProjects();
		const byId = new Map(openProjects.map((project) => [project.id, project]));

		for (const project of await listProjects()) {
			if (byId.has(project.id)) continue;
			byId.set(project.id, {
				id: project.id,
				name: project.name,
				path: project.path,
				stateDir: project.stateDir,
				dbPath: project.dbPath,
				lastUsedAt: project.lastSeenAt,
				open: false,
			});
		}

		return Array.from(byId.values()).sort(
			(a, b) => b.lastUsedAt - a.lastUsedAt,
		);
	}

	async closeProject(id: string): Promise<void> {
		const runtime = this.runtimesById.get(id);
		if (!runtime) return;
		await runtime.stopIdleResources();
		this.runtimesById.delete(id);
		this.idsByRoot.delete(runtime.root);
		this.cfgCacheById.delete(id);
	}

	async closeAllProjects(): Promise<void> {
		await Promise.all(
			Array.from(this.runtimesById.keys()).map((id) => this.closeProject(id)),
		);
	}

	async forgetProject(idOrPath: string): Promise<ProjectRuntimeSummary | null> {
		const projects = await this.listProjects();
		const root = await canonicalizeProjectRoot(idOrPath);
		const project = projects.find(
			(item) =>
				item.id === idOrPath || item.path === root || item.path === idOrPath,
		);
		if (!project) return null;
		await this.closeProject(project.id);
		await forgetProject(project.path);
		return project;
	}

	touchProject(id: string): void {
		const runtime = this.runtimesById.get(id);
		if (!runtime) return;
		runtime.lastUsedAt = Date.now();
	}

	async refreshProjectConfig(root: string): Promise<OttoConfig | null> {
		const id = this.idsByRoot.get(root);
		if (!id) return null;
		const runtime = this.runtimesById.get(id);
		if (!runtime) return null;
		runtime.cfg = await loadConfig(runtime.root);
		this.cfgCacheById.set(id, {
			fingerprint: await configFingerprint(runtime.root),
			checkedAt: Date.now(),
		});
		return runtime.cfg;
	}

	private async maybeRefreshConfig(runtime: ProjectRuntime): Promise<void> {
		const state = this.cfgCacheById.get(runtime.id);
		const now = Date.now();
		if (state && now - state.checkedAt < CONFIG_STALENESS_CHECK_INTERVAL_MS) {
			return;
		}
		const fingerprint = await configFingerprint(runtime.root);
		if (!state || state.fingerprint !== fingerprint) {
			runtime.cfg = await loadConfig(runtime.root);
		}
		this.cfgCacheById.set(runtime.id, { fingerprint, checkedAt: now });
	}
}

const defaultProjectManager = new ProjectManager();

export function getProjectManager(): ProjectManager {
	return defaultProjectManager;
}

export async function shutdownProjectManager(): Promise<void> {
	await defaultProjectManager.closeAllProjects();
}

async function canonicalizeProjectRoot(projectRoot: string): Promise<string> {
	const absolute = resolve(projectRoot);
	try {
		return await realpath(absolute);
	} catch {
		return absolute;
	}
}

function projectName(projectRoot: string): string {
	return basename(projectRoot) || projectRoot;
}

async function configFingerprint(projectRoot: string): Promise<string> {
	const paths = [
		getProjectConfigPath(projectRoot),
		getGlobalConfigPath(),
		getGlobalSkillsConfigPath(),
	];
	const mtimes = await Promise.all(
		paths.map(async (path) => {
			try {
				return String((await stat(path)).mtimeMs);
			} catch {
				return 'missing';
			}
		}),
	);
	return mtimes.join('|');
}

function toProjectRuntimeSummary(
	runtime: ProjectRuntime,
): ProjectRuntimeSummary {
	return {
		id: runtime.id,
		name: runtime.name,
		path: runtime.root,
		stateDir: runtime.cfg.paths.dataDir,
		dbPath: runtime.cfg.paths.dbPath,
		openedAt: runtime.openedAt,
		lastUsedAt: runtime.lastUsedAt,
		open: true,
	};
}
