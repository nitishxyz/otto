import { MCPServerManager } from './server-manager.ts';
import { loadEffectiveMCPConfig } from './effective-config.ts';
import type { MCPConfig, MCPServerConfig, MCPScope } from './types.ts';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const legacyMCPManagerKey = 'legacy';
const mcpManagersByProject = new Map<string, MCPServerManager>();

function getMCPManagerKey(projectRoot?: string): string {
	return projectRoot || legacyMCPManagerKey;
}

export function getMCPManager(projectRoot?: string): MCPServerManager | null {
	return mcpManagersByProject.get(getMCPManagerKey(projectRoot)) ?? null;
}

export async function initializeMCP(
	config: MCPConfig,
	projectRoot?: string,
): Promise<MCPServerManager> {
	const managerKey = getMCPManagerKey(projectRoot);
	const existingManager = mcpManagersByProject.get(managerKey);
	if (existingManager) {
		await existingManager.stopAll();
	}
	const manager = new MCPServerManager();
	if (projectRoot) {
		manager.setProjectRoot(projectRoot);
	}
	await manager.startServers(config.servers);
	mcpManagersByProject.set(managerKey, manager);
	return manager;
}

export async function shutdownMCP(projectRoot?: string): Promise<void> {
	if (projectRoot) {
		const managerKey = getMCPManagerKey(projectRoot);
		const manager = mcpManagersByProject.get(managerKey);
		if (!manager) return;
		await manager.stopAll();
		mcpManagersByProject.delete(managerKey);
		return;
	}

	for (const [managerKey, manager] of mcpManagersByProject) {
		await manager.stopAll();
		mcpManagersByProject.delete(managerKey);
	}
}

export async function loadMCPConfig(
	projectRoot: string,
	globalConfigDir?: string,
): Promise<MCPConfig> {
	return loadEffectiveMCPConfig(projectRoot, globalConfigDir);
}

function resolveConfigPath(
	projectRoot: string,
	globalConfigDir: string | undefined,
	scope: MCPScope,
): string {
	if (scope === 'global' && globalConfigDir) {
		return join(globalConfigDir, 'config.json');
	}
	return join(projectRoot, '.otto', 'config.json');
}

async function ensureConfigDir(configPath: string): Promise<void> {
	const dir = configPath.replace(/[/\\][^/\\]+$/, '');
	await fs.mkdir(dir, { recursive: true });
}

export async function addMCPServerToConfig(
	projectRoot: string,
	server: MCPServerConfig,
	globalConfigDir?: string,
): Promise<void> {
	const scope: MCPScope = server.scope ?? 'global';
	const configPath = resolveConfigPath(projectRoot, globalConfigDir, scope);

	let json: Record<string, unknown> = {};
	try {
		const text = await fs.readFile(configPath, 'utf-8');
		json = JSON.parse(text);
	} catch {}

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
	globalConfigDir?: string,
): Promise<boolean> {
	const paths = [
		...(globalConfigDir ? [join(globalConfigDir, 'config.json')] : []),
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
