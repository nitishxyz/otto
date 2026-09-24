import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openMemory } from '@ottocode/sdk/memory';

const available = Boolean(process.env.TYPESAFE_API_KEY?.trim());
test.skipIf(!available)(
	'live Jev audience judgment classifies orchestration without printing credentials',
	async () => {
		const root = mkdtempSync(join(tmpdir(), 'otto-audience-live-'));
		const store = await openMemory(join(root, 'memory.sqlite'));
		try {
			const context = { projectRoot: root };
			const result = await store.remember(
				{
					content:
						'Always compact sub-agent context around 250k tokens when managing delegated workers.',
					scope: 'project',
					origin: 'explicit',
					source: 'synthetic live judgment',
				},
				context,
			);
			expect(result.status).toBe('created');
			expect(result.memory?.audience).toBe('orchestration');
		} finally {
			store.close();
			rmSync(root, { recursive: true, force: true });
		}
	},
	30_000,
);
