import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	compareAudits,
	createPromptAudit,
} from '../scripts/lib/prompt-audit.ts';

const options = {
	agent: 'build',
	provider: 'openrouter',
	model: 'anthropic/claude-sonnet-4',
	mode: 'default' as const,
	userText: 'Deterministic cache audit.',
	freezeTime: '2026-01-01T00:00:00.000Z',
};

describe('prompt audit', () => {
	test('repeated same-project snapshots are deterministic', async () => {
		const first = await createPromptAudit({
			...options,
			projectRoot: process.cwd(),
		});
		const second = await createPromptAudit({
			...options,
			projectRoot: process.cwd(),
		});
		const [comparison] = compareAudits([
			{ label: 'first', value: first },
			{ label: 'second', value: second },
		]);
		expect(comparison.firstDifferingPath).toBeNull();
		expect(comparison.layers.finalRequestCanonical.exactBytePrefix).toBe(
			comparison.layers.finalRequestCanonical.leftBytes,
		);
		expect(first.tools.map((tool) => tool.name)).toEqual(
			second.tools.map((tool) => tool.name),
		);
	});

	test('project-specific data follows a stable prefix without changing tool order', async () => {
		const parent = await mkdtemp(join(tmpdir(), 'agi-prompt-audit-'));
		const leftRoot = join(parent, 'left-project');
		const rightRoot = join(parent, 'right-project');
		await Bun.write(join(leftRoot, 'AGENTS.md'), 'Left project instructions.');
		await Bun.write(
			join(rightRoot, 'AGENTS.md'),
			'Right project instructions.',
		);
		try {
			const left = await createPromptAudit({
				...options,
				projectRoot: leftRoot,
			});
			const right = await createPromptAudit({
				...options,
				projectRoot: rightRoot,
			});
			const [comparison] = compareAudits([
				{ label: 'left', value: left },
				{ label: 'right', value: right },
			]);
			const prefix = comparison.layers.systemString.exactBytePrefix ?? 0;
			expect(prefix).toBeGreaterThan(1_000);
			const leftProjectStart = left.system.indexOf(leftRoot);
			const rightProjectStart = right.system.indexOf(rightRoot);
			expect(leftProjectStart).toBeGreaterThan(1_000);
			expect(rightProjectStart).toBeGreaterThan(1_000);
			expect(left.system.slice(0, leftProjectStart)).not.toContain(leftRoot);
			expect(right.system.slice(0, rightProjectStart)).not.toContain(rightRoot);
			expect(left.tools.map((tool) => tool.name)).toEqual(
				right.tools.map((tool) => tool.name),
			);
			expect(
				left.segments
					.slice(0, 4)
					.every((segment) => segment.class === 'global-stable'),
			).toBe(true);
		} finally {
			await rm(parent, { recursive: true, force: true });
		}
	});
	test('provider adapters preserve stable logical ordering and canonical tools', async () => {
		const parent = await mkdtemp(join(tmpdir(), 'agi-prompt-provider-matrix-'));
		const roots = ['alpha', 'beta', 'gamma'].map((name) => join(parent, name));
		for (const root of roots) {
			await Bun.write(join(root, 'AGENTS.md'), `Instructions for ${root}.`);
		}
		try {
			for (const provider of ['openrouter', 'google']) {
				const snapshots = await Promise.all(
					roots.map((projectRoot) =>
						createPromptAudit({
							...options,
							provider,
							model: 'audit-model',
							projectRoot,
						}),
					),
				);
				const expectedTools = snapshots[0]?.layers.toolSerialization;
				for (const [index, snapshot] of snapshots.entries()) {
					expect(snapshot.layers.toolSerialization).toBe(expectedTools);
					const firstProject = snapshot.segments.findIndex(
						(segment) => segment.class === 'project-specific',
					);
					expect(firstProject).toBeGreaterThan(0);
					expect(
						snapshot.segments
							.slice(0, firstProject)
							.every((segment) => segment.class === 'global-stable'),
					).toBe(true);
					const firstRootByte = Buffer.byteLength(
						snapshot.system.slice(
							0,
							snapshot.system.indexOf(roots[index] ?? ''),
						),
					);
					expect(firstRootByte).toBeGreaterThanOrEqual(
						snapshot.segments[firstProject]?.byteStart ??
							Number.POSITIVE_INFINITY,
					);
				}
			}
		} finally {
			await rm(parent, { recursive: true, force: true });
		}
	});
});
