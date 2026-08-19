import {
	getActiveMCPProjectRoots,
	getGlobalConfigDir,
	getMCPManager,
	loadMCPConfig,
	type MCPScope,
} from '@ottocode/sdk';

/** Reconciles one MCP without restarting unrelated servers. */
export async function reconcileMCPServerManagers(
	projectRoot: string,
	scope: MCPScope,
	name: string,
): Promise<void> {
	const roots =
		scope === 'global'
			? new Set([...getActiveMCPProjectRoots(), projectRoot])
			: new Set([projectRoot]);
	await Promise.all(
		Array.from(roots, async (root) => {
			const manager = getMCPManager(root);
			if (!manager) return;
			const config = await loadMCPConfig(root, getGlobalConfigDir());
			const server = config.servers.find((entry) => entry.name === name);
			if (!server || server.disabled !== false) {
				await manager.stopServer(name);
				return;
			}
			await manager.restartServer(server);
		}),
	);
}
