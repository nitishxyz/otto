import { test, expect } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MemoryStore } from '@ottocode/sdk/memory';

function text(result: Awaited<ReturnType<Client['callTool']>>): unknown {
	const part = result.content[0];
	if (part?.type !== 'text') throw new Error('Expected MCP text');
	return JSON.parse(part.text);
}

test('external MCP client and Otto share memory, with project isolation', async () => {
	const home = mkdtempSync(join(tmpdir(), 'otto-mcp-home-'));
	const project = join(home, 'first');
	const other = join(home, 'second');
	mkdirSync(project);
	mkdirSync(other);
	const connect = async (root: string) => {
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [resolve('apps/cli/index.ts'), 'mcp', 'memory', '--project', root],
			env: {
				...process.env,
				HOME: home,
				XDG_STATE_HOME: join(home, '.state'),
				APPDATA: home,
				TYPESAFE_API_KEY: '',
			} as Record<string, string>,
			stderr: 'pipe',
		});
		const client = new Client({ name: 'memory-test', version: '1.0.0' });
		await client.connect(transport);
		return client;
	};
	try {
		const first = await connect(project);
		try {
			const tools = await first.listTools();
			expect(tools.tools.map((item) => item.name)).toEqual([
				'recall_memory',
				'remember',
				'memory_history',
				'forget_memory',
			]);
			const projectMemory = text(
				await first.callTool({
					name: 'remember',
					arguments: {
						content: 'Project comet observatory',
						scope: 'project',
						source: 'Codex user request',
					},
				}),
			) as { status: string; memory?: { id: string } };
			expect(projectMemory.status).toBe('created');
			if (!projectMemory.memory) throw new Error('Expected MCP memory');
			const history = text(
				await first.callTool({
					name: 'memory_history',
					arguments: { id: projectMemory.memory.id },
				}),
			) as {
				lineage: { head: { id: string }; edges: Array<{ type: string }> };
			};
			expect(history.lineage.head.id).toBe(projectMemory.memory.id);
			expect(
				history.lineage.edges.some((edge) => edge.type === 'derived_from'),
			).toBe(true);
			await first.callTool({
				name: 'remember',
				arguments: {
					content: 'Global meteor preference',
					scope: 'global',
					source: 'Codex user request',
				},
			});
		} finally {
			await first.close();
		}
		const path =
			process.platform === 'darwin'
				? join(home, 'Library', 'Application Support', 'otto', 'memory.sqlite')
				: process.platform === 'win32'
					? join(home, 'otto', 'memory.sqlite')
					: join(home, '.state', 'otto', 'memory.sqlite');
		const activityStore = new MemoryStore(path);
		try {
			expect(
				activityStore
					.activity()
					.some(
						(event) =>
							event.type === 'remember' && event.agent === 'mcp:memory-test',
					),
			).toBe(true);
			expect(
				activityStore
					.graph({ includeSuperseded: true })
					.nodes.find(
						(node) =>
							node.kind === 'memory' &&
							node.content === 'Project comet observatory',
					)?.source?.agent,
			).toBe('mcp:memory-test');
		} finally {
			activityStore.close();
		}
		const second = await connect(other);
		try {
			expect(
				(
					text(
						await second.callTool({
							name: 'recall_memory',
							arguments: { query: 'comet' },
						}),
					) as { memories: unknown[] }
				).memories,
			).toHaveLength(0);
			expect(
				(
					text(
						await second.callTool({
							name: 'recall_memory',
							arguments: { query: 'meteor' },
						}),
					) as { memories: unknown[] }
				).memories,
			).toHaveLength(1);
		} finally {
			await second.close();
		}
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}, 30_000);
