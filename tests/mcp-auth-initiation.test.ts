import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { MCPClientWrapper } from '../packages/sdk/src/core/src/mcp/client.ts';
import { MCPServerManager } from '../packages/sdk/src/core/src/mcp/server-manager.ts';
import { OAuthCredentialStore } from '../packages/sdk/src/core/src/mcp/oauth/store.ts';
import type { OttoOAuthProvider } from '../packages/sdk/src/core/src/mcp/oauth/provider.ts';

const config = {
	name: 'auth-initiation-test',
	transport: 'http' as const,
	url: 'https://mcp.example/mcp',
};

afterEach(() => mock.restore());

describe('MCP auth initiation', () => {
	test('reuses a pending authorization without changing its PKCE provider', async () => {
		const providers = new WeakMap<MCPClientWrapper, OttoOAuthProvider>();
		spyOn(MCPClientWrapper.prototype, 'setAuthProvider').mockImplementation(
			function (provider) {
				providers.set(this, provider);
			},
		);
		const connect = spyOn(
			MCPClientWrapper.prototype,
			'connect',
		).mockImplementation(async function () {
			await providers
				.get(this)
				?.redirectToAuthorization(
					new URL('https://auth.example/authorize?state=pending'),
				);
			throw new Error('Authorization required');
		});
		const clear = spyOn(
			OAuthCredentialStore.prototype,
			'clearServer',
		).mockResolvedValue();
		const manager = new MCPServerManager();
		const first = await manager.initiateAuth(config);
		const second = await manager.initiateAuth(config);
		expect(first).toBe('https://auth.example/authorize?state=pending');
		expect(second).toBe(first);
		expect(connect).toHaveBeenCalledTimes(1);
		expect(clear).not.toHaveBeenCalled();
	});

	test('does not erase saved credentials when starting normal authentication', async () => {
		spyOn(MCPClientWrapper.prototype, 'connect').mockResolvedValue();
		spyOn(MCPClientWrapper.prototype, 'listTools').mockResolvedValue([]);
		const clear = spyOn(
			OAuthCredentialStore.prototype,
			'clearServer',
		).mockResolvedValue();
		const manager = new MCPServerManager();
		expect(await manager.initiateAuth(config)).toBeNull();
		expect(clear).not.toHaveBeenCalled();
	});

	test('propagates connection failures instead of reporting no auth required', async () => {
		spyOn(MCPClientWrapper.prototype, 'connect').mockRejectedValue(
			new Error('Connection refused'),
		);
		const manager = new MCPServerManager();
		await expect(manager.initiateAuth(config)).rejects.toThrow(
			'Connection refused',
		);
	});
});
