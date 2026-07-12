import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { getGlobalConfigDir } from '../../../config/src/paths.ts';
import type { MCPServerConfig } from './types.ts';

export async function readMcpServersFromFile(
	filePath: string,
): Promise<MCPServerConfig[]> {
	try {
		const text = await fs.readFile(filePath, 'utf-8');
		const json = JSON.parse(text);
		if (!json?.mcp?.servers) return [];
		const raw = json.mcp.servers;
		if (!Array.isArray(raw)) return [];
		return raw.filter(
			(server: unknown): server is MCPServerConfig =>
				typeof server === 'object' &&
				server !== null &&
				typeof (server as MCPServerConfig).name === 'string' &&
				(typeof (server as MCPServerConfig).command === 'string' ||
					typeof (server as MCPServerConfig).url === 'string'),
		);
	} catch {
		return [];
	}
}

export async function readUserMcpServersFromConfigFiles(
	projectRoot: string,
	globalConfigDir = getGlobalConfigDir(),
): Promise<{ global: MCPServerConfig[]; project: MCPServerConfig[] }> {
	const globalPath = join(globalConfigDir, 'config.json');
	const projectPath = join(projectRoot, '.otto', 'config.json');

	return {
		global: await readMcpServersFromFile(globalPath),
		project: await readMcpServersFromFile(projectPath),
	};
}
