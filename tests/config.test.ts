import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'bun:test';
import {
	getGlobalConfigPath,
	getGlobalSkillsConfigPath,
	loadConfig,
	setConfig,
	writeSkillSettings,
} from '@ottocode/sdk';
import { createEmbeddedApp } from '../packages/server/src/index.js';

describe('config loader', () => {
	it('loads defaults when no config files present', async () => {
		const tmpProject = process.cwd();
		const cfg = await loadConfig(tmpProject);
		expect(cfg.projectRoot).toBe(tmpProject);
		expect(cfg.defaults.agent).toBeDefined();
		expect(cfg.defaults.provider).toBeDefined();
		expect(cfg.defaults.model).toBeDefined();
		expect(cfg.defaults.fullWidthContent).toBe(false);
		expect(cfg.paths.dbPath.endsWith('.otto/otto.sqlite')).toBe(true);
	});

	it('persists project-scoped model defaults in local config', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-config-'));

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
		} finally {
			await rm(projectRoot, { recursive: true, force: true });
		}
	});

	it('keeps global UI preferences from being shadowed by local config', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-config-local-'));
		const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');

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
			await rm(projectRoot, { recursive: true, force: true });
		}
	});

	it('persists skill settings outside the main config file', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-config-skills-'));
		const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');

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
			await rm(projectRoot, { recursive: true, force: true });
		}
	});

	it('exposes project defaults but ignores local UI preference overrides', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-config-route-'));
		const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
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
			await rm(projectRoot, { recursive: true, force: true });
		}
	});
});
