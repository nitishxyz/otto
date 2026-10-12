import { MCPServerManager } from './server-manager.ts';
import { loadEffectiveMCPConfig } from './effective-config.ts';
import { clearMCPToolClassifications } from './classification-registry.ts';
import type { MCPConfig, MCPServerConfig, MCPScope } from './types.ts';
import { getGlobalConfigDir } from '../../../config/src/paths.ts';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const legacyMCPManagerKey = 'legacy';
const mcpManagersByProject = new Map<string, MCPServerManager>();
/** Tail of the per-key lifecycle queue; every mutation runs serialized. */
const lifecycleQueues = new Map<string, Promise<unknown>>();
/** Monotonic per-key generation; bumps whenever the live manager changes. */
const managerGenerations = new Map<string, number>();

function getMCPManagerKey(projectRoot?: string): string {
	return projectRoot || legacyMCPManagerKey;
}

function serializeLifecycle<T>(
	key: string,
	task: () => Promise<T>,
): Promise<T> {
	const previous = lifecycleQueues.get(key) ?? Promise.resolve();
	const run = previous.catch(() => {}).then(task);
	const tail = run.catch(() => {});
	lifecycleQueues.set(key, tail);
	void tail.then(() => {
		if (lifecycleQueues.get(key) === tail) lifecycleQueues.delete(key);
	});
	return run;
}

function bumpGeneration(key: string): number {
	const next = (managerGenerations.get(key) ?? 0) + 1;
	managerGenerations.set(key, next);
	return next;
}

/**
 * Generation of a project's MCP manager state. Changes whenever a manager is
 * created, replaced, reconciled, or shut down; tool snapshots taken at an older
 * generation are stale.
 */
export function getMCPManagerGeneration(projectRoot?: string): number {
	return managerGenerations.get(getMCPManagerKey(projectRoot)) ?? 0;
}

export function getMCPManager(projectRoot?: string): MCPServerManager | null {
	return mcpManagersByProject.get(getMCPManagerKey(projectRoot)) ?? null;
}

/** Lists project roots with active MCP managers. */
export function getActiveMCPProjectRoots(): string[] {
	return Array.from(mcpManagersByProject.keys()).filter(
		(key) => key !== legacyMCPManagerKey,
	);
}

/** Initializes a project's manager from its effective global and project config. */
export async function ensureMCPManager(
	projectRoot: string,
	globalConfigDir = getGlobalConfigDir(),
): Promise<MCPServerManager> {
	const existing = getMCPManager(projectRoot);
	if (existing) return existing;
	return serializeLifecycle(getMCPManagerKey(projectRoot), async () => {
		const current = getMCPManager(projectRoot);
		if (current) return current;
		return initializeMCPUnlocked(
			await loadEffectiveMCPConfig(projectRoot, globalConfigDir),
			projectRoot,
		);
	});
}

/** Reloads a project's manager from persisted effective MCP configuration. */
export async function reloadMCPManager(
	projectRoot: string,
	globalConfigDir = getGlobalConfigDir(),
): Promise<MCPServerManager> {
	return serializeLifecycle(getMCPManagerKey(projectRoot), async () =>
		initializeMCPUnlocked(
			await loadEffectiveMCPConfig(projectRoot, globalConfigDir),
			projectRoot,
		),
	);
}

export async function initializeMCP(
	config: MCPConfig,
	projectRoot?: string,
): Promise<MCPServerManager> {
	return serializeLifecycle(getMCPManagerKey(projectRoot), () =>
		initializeMCPUnlocked(config, projectRoot),
	);
}

async function initializeMCPUnlocked(
	config: MCPConfig,
	projectRoot?: string,
): Promise<MCPServerManager> {
	const managerKey = getMCPManagerKey(projectRoot);
	const existingManager = mcpManagersByProject.get(managerKey);
	if (existingManager) {
		mcpManagersByProject.delete(managerKey);
		await existingManager.stopAll();
	}
	bumpGeneration(managerKey);
	const manager = new MCPServerManager();
	if (projectRoot) {
		manager.setProjectRoot(projectRoot);
	}
	await manager.startServers(config.servers);
	mcpManagersByProject.set(managerKey, manager);
	bumpGeneration(managerKey);
	return manager;
}

function serverConfigSignature(config: MCPServerConfig): string {
	const { source: _source, ...rest } = config;
	return stableStringify(rest);
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
}

/**
 * Reconciles live MCP managers with the persisted effective configuration
 * (plugin defaults merged with user overrides). Stops servers that are gone
 * or disabled, starts new ones, and restarts changed ones without touching
 * unchanged servers. With no projectRoot, every active project is reconciled.
 */
export async function reconcileMCPManagers(
	projectRoot?: string,
	globalConfigDir = getGlobalConfigDir(),
): Promise<void> {
	const roots = projectRoot ? [projectRoot] : getActiveMCPProjectRoots();
	await Promise.all(
		roots.map((root) =>
			serializeLifecycle(getMCPManagerKey(root), async () => {
				const manager = getMCPManager(root);
				if (!manager) return;
				const config = await loadEffectiveMCPConfig(root, globalConfigDir);
				const desired = new Map(
					config.servers
						.filter((server) => server.disabled === false)
						.map((server) => [server.name, server]),
				);
				let changed = false;
				for (const name of manager.getServerNames()) {
					const next = desired.get(name);
					const current = manager.getServerConfig(name);
					if (
						next &&
						current &&
						serverConfigSignature(next) === serverConfigSignature(current)
					) {
						desired.delete(name);
						continue;
					}
					await manager.stopServer(name);
					changed = true;
				}
				for (const server of desired.values()) {
					await manager.restartServer(server);
					changed = true;
				}
				if (changed) {
					bumpGeneration(getMCPManagerKey(root));
					clearMCPToolClassifications(root);
				}
			}),
		),
	);
}

export async function shutdownMCP(projectRoot?: string): Promise<void> {
	if (projectRoot) {
		await shutdownKey(getMCPManagerKey(projectRoot));
		return;
	}

	const keys = new Set([
		...mcpManagersByProject.keys(),
		...lifecycleQueues.keys(),
	]);
	await Promise.all(Array.from(keys, (key) => shutdownKey(key)));
}

function shutdownKey(managerKey: string): Promise<void> {
	return serializeLifecycle(managerKey, async () => {
		const manager = mcpManagersByProject.get(managerKey);
		if (!manager) return;
		mcpManagersByProject.delete(managerKey);
		bumpGeneration(managerKey);
		await manager.stopAll();
	});
}

export async function loadMCPConfig(
	projectRoot: string,
	globalConfigDir = getGlobalConfigDir(),
): Promise<MCPConfig> {
	return loadEffectiveMCPConfig(projectRoot, globalConfigDir);
}

function resolveConfigPath(
	projectRoot: string,
	globalConfigDir: string,
	scope: MCPScope,
): string {
	if (scope === 'global') {
		return join(globalConfigDir, 'config.json');
	}
	return join(projectRoot, '.otto', 'config.json');
}

async function ensureConfigDir(configPath: string): Promise<void> {
	const dir = configPath.replace(/[/\\][^/\\]+$/, '');
	await fs.mkdir(dir, { recursive: true });
}

export async function setMCPServerDisabled(
	projectRoot: string,
	name: string,
	scope: MCPScope,
	disabled: boolean,
	globalConfigDir = getGlobalConfigDir(),
): Promise<boolean> {
	const configPath = resolveConfigPath(projectRoot, globalConfigDir, scope);
	let json: Record<string, unknown>;
	try {
		json = JSON.parse(await fs.readFile(configPath, 'utf-8'));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw error;
	}
	const mcp = json.mcp as Record<string, unknown> | undefined;
	if (!mcp || !Array.isArray(mcp.servers)) return false;
	const server = (mcp.servers as MCPServerConfig[]).find(
		(entry) => entry.name === name,
	);
	if (!server) return false;
	server.disabled = disabled;
	await fs.writeFile(configPath, JSON.stringify(json, null, '\t'), 'utf-8');
	return true;
}

export async function addMCPServerToConfig(
	projectRoot: string,
	server: MCPServerConfig,
	globalConfigDir = getGlobalConfigDir(),
): Promise<void> {
	const scope: MCPScope = server.scope ?? 'global';
	const configPath = resolveConfigPath(projectRoot, globalConfigDir, scope);

	let json: Record<string, unknown> = {};
	try {
		const text = await fs.readFile(configPath, 'utf-8');
		json = JSON.parse(text);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}

	if (!json.mcp) json.mcp = {};
	const mcp = json.mcp as Record<string, unknown>;
	if (!Array.isArray(mcp.servers)) mcp.servers = [];

	const servers = mcp.servers as MCPServerConfig[];
	const idx = servers.findIndex((s) => s.name === server.name);

	const { scope: _scope, ...serverWithoutScope } = server;
	if (idx >= 0) {
		servers[idx] = serverWithoutScope;
	} else {
		servers.push(serverWithoutScope);
	}

	await ensureConfigDir(configPath);
	await fs.writeFile(configPath, JSON.stringify(json, null, '\t'), 'utf-8');
}

export async function removeMCPServerFromConfig(
	projectRoot: string,
	name: string,
	globalConfigDir = getGlobalConfigDir(),
	scope?: MCPScope,
): Promise<boolean> {
	const paths = scope
		? [resolveConfigPath(projectRoot, globalConfigDir, scope)]
		: [
				join(globalConfigDir, 'config.json'),
				join(projectRoot, '.otto', 'config.json'),
			];

	for (const configPath of paths) {
		let json: Record<string, unknown> = {};
		try {
			const text = await fs.readFile(configPath, 'utf-8');
			json = JSON.parse(text);
		} catch {
			continue;
		}

		const mcp = json.mcp as Record<string, unknown> | undefined;
		if (!mcp || !Array.isArray(mcp.servers)) continue;

		const servers = mcp.servers as MCPServerConfig[];
		const idx = servers.findIndex((s) => s.name === name);
		if (idx < 0) continue;

		servers.splice(idx, 1);
		await fs.writeFile(configPath, JSON.stringify(json, null, '\t'), 'utf-8');
		return true;
	}

	return false;
}
