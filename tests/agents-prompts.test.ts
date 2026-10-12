import { describe, it, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAgentConfig } from '@ottocode/server';

async function read(path: string) {
	const f = Bun.file(path);
	return (await f.text()).trim();
}

describe('agent prompt resolution', () => {
	it('uses code default for known agent (plan)', async () => {
		const cfg = await resolveAgentConfig(process.cwd(), 'plan');
		const file = await read('packages/sdk/src/prompts/src/agents/plan.txt');
		expect(cfg.prompt.trim()).toBe(file);
	});

	it('falls back to build prompt when agent missing', async () => {
		const cfg = await resolveAgentConfig(process.cwd(), 'nonexistent-agent');
		const file = await read('packages/sdk/src/prompts/src/agents/build.txt');
		expect(cfg.prompt.trim()).toBe(file);
	});

	it('prefers local project override if present', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-agent-prompts-'));
		try {
			await Bun.write(
				join(projectRoot, '.otto', 'agents', 'testagent', 'agent.md'),
				'PROJECT OVERRIDE TEST',
			);
			const cfg = await resolveAgentConfig(projectRoot, 'testagent');
			expect(cfg.prompt.trim()).toBe('PROJECT OVERRIDE TEST');
		} finally {
			await rm(projectRoot, { recursive: true, force: true });
		}
	});
});
