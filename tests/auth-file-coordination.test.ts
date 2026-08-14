import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAllAuth, setAuth } from '../packages/sdk/src/auth/src/index.ts';
import { getSecureAuthPath } from '../packages/sdk/src/config/src/paths.ts';

const originalHome = process.env.HOME;
const originalXdgState = process.env.XDG_STATE_HOME;
const originalAppData = process.env.APPDATA;
let tempHome: string;

beforeEach(async () => {
	tempHome = await mkdtemp(join(tmpdir(), 'otto-auth-file-test-'));
	process.env.HOME = tempHome;
	process.env.XDG_STATE_HOME = join(tempHome, 'state');
	process.env.APPDATA = join(tempHome, 'appdata');
});

afterEach(async () => {
	process.env.HOME = originalHome;
	if (originalXdgState === undefined) delete process.env.XDG_STATE_HOME;
	else process.env.XDG_STATE_HOME = originalXdgState;
	if (originalAppData === undefined) delete process.env.APPDATA;
	else process.env.APPDATA = originalAppData;
	await rm(tempHome, { recursive: true, force: true });
});

describe('auth file mutation coordination', () => {
	test('waits for another process lock and merges the latest provider state', async () => {
		await setAuth('github', { type: 'api', key: 'github-key' });
		const authPath = getSecureAuthPath();
		const lockPath = `${authPath}.lock`;
		await mkdir(lockPath);

		let settled = false;
		const pending = setAuth('ottorouter', {
			type: 'oauth',
			access: 'access-token',
			refresh: 'refresh-token',
			expires: Date.now() + 60 * 60 * 1000,
		}).finally(() => {
			settled = true;
		});
		await Bun.sleep(25);
		expect(settled).toBe(false);

		const current = JSON.parse(await readFile(authPath, 'utf8')) as Record<
			string,
			unknown
		>;
		current.xai = { type: 'api', key: 'xai-key' };
		await writeFile(authPath, JSON.stringify(current));
		await rm(lockPath, { recursive: true, force: true });
		await pending;

		expect(await getAllAuth()).toMatchObject({
			github: { type: 'api', key: 'github-key' },
			xai: { type: 'api', key: 'xai-key' },
			ottorouter: {
				type: 'oauth',
				access: 'access-token',
				refresh: 'refresh-token',
			},
		});
	});
});
