import { resolveEffectivePlugins } from '../../../plugins/index.ts';
import type {
	MCPConfig,
	MCPOAuthConfig,
	MCPScope,
	MCPServerConfig,
	MCPServerSource,
} from './types.ts';
import { readUserMcpServersFromConfigFiles } from './user-config.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function parsePluginMcpEntry(
	name: string,
	raw: unknown,
	pluginName: string,
	scope: MCPScope,
): MCPServerConfig | null {
	if (!isRecord(raw)) return null;

	const transport =
		raw.transport === 'http' || raw.transport === 'sse'
			? raw.transport
			: 'stdio';
	const command = typeof raw.command === 'string' ? raw.command : undefined;
	const url = typeof raw.url === 'string' ? raw.url : undefined;

	if (transport === 'stdio' && !command) return null;
	if ((transport === 'http' || transport === 'sse') && !url) return null;

	const source: MCPServerSource = {
		kind: 'plugin',
		scope,
		plugin: pluginName,
	};

	return {
		name,
		transport,
		...(command ? { command } : {}),
		...(Array.isArray(raw.args)
			? { args: raw.args.map((arg) => String(arg)) }
			: {}),
		...(isRecord(raw.env)
			? {
					env: Object.fromEntries(
						Object.entries(raw.env).map(([key, value]) => [key, String(value)]),
					),
				}
			: {}),
		...(typeof raw.cwd === 'string' ? { cwd: raw.cwd } : {}),
		...(url ? { url } : {}),
		...(isRecord(raw.headers)
			? {
					headers: Object.fromEntries(
						Object.entries(raw.headers).map(([key, value]) => [
							key,
							String(value),
						]),
					),
				}
			: {}),
		...(isRecord(raw.oauth) ? { oauth: raw.oauth as MCPOAuthConfig } : {}),
		...(typeof raw.disabled === 'boolean' ? { disabled: raw.disabled } : {}),
		scope,
		source,
	};
}

async function collectPluginMcpServers(
	projectRoot: string,
	layerScope: MCPScope,
): Promise<MCPServerConfig[]> {
	let effectivePlugins: Awaited<ReturnType<typeof resolveEffectivePlugins>>;
	try {
		effectivePlugins = await resolveEffectivePlugins(projectRoot);
	} catch {
		return [];
	}

	const servers: MCPServerConfig[] = [];
	for (const plugin of effectivePlugins.plugins) {
		if (
			!plugin.enabled ||
			plugin.status !== 'installed' ||
			!plugin.manifest?.mcpServers
		) {
			continue;
		}
		if (plugin.scope !== layerScope) continue;

		for (const [serverName, raw] of Object.entries(
			plugin.manifest.mcpServers,
		).sort(([a], [b]) => a.localeCompare(b))) {
			const parsed = parsePluginMcpEntry(
				serverName,
				raw,
				plugin.name,
				layerScope,
			);
			if (parsed) servers.push(parsed);
		}
	}

	return servers;
}

function tagUserServers(
	servers: MCPServerConfig[],
	scope: MCPScope,
): MCPServerConfig[] {
	return servers.map((server) => ({
		...server,
		scope,
		source: {
			kind: 'user',
			scope,
		} satisfies MCPServerSource,
	}));
}

function mergeMcpServerLayers(layers: MCPServerConfig[][]): MCPServerConfig[] {
	const merged = new Map<string, MCPServerConfig>();

	for (const layer of layers) {
		for (const server of layer) {
			const previous = merged.get(server.name);
			const next: MCPServerConfig = { ...server };

			if (previous?.source?.kind === 'plugin' && next.source?.kind === 'user') {
				next.source = {
					kind: 'user',
					scope: next.source.scope,
					overridesPlugin: previous.source.plugin,
				};
			}

			merged.set(server.name, next);
		}
	}

	return Array.from(merged.values()).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
}

/** Merges enabled plugin MCP defaults with user MCP config using plan precedence. */
export async function loadEffectiveMCPConfig(
	projectRoot: string,
	globalConfigDir?: string,
): Promise<MCPConfig> {
	const { global: globalUserServers, project: projectUserServers } =
		await readUserMcpServersFromConfigFiles(projectRoot, globalConfigDir);

	const servers = mergeMcpServerLayers([
		await collectPluginMcpServers(projectRoot, 'global'),
		tagUserServers(globalUserServers, 'global'),
		await collectPluginMcpServers(projectRoot, 'project'),
		tagUserServers(projectUserServers, 'project'),
	]);

	return { servers };
}

export function formatMcpServerSourceLabel(
	server: MCPServerConfig,
): string | undefined {
	if (server.source?.kind === 'plugin' && server.source.plugin) {
		return `plugin: ${server.source.plugin}`;
	}
	if (server.source?.kind === 'user') {
		return server.scope ?? server.source.scope ?? 'global';
	}
	return undefined;
}

export function isPluginManagedMcpServer(server: MCPServerConfig): boolean {
	return server.source?.kind === 'plugin';
}
