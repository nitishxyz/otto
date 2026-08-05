import type { DB } from '@ottocode/database';
import { getDb } from '@ottocode/database';
import {
	getGlobalConfigPath,
	getGlobalSkillsConfigPath,
	getProjectConfigPath,
	getProjectId,
	disposeNativeExtensionHosts,
	loadConfig,
	shutdownMCP,
	setTerminalManager,
	TerminalManager,
	unsetTerminalManager,
	type OttoConfig,
} from '@ottocode/sdk';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { shutdownPartContentWriter } from '../persistence/part-content-writer.ts';
import { abortAllActiveShellJobs } from '../tools/active-shells.ts';
import { getServerInfo } from '../../state.ts';
import { recoverInterruptedRuns } from './recovery.ts';
import { validateProjectDirectory } from './filesystem.ts';
import {
	forgetProject,
	listProjects,
	setProjectPinned,
	touchProject,
} from './registry.ts';

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
	pinned: boolean;
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
		const root = await validateProjectDirectory(input.path);
		const existingId = this.idsByRoot.get(root);
		if (existingId) {
			return this.getProject({ id: existingId });
		}

		const cfg = await loadConfig(root);
		const db = await getDb(cfg.projectRoot);
		recoverInterruptedRuns(db, getServerInfo().startedAt);
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
					disposeNativeExtensionHosts(cfg.projectRoot);
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
		if (input.id) {
			const error = new Error(`Project not found: ${input.id}`);
			(error as Error & { status?: number }).status = 404;
			throw error;
		}

		throw new Error('Project id or path is required');
	}

	listOpenProjects(): ProjectRuntimeSummary[] {
		return Array.from(this.runtimesById.values()).map((runtime) =>
			toProjectRuntimeSummary(runtime),
		);
	}

	async listProjects(): Promise<ProjectRuntimeSummary[]> {
		const registeredProjects = await listProjects();
		const pinnedById = new Map(
			registeredProjects.map((project) => [project.id, project.pinned]),
		);
		const openProjects = this.listOpenProjects();
		for (const project of openProjects) {
			project.pinned = pinnedById.get(project.id) ?? false;
		}
		const byId = new Map(openProjects.map((project) => [project.id, project]));

		for (const project of registeredProjects) {
			if (byId.has(project.id)) continue;
			byId.set(project.id, {
				id: project.id,
				name: project.name,
				path: project.path,
				stateDir: project.stateDir,
				dbPath: project.dbPath,
				lastUsedAt: project.lastSeenAt,
				open: false,
				pinned: project.pinned,
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
		const root = await validateProjectDirectory(idOrPath).catch(() => idOrPath);
		const project = projects.find(
			(item) =>
				item.id === idOrPath || item.path === root || item.path === idOrPath,
		);
		if (!project) return null;
		await this.closeProject(project.id);
		await forgetProject(project.path);
		return project;
	}

	async setProjectPinned(id: string, pinned: boolean): Promise<boolean> {
		const project = (await this.listProjects()).find((item) => item.id === id);
		if (!project) return false;
		await touchProject(project.path, project.dbPath);
		return setProjectPinned(project.path, pinned);
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
	abortAllActiveShellJobs();
	try {
		await shutdownPartContentWriter();
	} catch {}
	await defaultProjectManager.closeAllProjects();
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
		pinned: false,
	};
}
