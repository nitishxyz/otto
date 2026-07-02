import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createApp } from '@ottocode/server';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('git routes', () => {
	let projectDir: string;

	beforeEach(async () => {
		projectDir = await mkdtemp(join(tmpdir(), 'otto-git-routes-'));
	});

	afterEach(async () => {
		await rm(projectDir, { recursive: true, force: true });
	});

	test('initializes a repository in an existing directory', async () => {
		const app = createApp();
		const expectedPath = await realpath(projectDir);

		const response = await app.request(
			`/v1/git/init?project=${encodeURIComponent(projectDir)}`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({}),
			},
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({
			status: 'ok',
			data: { initialized: true, path: expectedPath },
		});
	});

	test('treats existing repositories as a successful no-op', async () => {
		await execFileAsync('git', ['init'], { cwd: projectDir });
		const app = createApp();
		const expectedPath = await realpath(projectDir);

		const response = await app.request(
			`/v1/git/init?project=${encodeURIComponent(projectDir)}`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({}),
			},
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({
			status: 'ok',
			data: { initialized: false, path: expectedPath },
		});
	});

	test('rejects rebase actions when no rebase is in progress', async () => {
		await execFileAsync('git', ['init'], { cwd: projectDir });
		const app = createApp();

		const response = await app.request(
			`/v1/git/rebase?project=${encodeURIComponent(projectDir)}`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'continue' }),
			},
		);
		const body = await response.json();

		expect(response.status).toBe(409);
		expect(body.status).toBe('error');
		expect(body.code).toBe('NO_REBASE_IN_PROGRESS');
	});
});
