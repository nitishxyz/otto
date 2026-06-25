import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createApp } from '@ottocode/server';

const app = createApp();

describe('plugin routes', () => {
	let projectRoot: string;
	let previousXdgConfigHome: string | undefined;

	beforeEach(async () => {
		projectRoot = await mkdtemp(join(tmpdir(), 'otto-plugin-routes-'));
		previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
	});

	afterEach(async () => {
		if (previousXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME;
		} else {
			process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
		}
		await rm(projectRoot, { recursive: true, force: true });
	});

	test('lists effective plugin state', async () => {
		const response = await app.request(
			`/v1/plugins?project=${encodeURIComponent(projectRoot)}`,
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.global.scope).toBe('global');
		expect(body.project.scope).toBe('project');
		expect(body.plugins).toEqual([]);
	});

	test('lists plugins from a registry URL', async () => {
		const { registryPath } = await writeRegistryFixture(
			projectRoot,
			'registry-plugin',
			'1.0.0',
		);

		const response = await app.request(
			`/v1/plugins/registry?project=${encodeURIComponent(projectRoot)}&url=${encodeURIComponent(registryPath)}`,
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.registries).toEqual([registryPath]);
		expect(body.plugins).toHaveLength(1);
		expect(body.plugins[0].name).toBe('registry-plugin');
		expect(body.plugins[0].registryUrl).toBe(registryPath);
	});

	test('installs, disables, enables, and removes a project plugin', async () => {
		const { registryPath } = await writeRegistryFixture(
			projectRoot,
			'route-plugin',
			'1.0.0',
		);

		const installResponse = await app.request('/v1/plugins/install', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				source: 'route-plugin',
				scope: 'project',
				project: projectRoot,
				registries: [registryPath],
			}),
		});
		const installBody = await installResponse.json();

		expect(installResponse.status).toBe(200);
		expect(installBody.success).toBe(true);
		expect(installBody.plugin.name).toBe('route-plugin');
		expect(installBody.plugin.scope).toBe('project');

		const disableResponse = await app.request('/v1/plugins/disable', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				name: 'route-plugin',
				scope: 'project',
				project: projectRoot,
			}),
		});
		const disableBody = await disableResponse.json();
		expect(disableResponse.status).toBe(200);
		expect(disableBody.plugin.enabled).toBe(false);

		const enableResponse = await app.request('/v1/plugins/enable', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				name: 'route-plugin',
				scope: 'project',
				project: projectRoot,
			}),
		});
		const enableBody = await enableResponse.json();
		expect(enableResponse.status).toBe(200);
		expect(enableBody.plugin.enabled).toBe(true);

		const removeResponse = await app.request('/v1/plugins/remove', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				name: 'route-plugin',
				scope: 'project',
				project: projectRoot,
			}),
		});
		const removeBody = await removeResponse.json();
		expect(removeResponse.status).toBe(200);
		expect(removeBody.success).toBe(true);

		const listResponse = await app.request(
			`/v1/plugins?project=${encodeURIComponent(projectRoot)}`,
		);
		const listBody = await listResponse.json();
		expect(
			listBody.plugins.find(
				(plugin: { name: string }) => plugin.name === 'route-plugin',
			),
		).toBeUndefined();
	});
});

async function writeRegistryFixture(
	projectRoot: string,
	name: string,
	version: string,
) {
	const payloadRoot = join(projectRoot, 'registry-payload');
	const pluginDir = join(payloadRoot, name);
	await mkdir(pluginDir, { recursive: true });
	await writeFile(
		join(pluginDir, 'otto.plugin.json'),
		`${JSON.stringify(
			{
				$schema: 'https://ottocode.ai/schemas/plugin.json',
				name,
				version,
				description: `${name} plugin`,
			},
			null,
			2,
		)}\n`,
	);

	const registryPath = join(projectRoot, 'registry.json');
	await writeFile(
		registryPath,
		`${JSON.stringify(
			{
				$schema: 'https://ottocode.ai/schemas/plugin-registry.json',
				version: 1,
				plugins: [
					{
						name,
						version,
						description: `${name} plugin`,
						source: { type: 'local', path: pluginDir },
					},
				],
			},
			null,
			2,
		)}\n`,
	);

	return { registryPath, pluginDir };
}
