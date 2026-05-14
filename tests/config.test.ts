import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
		expect(cfg.defaults.fullWidthContent).toBe(true);
		expect(cfg.paths.dbPath.endsWith('.otto/otto.sqlite')).toBe(true);
	});

	it('persists full width content in config defaults', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-config-'));

		try {
			await setConfig(
				'local',
				{
					fullWidthContent: true,
				},
				projectRoot,
			);

			const cfg = await loadConfig(projectRoot);
			expect(cfg.defaults.fullWidthContent).toBe(true);
		} finally {
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

	it('exposes and updates full width content through config routes', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-config-route-'));
		const app = createEmbeddedApp();

		try {
			const updateResponse = await app.request(
				`http://localhost/v1/config/defaults?project=${encodeURIComponent(projectRoot)}`,
				{
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						fullWidthContent: true,
						scope: 'local',
					}),
				},
			);

			expect(updateResponse.status).toBe(200);
			const updatePayload = await updateResponse.json();
			expect(updatePayload.defaults.fullWidthContent).toBe(true);

			const getResponse = await app.request(
				`http://localhost/v1/config?project=${encodeURIComponent(projectRoot)}`,
			);
			expect(getResponse.status).toBe(200);

			const getPayload = await getResponse.json();
			expect(getPayload.defaults.fullWidthContent).toBe(true);
		} finally {
			await rm(projectRoot, { recursive: true, force: true });
		}
	});
});
