import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	addMCPServerToConfig,
	initializeMCP,
	MCPServerManager,
	shutdownMCP,
} from '@ottocode/sdk';
import { runForgeMCPAction } from '../packages/server/src/runtime/forge/mcp.ts';
import { clearMCPAuthFlows } from '../packages/server/src/routes/mcp/oauth-flows.ts';

describe('Forge MCP OAuth callback readiness', () => {
	let projectRoot: string;
	let callbackUrl: string;
	let pending = false;
	const name = 'forge-oauth-test';
	const authUrl = 'https://auth.example/authorize?state=forge-state';

	beforeEach(async () => {
		projectRoot = await mkdtemp(join(tmpdir(), 'otto-forge-oauth-'));
		const probe = createServer();
		await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
		const address = probe.address();
		if (!address || typeof address === 'string')
			throw new Error('Missing port');
		callbackUrl = `http://127.0.0.1:${address.port}/callback`;
		await new Promise<void>((resolve) => probe.close(() => resolve()));
		pending = false;
		await initializeMCP({ servers: [] }, projectRoot);
		spyOn(MCPServerManager.prototype, 'restartServer').mockImplementation(
			async () => {
				pending = true;
			},
		);
		spyOn(MCPServerManager.prototype, 'initiateAuth').mockImplementation(
			async () => {
				pending = true;
				return authUrl;
			},
		);
		spyOn(MCPServerManager.prototype, 'getAuthUrl').mockImplementation(() =>
			pending ? authUrl : null,
		);
		spyOn(MCPServerManager.prototype, 'getAuthCallbackUrl').mockImplementation(
			() => callbackUrl,
		);
		spyOn(MCPServerManager.prototype, 'getStatusAsync').mockResolvedValue([]);
		spyOn(MCPServerManager.prototype, 'completeAuth').mockResolvedValue(true);
	});

	afterEach(async () => {
		mock.restore();
		clearMCPAuthFlows();
		await shutdownMCP(projectRoot);
		await rm(projectRoot, { recursive: true, force: true });
	});

	async function completeCallback() {
		const response = await fetch(
			`${callbackUrl}?code=test-code&state=forge-state`,
		);
		expect(response.status).toBe(200);
		expect(MCPServerManager.prototype.completeAuth).toHaveBeenCalledWith(
			name,
			'test-code',
		);
	}

	test('fresh create/start returns a link only after the listener is ready', async () => {
		const result = await runForgeMCPAction(projectRoot, {
			action: 'create',
			name,
			transport: 'http',
			url: 'https://mcp.example/mcp',
			start: true,
		});
		expect(result).toMatchObject({ ok: true, server: { authUrl } });
		await completeCallback();
	});

	test('authenticate can be repeated before the browser returns', async () => {
		await addMCPServerToConfig(projectRoot, {
			name,
			scope: 'project',
			transport: 'http',
			url: 'https://mcp.example/mcp',
		});
		for (let i = 0; i < 2; i++) {
			const result = await runForgeMCPAction(projectRoot, {
				action: 'authenticate',
				name,
			});
			expect(result).toMatchObject({
				auth: { authUrl, callbackMode: 'daemon-loopback' },
			});
		}
		await completeCallback();
	});

	test('reports a bind failure instead of returning an unusable auth link', async () => {
		const blocker = createServer();
		await new Promise<void>((resolve) =>
			blocker.listen(Number(new URL(callbackUrl).port), '127.0.0.1', resolve),
		);
		try {
			const result = await runForgeMCPAction(projectRoot, {
				action: 'create',
				name,
				transport: 'http',
				url: 'https://mcp.example/mcp',
				start: true,
			});
			expect(result).toMatchObject({
				applied: true,
				startError: expect.any(String),
			});
			expect(
				'server' in result && result.server && 'authUrl' in result.server,
			).toBe(false);
		} finally {
			await new Promise<void>((resolve) => blocker.close(() => resolve()));
		}
	});
});
