import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { describe, expect, it } from 'bun:test';
import {
	getGlobalConfigPath,
	getGlobalSkillsConfigPath,
	getLegacyProjectDataDir,
	getLocalDataDir,
	getOttoHomeDir,
	getProjectAttachmentsDir,
	getProjectCacheDir,
	getProjectConfigDir,
	getProjectConfigPath,
	getProjectDbPath,
	getProjectDebugDir,
	getProjectDebugDumpsDir,
	getProjectId,
	getProjectLogsDir,
	getProjectsStateRoot,
	getProjectStateDir,
	getProjectTmpDir,
	loadConfig,
	setConfig,
	writeSkillSettings,
} from '@ottocode/sdk';
import { createEmbeddedApp } from '../packages/server/src/index.js';

const execFileAsync = promisify(execFile);

describe('config loader', () => {
	it('loads defaults when no config files present', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-config-defaults-'));
		const previousOttoHome = process.env.OTTO_HOME;
		const ottoHome = join(projectRoot, 'otto-home');
		process.env.OTTO_HOME = ottoHome;

		try {
			const cfg = await loadConfig(projectRoot);
			const projectStateDir = await getProjectStateDir(projectRoot);

			expect(cfg.projectRoot).toBe(projectRoot);
			expect(cfg.defaults.agent).toBeDefined();
			expect(cfg.defaults.provider).toBeDefined();
			expect(cfg.defaults.model).toBeDefined();
			expect(cfg.defaults.fullWidthContent).toBe(false);
			expect(cfg.paths.projectConfigDir).toBe(join(projectRoot, '.otto'));
			expect(cfg.paths.projectConfigPath).toBeNull();
			expect(cfg.paths.projectStateDir).toBe(projectStateDir);
			expect(cfg.paths.dataDir).toBe(projectStateDir);
			expect(cfg.paths.dbPath).toBe(join(projectStateDir, 'otto.sqlite'));
			expect(cfg.paths.attachmentsDir).toBe(
				join(projectStateDir, 'attachments'),
			);
			expect(cfg.paths.debugDir).toBe(join(projectStateDir, 'debug'));
			expect(cfg.paths.debugDumpsDir).toBe(
				join(projectStateDir, 'debug-dumps'),
			);
			expect(cfg.paths.logsDir).toBe(join(projectStateDir, 'logs'));
			expect(cfg.paths.tmpDir).toBe(join(projectStateDir, 'tmp'));
			expect(cfg.paths.cacheDir).toBe(join(projectStateDir, 'cache'));
			expect(await Bun.file(join(projectStateDir, '.keep')).exists()).toBe(
				false,
			);
		} finally {
			if (previousOttoHome === undefined) {
				delete process.env.OTTO_HOME;
			} else {
				process.env.OTTO_HOME = previousOttoHome;
			}
			await rm(projectRoot, { recursive: true, force: true });
		}
	});

	it('persists project-scoped model defaults in local config', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-config-'));
		const previousOttoHome = process.env.OTTO_HOME;
		const ottoHome = join(projectRoot, 'otto-home');
		process.env.OTTO_HOME = ottoHome;

		try {
			await setConfig(
				'local',
				{
					model: 'project-model',
				},
				projectRoot,
			);

			const cfg = await loadConfig(projectRoot);
			expect(cfg.defaults.model).toBe('project-model');
			expect(cfg.paths.projectConfigPath).toBe(
				join(projectRoot, '.otto', 'config.json'),
			);
			expect(cfg.paths.dbPath.startsWith(ottoHome)).toBe(true);
		} finally {
			if (previousOttoHome === undefined) {
				delete process.env.OTTO_HOME;
			} else {
				process.env.OTTO_HOME = previousOttoHome;
			}
			await rm(projectRoot, { recursive: true, force: true });
		}
	});

	it('warns when a legacy database exists without a migrated state database', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-config-legacy-db-'));
		const previousOttoHome = process.env.OTTO_HOME;
		const originalWarn = console.warn;
		const warnings: string[] = [];
		const ottoHome = join(projectRoot, 'otto-home');
		process.env.OTTO_HOME = ottoHome;
		console.warn = (message?: unknown) => {
			warnings.push(String(message));
		};

		try {
			await mkdir(join(projectRoot, '.otto'), { recursive: true });
			await writeFile(join(projectRoot, '.otto', 'otto.sqlite'), 'legacy');

			const cfg = await loadConfig(projectRoot);

			expect(cfg.paths.dbPath.startsWith(ottoHome)).toBe(true);
			expect(cfg.paths.dbPath).not.toBe(
				join(projectRoot, '.otto', 'otto.sqlite'),
			);
			expect(
				warnings.some((warning) => warning.includes('otto storage migrate')),
			).toBe(true);
		} finally {
			console.warn = originalWarn;
			if (previousOttoHome === undefined) {
				delete process.env.OTTO_HOME;
			} else {
				process.env.OTTO_HOME = previousOttoHome;
			}
			await rm(projectRoot, { recursive: true, force: true });
		}
	});

	it('keeps global UI preferences from being shadowed by local config', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-config-local-'));
		const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
		const previousOttoHome = process.env.OTTO_HOME;
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
		process.env.OTTO_HOME = join(projectRoot, 'otto-home');

		try {
			await setConfig(
				'global',
				{
					compactThread: false,
					fullWidthContent: true,
				},
				projectRoot,
			);

			const localConfigDir = join(projectRoot, '.otto');
			await mkdir(localConfigDir, { recursive: true });
			await Bun.write(
				join(localConfigDir, 'config.json'),
				JSON.stringify(
					{
						defaults: {
							model: 'project-model',
							compactThread: true,
							fullWidthContent: false,
						},
					},
					null,
					2,
				),
			);

			const cfg = await loadConfig(projectRoot);
			expect(cfg.defaults.model).toBe('project-model');
			expect(cfg.defaults.compactThread).toBe(false);
			expect(cfg.defaults.fullWidthContent).toBe(true);
		} finally {
			if (previousXdgConfigHome === undefined) {
				delete process.env.XDG_CONFIG_HOME;
			} else {
				process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
			}
			if (previousOttoHome === undefined) {
				delete process.env.OTTO_HOME;
			} else {
				process.env.OTTO_HOME = previousOttoHome;
			}
			await rm(projectRoot, { recursive: true, force: true });
		}
	});

	it('persists skill settings outside the main config file', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-config-skills-'));
		const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
		const previousOttoHome = process.env.OTTO_HOME;
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
		process.env.OTTO_HOME = join(projectRoot, 'otto-home');

		try {
			await writeSkillSettings('global', {
				items: { 'disabled-skill': { enabled: false } },
			});

			const cfg = await loadConfig(projectRoot);
			expect(cfg.skills?.items?.['disabled-skill']?.enabled).toBe(false);

			const skillsFile = await readFile(getGlobalSkillsConfigPath(), 'utf8');
			expect(JSON.parse(skillsFile).items['disabled-skill'].enabled).toBe(
				false,
			);

			const mainConfig = Bun.file(getGlobalConfigPath());
			if (await mainConfig.exists()) {
				const mainConfigText = await mainConfig.text();
				expect(mainConfigText).not.toContain('disabled-skill');
			}
		} finally {
			if (previousXdgConfigHome === undefined) {
				delete process.env.XDG_CONFIG_HOME;
			} else {
				process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
			}
			if (previousOttoHome === undefined) {
				delete process.env.OTTO_HOME;
			} else {
				process.env.OTTO_HOME = previousOttoHome;
			}
			await rm(projectRoot, { recursive: true, force: true });
		}
	});

	it('exposes project defaults but ignores local UI preference overrides', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-config-route-'));
		const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
		const previousOttoHome = process.env.OTTO_HOME;
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
		process.env.OTTO_HOME = join(projectRoot, 'otto-home');
		const app = createEmbeddedApp();

		try {
			const updateResponse = await app.request(
				`http://localhost/v1/config/defaults?project=${encodeURIComponent(projectRoot)}`,
				{
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						model: 'route-project-model',
						compactThread: false,
						scope: 'local',
					}),
				},
			);

			expect(updateResponse.status).toBe(200);
			const updatePayload = await updateResponse.json();
			expect(updatePayload.defaults.model).toBe('route-project-model');
			expect(updatePayload.defaults.compactThread).toBe(true);

			const getResponse = await app.request(
				`http://localhost/v1/config?project=${encodeURIComponent(projectRoot)}`,
			);
			expect(getResponse.status).toBe(200);

			const getPayload = await getResponse.json();
			expect(getPayload.defaults.model).toBe('route-project-model');
			expect(getPayload.defaults.compactThread).toBe(true);
		} finally {
			if (previousXdgConfigHome === undefined) {
				delete process.env.XDG_CONFIG_HOME;
			} else {
				process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
			}
			if (previousOttoHome === undefined) {
				delete process.env.OTTO_HOME;
			} else {
				process.env.OTTO_HOME = previousOttoHome;
			}
			await rm(projectRoot, { recursive: true, force: true });
		}
	});
});

describe('project storage path helpers', () => {
	it('uses the platform default state directory when OTTO_HOME is unset', async () => {
		const homeDir = await mkdtemp(join(tmpdir(), 'otto-default-home-'));
		const appDataDir = join(homeDir, 'AppData', 'Roaming');
		const previousHome = process.env.HOME;
		const previousUserProfile = process.env.USERPROFILE;
		const previousAppData = process.env.APPDATA;
		const previousOttoHome = process.env.OTTO_HOME;
		process.env.HOME = homeDir;
		process.env.USERPROFILE = homeDir;
		process.env.APPDATA = appDataDir;
		delete process.env.OTTO_HOME;

		try {
			const expectedHome =
				process.platform === 'win32'
					? join(appDataDir, 'otto')
					: join(homeDir, '.local', 'state', 'otto');

			expect(getOttoHomeDir()).toBe(expectedHome);
			expect(getProjectsStateRoot()).toBe(join(expectedHome, 'projects'));
		} finally {
			if (previousHome === undefined) delete process.env.HOME;
			else process.env.HOME = previousHome;
			if (previousUserProfile === undefined) delete process.env.USERPROFILE;
			else process.env.USERPROFILE = previousUserProfile;
			if (previousAppData === undefined) delete process.env.APPDATA;
			else process.env.APPDATA = previousAppData;
			if (previousOttoHome === undefined) delete process.env.OTTO_HOME;
			else process.env.OTTO_HOME = previousOttoHome;
			await rm(homeDir, { recursive: true, force: true });
		}
	});

	it('resolves project config and state paths without changing legacy data alias', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-paths-'));
		const previousOttoHome = process.env.OTTO_HOME;
		const ottoHome = join(projectRoot, 'otto-home');
		process.env.OTTO_HOME = ottoHome;

		try {
			const projectId = await getProjectId(projectRoot);
			const stateDir = join(ottoHome, 'projects', projectId);

			expect(getOttoHomeDir()).toBe(ottoHome);
			expect(getProjectsStateRoot()).toBe(join(ottoHome, 'projects'));
			expect(getProjectConfigDir(projectRoot)).toBe(join(projectRoot, '.otto'));
			expect(getProjectConfigPath(projectRoot)).toBe(
				join(projectRoot, '.otto', 'config.json'),
			);
			expect(await getProjectStateDir(projectRoot)).toBe(stateDir);
			expect(await getProjectDbPath(projectRoot)).toBe(
				join(stateDir, 'otto.sqlite'),
			);
			expect(await getProjectAttachmentsDir(projectRoot)).toBe(
				join(stateDir, 'attachments'),
			);
			expect(await getProjectDebugDir(projectRoot)).toBe(
				join(stateDir, 'debug'),
			);
			expect(await getProjectDebugDumpsDir(projectRoot)).toBe(
				join(stateDir, 'debug-dumps'),
			);
			expect(await getProjectLogsDir(projectRoot)).toBe(join(stateDir, 'logs'));
			expect(await getProjectTmpDir(projectRoot)).toBe(join(stateDir, 'tmp'));
			expect(await getProjectCacheDir(projectRoot)).toBe(
				join(stateDir, 'cache'),
			);
			expect(getLegacyProjectDataDir(projectRoot)).toBe(
				join(projectRoot, '.otto'),
			);
			expect(getLocalDataDir(projectRoot)).toBe(
				getLegacyProjectDataDir(projectRoot),
			);
		} finally {
			if (previousOttoHome === undefined) {
				delete process.env.OTTO_HOME;
			} else {
				process.env.OTTO_HOME = previousOttoHome;
			}
			await rm(projectRoot, { recursive: true, force: true });
		}
	});

	it('uses git remote URL for stable readable project IDs', async () => {
		const tmpRoot = await mkdtemp(join(tmpdir(), 'otto-path-id-'));
		const projectRoot = join(tmpRoot, 'my project!');
		const remoteUrl = 'git@example.com:otto/my-project.git';

		try {
			await mkdir(projectRoot, { recursive: true });
			await execFileAsync('git', ['init'], { cwd: projectRoot });
			await execFileAsync('git', ['remote', 'add', 'origin', remoteUrl], {
				cwd: projectRoot,
			});

			const expectedHash = createHash('sha256')
				.update(remoteUrl)
				.digest('hex')
				.slice(0, 8);

			expect(await getProjectId(projectRoot)).toBe(
				`my-project--${expectedHash}`,
			);
			expect(await getProjectId(projectRoot)).toBe(
				await getProjectId(projectRoot),
			);
		} finally {
			await rm(tmpRoot, { recursive: true, force: true });
		}
	});
});
