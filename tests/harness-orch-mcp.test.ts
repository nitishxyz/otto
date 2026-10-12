import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { asSchema } from 'ai';
import {
	convertMCPToolsToAISDK,
	ensureMCPManager,
	getMCPManager,
	initializeMCP,
	OAuthCredentialStore,
	reloadMCPManager,
	shutdownMCP,
	type MCPServerManager,
} from '@ottocode/sdk';
import { getMCPManagerGeneration } from '../packages/sdk/src/core/src/mcp/lifecycle.ts';

let root = '';
const previousXdg = process.env.XDG_CONFIG_HOME;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'otto-harness-orch-mcp-'));
	process.env.XDG_CONFIG_HOME = join(root, 'xdg');
});

afterEach(async () => {
	await shutdownMCP(root);
	if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
	else process.env.XDG_CONFIG_HOME = previousXdg;
	await rm(root, { recursive: true, force: true });
});

const complexSchema = {
	type: 'object',
	properties: {
		target: {
			oneOf: [
				{ type: 'string', format: 'uri' },
				{
					type: 'object',
					properties: { path: { type: 'string' } },
					required: ['path'],
					additionalProperties: false,
				},
			],
		},
		limit: { type: 'integer', minimum: 1, maximum: 50 },
	},
	required: ['target'],
	additionalProperties: false,
};

function fakeManager(
	onCall: (args: Record<string, unknown>, signal?: AbortSignal) => void,
): MCPServerManager {
	return {
		getTools: () => [
			{
				name: 'srv__lookup',
				server: 'srv',
				tool: { name: 'lookup', inputSchema: complexSchema },
			},
		],
		callTool: async (
			_name: string,
			args: Record<string, unknown>,
			options?: { signal?: AbortSignal },
		) => {
			onCall(args, options?.signal);
			return { ok: true, result: 'done' };
		},
	} as unknown as MCPServerManager;
}

describe('MCP tool conversion', () => {
	it('preserves the original JSON schema instead of a lossy conversion', async () => {
		const [converted] = convertMCPToolsToAISDK(fakeManager(() => {}));
		const schema = await asSchema(
			converted?.tool.inputSchema as Parameters<typeof asSchema>[0],
		).jsonSchema;
		expect(schema).toEqual(complexSchema);
	});

	it('forwards the abort signal into the MCP request', async () => {
		let received: AbortSignal | undefined;
		const [converted] = convertMCPToolsToAISDK(
			fakeManager((_args, signal) => {
				received = signal;
			}),
		);
		const controller = new AbortController();
		await converted?.tool.execute?.(
			{ target: 'https://example.test' },
			{ toolCallId: 'call-1', messages: [], abortSignal: controller.signal },
		);
		expect(received).toBe(controller.signal);
	});
});

describe('MCP lifecycle serialization', () => {
	it('never creates competing managers for concurrent init and reload', async () => {
		const before = getMCPManagerGeneration(root);
		const [first, second, reloaded, third] = await Promise.all([
			ensureMCPManager(root),
			ensureMCPManager(root),
			reloadMCPManager(root),
			ensureMCPManager(root),
		]);
		expect(first).toBe(second);
		expect(reloaded).not.toBe(first);
		expect(third).toBe(reloaded);
		expect(getMCPManager(root)).toBe(reloaded);
		expect(getMCPManagerGeneration(root)).toBeGreaterThan(before);
	});

	it('serializes explicit initialization with ensure', async () => {
		const [initialized, ensured] = await Promise.all([
			initializeMCP({ servers: [] }, root),
			ensureMCPManager(root),
		]);
		expect(ensured).toBe(initialized);
		expect(getMCPManager(root)).toBe(initialized);
	});
});

describe('MCP OAuth credential store', () => {
	it('keeps identities that sanitize to the same name separate', async () => {
		const store = new OAuthCredentialStore(join(root, 'oauth'));
		await store.saveTokens('srv.a', { access_token: 'dot' });
		await store.saveTokens('srv_a', { access_token: 'underscore' });
		expect((await store.loadTokens('srv.a'))?.access_token).toBe('dot');
		expect((await store.loadTokens('srv_a'))?.access_token).toBe('underscore');
	});

	it('serializes concurrent read-modify-write updates', async () => {
		const store = new OAuthCredentialStore(join(root, 'oauth'));
		await Promise.all([
			store.saveTokens('srv', { access_token: 'tok' }),
			store.saveClientInfo('srv', { client_id: 'client' }),
			store.saveCodeVerifier('srv', 'verifier'),
		]);
		expect((await store.loadTokens('srv'))?.access_token).toBe('tok');
		expect((await store.loadClientInfo('srv'))?.client_id).toBe('client');
		expect(await store.loadCodeVerifier('srv')).toBe('verifier');
		const files = await readdir(join(root, 'oauth'));
		expect(files.filter((file) => file.endsWith('.tmp'))).toEqual([]);
	});

	it('clears legacy files so logout is not undone by migration fallback', async () => {
		const dir = join(root, 'oauth');
		const store = new OAuthCredentialStore(dir);
		await store.saveTokens('legacy', { access_token: 'new' });
		await writeFile(
			join(dir, 'legacy.json'),
			JSON.stringify({ tokens: { access_token: 'old' } }),
		);
		await store.clearServer('legacy');
		expect(await store.loadTokens('legacy')).toBeUndefined();
	});
});
