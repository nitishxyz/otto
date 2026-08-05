import { createHash } from 'node:crypto';
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
	loadGlobalConfig,
	removeReferenceSettings,
	setConfig,
	setOnboardingComplete,
	writeReferenceSettings,
	writeSkillSettings,
} from '@ottocode/sdk';
import { createEmbeddedApp } from '../packages/server/src/index.js';

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
			expect(cfg.defaults.dictationExcludedProjectKeywords).toEqual([]);
			expect(cfg.defaults.dictationSmartFormatting).toBe(true);
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
			const globalCfg = await loadGlobalConfig();
			expect(cfg.defaults.model).toBe('project-model');
			expect(globalCfg.defaults.model).not.toBe('project-model');
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

	it('merges global and project references by name', async () => {
		const projectRoot = await mkdtemp(
			join(tmpdir(), 'otto-config-references-'),
		);
		const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
		const previousOttoHome = process.env.OTTO_HOME;
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
		process.env.OTTO_HOME = join(projectRoot, 'otto-home');
		const app = createEmbeddedApp();

		try {
			await writeReferenceSettings(
				'global',
				'hono',
				{
					description: 'Global Hono reference',
					source: { type: 'git', url: 'https://github.com/honojs/hono.git' },
				},
				projectRoot,
			);
			await writeReferenceSettings(
				'local',
				'hono',
				{
					description: 'Project Hono reference',
					source: { type: 'local', path: './vendor/hono' },
				},
				projectRoot,
			);
			await writeReferenceSettings(
				'local',
				'design-system',
				{
					description: 'Project components',
					enabled: false,
					source: { type: 'local', path: '../design-system' },
				},
				projectRoot,
			);

			const cfg = await loadConfig(projectRoot);
			expect(cfg.references?.hono.description).toBe('Project Hono reference');
			expect(cfg.references?.hono.source.type).toBe('local');
			expect(cfg.references?.['design-system'].enabled).toBe(false);

			const globalResponse = await app.request(
				`http://localhost/v1/config/references?project=${encodeURIComponent(projectRoot)}&scope=global`,
			);
			const globalPayload = await globalResponse.json();
			expect(globalPayload.references.hono.description).toBe(
				'Global Hono reference',
			);
			expect(globalPayload.references['design-system']).toBeUndefined();

			const localResponse = await app.request(
				`http://localhost/v1/config/references?project=${encodeURIComponent(projectRoot)}&scope=local`,
			);
			const localPayload = await localResponse.json();
			expect(localPayload.references.hono.description).toBe(
				'Project Hono reference',
			);
			expect(localPayload.references['design-system'].enabled).toBe(false);

			await removeReferenceSettings('local', 'hono', projectRoot);
			const fallbackCfg = await loadConfig(projectRoot);
			expect(fallbackCfg.references?.hono.description).toBe(
				'Global Hono reference',
			);
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

	it('rejects filesystem paths as Git reference URLs', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-reference-url-'));
		const app = createEmbeddedApp();

		try {
			const response = await app.request(
				`http://localhost/v1/config/references/local-repo?project=${encodeURIComponent(projectRoot)}&scope=local`,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						description: 'Local repository entered as Git',
						source: { type: 'git', url: join(projectRoot, 'repo') },
					}),
				},
			);

			expect(response.status).toBe(400);
			const cfg = await loadConfig(projectRoot);
			expect(cfg.references?.['local-repo']).toBeUndefined();
		} finally {
			await rm(projectRoot, { recursive: true, force: true });
		}
	});

	it('browses server directories for local references', async () => {
		const projectRoot = await mkdtemp(
			join(tmpdir(), 'otto-reference-browser-'),
		);
		const childPath = join(projectRoot, 'reference-child');
		const previousOttoHome = process.env.OTTO_HOME;
		process.env.OTTO_HOME = join(projectRoot, 'otto-home');
		const app = createEmbeddedApp();

		try {
			await mkdir(childPath);
			await writeFile(join(projectRoot, 'not-a-directory.txt'), 'ignored');
			const response = await app.request(
				`http://localhost/v1/config/reference-directories?project=${encodeURIComponent(projectRoot)}`,
			);

			expect(response.status).toBe(200);
			const payload = await response.json();
			const canonicalProjectRoot = await realpath(projectRoot);
			expect(payload.path).toBe(canonicalProjectRoot);
			expect(payload.directories).toContainEqual({
				name: 'reference-child',
				path: join(canonicalProjectRoot, 'reference-child'),
			});
			expect(
				payload.directories.some(
					(entry: { name: string }) => entry.name === 'not-a-directory.txt',
				),
			).toBe(false);
		} finally {
			if (previousOttoHome === undefined) {
				delete process.env.OTTO_HOME;
			} else {
				process.env.OTTO_HOME = previousOttoHome;
			}
			await rm(projectRoot, { recursive: true, force: true });
		}
	});

	it('preserves concurrent updates to the same global config file', async () => {
		const projectRoot = await mkdtemp(
			join(tmpdir(), 'otto-config-concurrent-'),
		);
		const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
		const previousOttoHome = process.env.OTTO_HOME;
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
		process.env.OTTO_HOME = join(projectRoot, 'otto-home');

		try {
			await Promise.all([
				setConfig('global', { theme: 'otto-light' }),
				setConfig('global', { compactThread: false }),
				setConfig('global', { fullWidthContent: true }),
				setConfig('global', { vimMode: true }),
				setOnboardingComplete(),
			]);

			const config = JSON.parse(await readFile(getGlobalConfigPath(), 'utf8'));
			expect(config.onboardingComplete).toBe(true);
			expect(config.defaults).toMatchObject({
				theme: 'otto-light',
				compactThread: false,
				fullWidthContent: true,
				vimMode: true,
			});
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

	it('returns a global defaults update on the next project config read', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-config-refresh-'));
		const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
		const previousOttoHome = process.env.OTTO_HOME;
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
		process.env.OTTO_HOME = join(projectRoot, 'otto-home');
		const app = createEmbeddedApp();
		const configUrl = `http://localhost/v1/config?project=${encodeURIComponent(projectRoot)}`;
		const defaultsUrl = `http://localhost/v1/config/defaults?project=${encodeURIComponent(projectRoot)}`;

		try {
			await setConfig('global', { theme: 'otto-dark' });
			const initialResponse = await app.request(configUrl);
			expect(initialResponse.status).toBe(200);
			expect((await initialResponse.json()).defaults.theme).toBe('otto-dark');

			const updateResponse = await app.request(defaultsUrl, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					theme: 'otto-light',
					dictationKeywords: [
						{ keyword: ' AcmeDB ', aliases: [' acme database '] },
					],
					dictationExcludedProjectKeywords: [' Rust ', 'Rust'],
					dictationSmartFormatting: true,
					scope: 'global',
				}),
			});
			expect(updateResponse.status).toBe(200);

			const refreshedResponse = await app.request(configUrl);
			expect(refreshedResponse.status).toBe(200);
			const refreshedDefaults = (await refreshedResponse.json()).defaults;
			expect(refreshedDefaults.theme).toBe('otto-light');
			expect(refreshedDefaults.dictationKeywords).toEqual([
				{ keyword: 'AcmeDB', aliases: ['acme database'] },
			]);
			expect(refreshedDefaults.dictationExcludedProjectKeywords).toEqual([
				'Rust',
			]);
			expect(refreshedDefaults.dictationSmartFormatting).toBe(true);
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

	it('uses canonical path for stable readable project IDs', async () => {
		const tmpRoot = await mkdtemp(join(tmpdir(), 'otto-path-id-'));
		const projectRoot = join(tmpRoot, 'my project!');

		try {
			await mkdir(projectRoot, { recursive: true });
			const canonicalProjectRoot = (await realpath(projectRoot)).replace(
				/\\/g,
				'/',
			);

			const expectedHash = createHash('sha256')
				.update(canonicalProjectRoot)
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
