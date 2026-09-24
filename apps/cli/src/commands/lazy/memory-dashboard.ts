import type { Command } from 'commander';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { openMemory } from '@ottocode/sdk/memory';
import { loadGlobalConfig } from '@ottocode/sdk';
import {
	resolveMemoryEmbedder,
	memoryEmbeddingStatus,
} from '@ottocode/sdk/memory/embedder';

export function registerMemoryDashboardCommand(program: Command): void {
	const memory = program
		.command('memory')
		.description('Shared memory utilities');
	memory
		.command('reindex')
		.option('--limit <count>', 'Maximum existing memories to backfill', '500')
		.option(
			'--dry-run',
			'Check backend and readiness without downloading a model',
		)
		.description('Backfill missing embeddings with configured memory provider')
		.action(async (opts: { limit: string; dryRun?: boolean }) => {
			const config = await loadGlobalConfig();
			if (opts.dryRun) {
				const status = await memoryEmbeddingStatus(config.memory?.embeddings);
				console.log(
					`Embedding backend: ${status.backend}; model: ${status.model}; ready: ${status.ready}`,
				);
				return;
			}
			const embedder = await resolveMemoryEmbedder(config.memory?.embeddings);
			if (!embedder) {
				console.log(
					'No embeddings provider configured. Configure memory.embeddings and provider credentials first.',
				);
				return;
			}
			const store = await openMemory(
				undefined,
				config.judge,
				undefined,
				'otto',
				config.memory,
			);
			try {
				console.log(
					`Embedded ${await store.reindex(Number(opts.limit))} memories (${embedder.model}).`,
				);
				console.log(`Model ready (${embedder.model}, ${embedder.dims} dims).`);
			} finally {
				store.close();
			}
		});
	memory
		.command('dashboard')
		.description('Start the local memory dashboard')
		.option('--port <port>', 'Local dashboard port', '9200')
		.option('--assets <path>', 'Built dashboard assets directory')
		.option('--open', 'Open the dashboard in a browser')
		.action(async (opts: { port: string; open?: boolean; assets?: string }) => {
			const port = Number(opts.port);
			if (!Number.isInteger(port) || port < 0 || port > 65535)
				throw new Error('Invalid dashboard port');
			const { serveMemoryDashboard } = await import(
				'@ottocode/server/memory-dashboard'
			);
			const dir = [
				opts.assets,
				resolve(process.cwd(), 'apps/memory-dashboard/dist'),
				resolve(dirname(process.execPath), 'memory-dashboard'),
			]
				.filter((value): value is string => Boolean(value))
				.map((value) => resolve(value))
				.find((value) => existsSync(resolve(value, 'index.html')));
			const server = serveMemoryDashboard({
				port,
				assetsDir: dir,
			});
			const url = `http://127.0.0.1:${server.port}`;
			console.log(`Memory dashboard: ${url}`);
			if (opts.open) {
				const { spawn } = await import('node:child_process');
				const command =
					process.platform === 'darwin'
						? 'open'
						: process.platform === 'win32'
							? 'cmd'
							: 'xdg-open';
				spawn(
					command,
					process.platform === 'win32' ? ['/c', 'start', url] : [url],
					{ detached: true, stdio: 'ignore' },
				).unref();
			}
		});
}
