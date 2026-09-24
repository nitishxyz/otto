import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '@ottocode/sdk';
import { createApp } from '@ottocode/server';

let home: string;
let original: Record<string, string | undefined>;
beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), 'otto-memory-config-'));
	original = {
		HOME: process.env.HOME,
		XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
		XDG_STATE_HOME: process.env.XDG_STATE_HOME,
		TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
	};
	process.env.HOME = home;
	process.env.XDG_CONFIG_HOME = join(home, '.config');
	process.env.XDG_STATE_HOME = join(home, '.state');
	delete process.env.TYPESAFE_API_KEY;
});
afterEach(async () => {
	for (const [key, value] of Object.entries(original)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	await rm(home, { recursive: true, force: true });
});

test('memory config defaults, global persistence and project override protection', async () => {
	const app = createApp();
	const project = join(home, 'project');
	await mkdir(join(project, '.otto'), { recursive: true });
	const first = await app.request('/v1/config/memory');
	const defaults = await first.json();
	expect(first.status).toBe(200);
	expect(defaults.settings).toEqual({
		enabled: true,
		autoCapture: true,
		recall: true,
		recallInSubagents: true,
		captureInSubagents: false,
		embeddings: {},
	});
	expect(defaults.typesafe).toEqual({ configured: false });
	expect(defaults.embeddings).toMatchObject({
		backend: 'local',
		configured: true,
		model: 'local:Xenova/all-MiniLM-L6-v2',
		dims: 384,
		ready: false,
		state: 'not-loaded',
	});
	expect(defaults.path).toContain('memory.sqlite');
	const put = await app.request('/v1/config/memory', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ enabled: false, autoCapture: false }),
	});
	expect(put.status).toBe(200);
	expect((await put.json()).settings).toEqual({
		enabled: false,
		autoCapture: false,
		recall: true,
		recallInSubagents: true,
		captureInSubagents: false,
		embeddings: {},
	});
	const file = JSON.parse(
		await readFile(join(home, '.config', 'otto', 'config.json'), 'utf8'),
	);
	expect(file.memory).toEqual({ enabled: false, autoCapture: false });
	await writeFile(
		join(project, '.otto', 'config.json'),
		JSON.stringify({ memory: { enabled: true } }),
	);
	expect((await loadConfig(project)).memory?.enabled).toBe(false);
	process.env.TYPESAFE_API_KEY = 'test-key';
	const available = await (await app.request('/v1/config/memory')).json();
	expect(available.typesafe.configured).toBe(true);
	expect(JSON.stringify(available)).not.toContain('test-key');
	const invalid = await app.request('/v1/config/memory', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ recall: 'no' }),
	});
	expect(invalid.status).toBe(400);
});
