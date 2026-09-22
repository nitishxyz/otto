import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAuth } from '@ottocode/sdk';
import { createApp } from '@ottocode/server';

describe('judge config route', () => {
	let tempHome: string;
	let projectRoot: string;
	let originalEnv: Record<string, string | undefined>;

	beforeEach(async () => {
		tempHome = await mkdtemp(join(tmpdir(), 'otto-judge-route-'));
		projectRoot = join(tempHome, 'project');
		await mkdir(projectRoot, { recursive: true });
		originalEnv = {
			HOME: process.env.HOME,
			XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
			XDG_STATE_HOME: process.env.XDG_STATE_HOME,
			TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
		};
		process.env.HOME = tempHome;
		process.env.XDG_CONFIG_HOME = join(tempHome, '.config');
		process.env.XDG_STATE_HOME = join(tempHome, '.state');
		delete process.env.TYPESAFE_API_KEY;
	});

	afterEach(async () => {
		for (const [key, value] of Object.entries(originalEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await rm(tempHome, { recursive: true, force: true });
	});

	test('reports defaults and no credential on a fresh install', async () => {
		const app = createApp();
		const response = await app.request(
			`/v1/config/judge?project=${encodeURIComponent(projectRoot)}`,
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.settings).toMatchObject({
			enabled: true,
			provider: 'typesafe',
			baseURL: 'https://api.typesafe.ai',
			model: 'jev-latest',
			mcp: { classifyTools: true, preloadTools: true, preloadThreshold: 0.5 },
		});
		expect(body.credential).toEqual({
			configured: false,
			source: 'none',
			envVar: 'TYPESAFE_API_KEY',
		});
	});

	test('stores the key, persists settings, and clears the key', async () => {
		const app = createApp();
		const query = `?project=${encodeURIComponent(projectRoot)}`;

		const put = await app.request(`/v1/config/judge${query}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				apiKey: '  ts_secret  ',
				baseURL: 'https://judge.internal/',
				mcp: { preloadThreshold: 0.7 },
			}),
		});
		expect(put.status).toBe(200);
		const updated = await put.json();
		expect(updated.success).toBe(true);
		expect(updated.credential).toMatchObject({
			configured: true,
			source: 'stored',
		});
		expect(updated.settings.baseURL).toBe('https://judge.internal');
		expect(updated.settings.mcp.preloadThreshold).toBe(0.7);
		expect(updated.settings.mcp.classifyTools).toBe(true);

		const stored = await getAuth('typesafe', projectRoot);
		expect(stored).toEqual({ type: 'api', key: 'ts_secret' });

		const configFile = JSON.parse(
			await readFile(join(tempHome, '.config', 'otto', 'config.json'), 'utf8'),
		);
		expect(configFile.judge).toEqual({
			baseURL: 'https://judge.internal',
			mcp: { preloadThreshold: 0.7 },
		});
		expect(JSON.stringify(configFile)).not.toContain('ts_secret');

		const cleared = await app.request(`/v1/config/judge${query}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ apiKey: '', enabled: false }),
		});
		const clearedBody = await cleared.json();
		expect(clearedBody.credential.configured).toBe(false);
		expect(clearedBody.settings.enabled).toBe(false);
		expect(await getAuth('typesafe', projectRoot)).toBeUndefined();
	});

	test('rejects an out-of-range threshold', async () => {
		const app = createApp();
		const response = await app.request(
			`/v1/config/judge?project=${encodeURIComponent(projectRoot)}`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mcp: { preloadThreshold: 1.5 } }),
			},
		);
		expect(response.status).toBe(400);
	});

	test('prefers the environment key and reports it', async () => {
		process.env.TYPESAFE_API_KEY = 'env-key';
		const app = createApp();
		const response = await app.request(
			`/v1/config/judge?project=${encodeURIComponent(projectRoot)}`,
		);
		const body = await response.json();
		expect(body.credential).toMatchObject({ configured: true, source: 'env' });
	});
});
