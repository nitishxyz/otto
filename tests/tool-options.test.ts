import { describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listAvailableTools } from '@ottocode/cli/src/scaffold.ts';

const pluginSource = `export default async () => ({
  name: 'custom_thing',
  description: 'custom tool',
  parameters: {
    flag: { type: 'boolean', default: false }
  },
  async execute({ input }) {
    return { flag: !!input.flag };
  }
});\n`;

describe('listAvailableTools', () => {
	it('includes custom tools and curated built-ins only', async () => {
		const root = await mkdtemp(join(tmpdir(), 'otto-tools-list-'));
		const projectRoot = join(root, 'project');
		const home = join(root, 'home');
		await mkdir(projectRoot, { recursive: true });
		await mkdir(home, { recursive: true });
		const prevHome = process.env.HOME;
		const prevProfile = process.env.USERPROFILE;
		process.env.HOME = home;
		process.env.USERPROFILE = home;
		process.env.XDG_CONFIG_HOME = join(home, '.config');

		try {
			const toolDir = join(home, '.config', 'otto', 'tools', 'custom_thing');
			await mkdir(toolDir, { recursive: true });
			await writeFile(join(toolDir, 'tool.js'), pluginSource);

			const tools = await listAvailableTools(projectRoot, 'local');
			expect(tools).toContain('custom_thing');
			expect(tools).toContain('read');
			expect(tools).not.toContain('cd');
			expect(tools).not.toContain('pwd');
			expect(tools).not.toContain('finish');
			const noDupes = new Set(tools);
			expect(noDupes.size).toBe(tools.length);
		} finally {
			if (prevHome === undefined) delete process.env.HOME;
			else process.env.HOME = prevHome;
			if (prevProfile === undefined) delete process.env.USERPROFILE;
			else process.env.USERPROFILE = prevProfile;
			await rm(root, { recursive: true, force: true });
		}
	});
});
