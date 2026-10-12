import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
	getProjectPluginsDir,
	installPlugin,
	loadPluginsConfig,
	pluginNameSchema,
	removePlugin,
	updatePlugin,
	writePluginsConfig,
} from '@ottocode/sdk';
import {
	assertStrictDescendant,
	removeDescendantPath,
} from '../packages/sdk/src/plugins/fs-safety.ts';
import {
	listSuppressedPluginSkillDirs,
	syncPluginSkillsToAgentsDir,
} from '../packages/sdk/src/plugins/skills.ts';

let root = '';
const previousEnv = {
	XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
	HOME: process.env.HOME,
};

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'otto-harness-orch-plugins-'));
	process.env.XDG_CONFIG_HOME = join(root, 'xdg');
	process.env.HOME = join(root, 'home');
});

afterEach(async () => {
	for (const [key, value] of Object.entries(previousEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	await rm(root, { recursive: true, force: true });
});

async function writePayload(
	dir: string,
	name: string,
	version: string,
	extra: Record<string, unknown> = {},
) {
	await mkdir(join(dir, name), { recursive: true });
	await writeFile(
		join(dir, name, 'otto.plugin.json'),
		`${JSON.stringify({ name, version, ...extra }, null, 2)}\n`,
	);
}

async function writeRegistry(
	path: string,
	payloadDir: string,
	plugins: Array<{ name: string; version: string; dependencies?: string[] }>,
) {
	await writeFile(
		path,
		JSON.stringify({
			version: 1,
			plugins: plugins.map((plugin) => ({
				...plugin,
				source: { type: 'local', path: join(payloadDir, plugin.name) },
			})),
		}),
	);
}

describe('plugin names and destructive paths', () => {
	it('rejects dot-only names and accepts dotted names', () => {
		for (const name of ['.', '..', '...']) {
			expect(pluginNameSchema.safeParse(name).success).toBe(false);
		}
		expect(pluginNameSchema.safeParse('a.b').success).toBe(true);
	});

	it('never removes the plugins root or its parent for dot names', async () => {
		const projectRoot = join(root, 'project');
		const pluginsDir = getProjectPluginsDir(projectRoot);
		await mkdir(pluginsDir, { recursive: true });
		await writeFile(join(projectRoot, '.otto', 'keep.txt'), 'keep');
		await expect(
			removePlugin('..', { scope: 'project', projectRoot }),
		).rejects.toThrow();
		await expect(
			removePlugin('.', { scope: 'project', projectRoot }),
		).rejects.toThrow();
		expect(await readFile(join(projectRoot, '.otto', 'keep.txt'), 'utf8')).toBe(
			'keep',
		);
	});

	it('asserts strict descendants before recursive removal', async () => {
		const base = join(root, 'base');
		await mkdir(join(base, 'child'), { recursive: true });
		expect(() => assertStrictDescendant(base, base)).toThrow();
		expect(() => assertStrictDescendant(base, join(base, '..'))).toThrow();
		expect(() => assertStrictDescendant(base, join(root, 'other'))).toThrow();
		await expect(removeDescendantPath(base, root)).rejects.toThrow();
		await removeDescendantPath(base, join(base, 'child'));
		expect(await Bun.file(join(base, 'child')).exists()).toBe(false);
	});
});

describe('staged plugin installs', () => {
	it('keeps the previous version when the new dependency closure fails', async () => {
		const projectRoot = join(root, 'project');
		const payloads = join(root, 'payloads');
		const registry = join(root, 'registry.json');
		await writePayload(payloads, 'meta', '1.0.0');
		await writeRegistry(registry, payloads, [
			{ name: 'meta', version: '1.0.0' },
		]);
		await installPlugin('meta', {
			scope: 'project',
			projectRoot,
			registries: [registry],
		});

		await writePayload(payloads, 'meta', '2.0.0', { dependencies: ['ghost'] });
		await writeRegistry(registry, payloads, [
			{ name: 'meta', version: '2.0.0', dependencies: ['ghost'] },
		]);
		await expect(
			installPlugin('meta', {
				scope: 'project',
				projectRoot,
				registries: [registry],
			}),
		).rejects.toThrow('Failed to install dependency "ghost"');

		const manifest = JSON.parse(
			await readFile(
				join(getProjectPluginsDir(projectRoot), 'meta', 'otto.plugin.json'),
				'utf8',
			),
		);
		expect(manifest.version).toBe('1.0.0');
		const config = await loadPluginsConfig('project', projectRoot);
		expect(config.plugins.meta?.version).toBe('1.0.0');
	});

	it('does not register a parent or install deps when the closure fails', async () => {
		const projectRoot = join(root, 'project');
		const payloads = join(root, 'payloads');
		const registry = join(root, 'registry.json');
		await writePayload(payloads, 'dep-ok', '1.0.0');
		await writePayload(payloads, 'parent', '1.0.0', {
			dependencies: ['dep-ok', 'ghost'],
		});
		await writeRegistry(registry, payloads, [
			{ name: 'parent', version: '1.0.0', dependencies: ['dep-ok', 'ghost'] },
			{ name: 'dep-ok', version: '1.0.0' },
		]);
		await expect(
			installPlugin('parent', {
				scope: 'project',
				projectRoot,
				registries: [registry],
			}),
		).rejects.toThrow();
		const config = await loadPluginsConfig('project', projectRoot);
		expect(config.plugins.parent).toBeUndefined();
		expect(config.plugins['dep-ok']).toBeUndefined();
		expect(
			await Bun.file(
				join(getProjectPluginsDir(projectRoot), 'parent', 'otto.plugin.json'),
			).exists(),
		).toBe(false);
	});

	it('leaves pinned plugins untouched on update', async () => {
		const projectRoot = join(root, 'project');
		const payloads = join(root, 'payloads');
		const registry = join(root, 'registry.json');
		await writePayload(payloads, 'pinned', '1.0.0');
		await writeRegistry(registry, payloads, [
			{ name: 'pinned', version: '1.0.0' },
		]);
		await installPlugin('pinned', {
			scope: 'project',
			projectRoot,
			registries: [registry],
		});
		const config = await loadPluginsConfig('project', projectRoot);
		config.plugins.pinned = {
			...(config.plugins.pinned ?? { enabled: true }),
			pinned: true,
		};
		await writePluginsConfig('project', config, projectRoot);

		await writePayload(payloads, 'pinned', '2.0.0');
		await writeRegistry(registry, payloads, [
			{ name: 'pinned', version: '2.0.0' },
		]);
		const updated = await updatePlugin('pinned', {
			scope: 'project',
			projectRoot,
			registries: [registry],
		});
		expect(updated.manifest?.version).toBe('1.0.0');
		expect(
			(await loadPluginsConfig('project', projectRoot)).plugins.pinned?.version,
		).toBe('1.0.0');
	});
});

describe('plugin skill sync ownership', () => {
	it('never replaces a user-authored skill directory with the same name', async () => {
		const projectRoot = join(root, 'project');
		const userSkill = join(projectRoot, '.agents', 'skills', 'shared');
		await mkdir(userSkill, { recursive: true });
		await writeFile(join(userSkill, 'SKILL.md'), 'mine');

		const pluginDir = join(root, 'plugin-src');
		await mkdir(join(pluginDir, 'skills', 'shared'), { recursive: true });
		await writeFile(
			join(pluginDir, 'skills', 'shared', 'SKILL.md'),
			'---\nname: shared\ndescription: theirs\n---\n\nTheirs.\n',
		);
		const result = await syncPluginSkillsToAgentsDir(
			pluginDir,
			{
				name: 'owner',
				version: '1.0.0',
				skills: [{ name: 'shared', path: 'skills/shared/SKILL.md' }],
			},
			'project',
			projectRoot,
		);
		expect(result.conflicts).toEqual([{ skill: 'shared', owner: null }]);
		expect(await readFile(join(userSkill, 'SKILL.md'), 'utf8')).toBe('mine');
	});

	it('reports global plugin skills suppressed by a project disable', async () => {
		const projectRoot = join(root, 'project');
		const payload = join(root, 'payloads');
		await writePayload(payload, 'global-skills', '1.0.0', {
			skills: [{ name: 'gskill', path: 'SKILL.md' }],
		});
		await writeFile(
			join(payload, 'global-skills', 'SKILL.md'),
			'---\nname: gskill\ndescription: g\n---\n\nG.\n',
		);
		await installPlugin(join(payload, 'global-skills'), {
			scope: 'global',
			projectRoot,
		});
		expect(await listSuppressedPluginSkillDirs(projectRoot)).toEqual([]);

		await writePluginsConfig(
			'project',
			{
				version: 1,
				registries: [],
				plugins: { 'global-skills': { enabled: false } },
			},
			projectRoot,
		);
		const suppressed = await listSuppressedPluginSkillDirs(projectRoot);
		expect(suppressed).toHaveLength(1);
		expect(suppressed[0]).toEndWith('/.agents/skills/gskill');
	});
});
