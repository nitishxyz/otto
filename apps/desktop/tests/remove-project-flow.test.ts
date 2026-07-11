import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { runRemoveProjectFlow } from '../src/lib/remove-project-flow';

describe('remove-from-list confirmation ordering', () => {
	test('cancel resolves before any mutation and leaves the registry untouched', async () => {
		let removeCalls = 0;
		let confirmResolved = false;
		const result = await runRemoveProjectFlow(
			async () => {
				await new Promise((resolve) => setTimeout(resolve, 5));
				confirmResolved = true;
				return false;
			},
			() => {
				expect(confirmResolved).toBe(true);
				removeCalls += 1;
			},
		);
		expect(result).toEqual({ status: 'cancelled' });
		expect(removeCalls).toBe(0);
	});

	test('confirm invokes the mutation exactly once, only after confirmation resolves', async () => {
		let removeCalls = 0;
		let confirmResolved = false;
		const result = await runRemoveProjectFlow(
			async () => {
				await new Promise((resolve) => setTimeout(resolve, 5));
				confirmResolved = true;
				return true;
			},
			() => {
				expect(confirmResolved).toBe(true);
				removeCalls += 1;
			},
		);
		expect(result).toEqual({ status: 'removed' });
		expect(removeCalls).toBe(1);
	});

	test('mutation failure reports an error so the row stays visible', async () => {
		const result = await runRemoveProjectFlow(
			async () => true,
			async () => {
				throw new Error('Could not forget project.');
			},
		);
		expect(result).toEqual({
			status: 'error',
			message: 'Could not forget project.',
		});
	});
});

describe('remove-from-list wiring regressions', () => {
	test('card uses async dialog confirm, stops propagation, and guards double clicks', async () => {
		const card = await readFile('src/components/ProjectCard.tsx', 'utf8');
		// Async Tauri dialog, not the sync-looking window.confirm that resolves
		// non-blocking in WebViews (which allowed removal before confirmation).
		expect(card).toContain("from '@tauri-apps/plugin-dialog'");
		expect(card).not.toContain('window.confirm');
		expect(card).toContain('runRemoveProjectFlow');
		expect(card).toContain('e.stopPropagation()');
		expect(card).toContain('if (removing) return;');
	});

	test('registry cache updates only after the forget call succeeds', async () => {
		const hook = await readFile('src/hooks/useProjects.ts', 'utf8');
		const removeSection = hook.slice(hook.indexOf('const removeProject'));
		const forgetIndex = removeSection.indexOf('forgetProject');
		const throwIndex = removeSection.indexOf('throw new Error');
		const reloadIndex = removeSection.indexOf('await loadProjects()');
		expect(forgetIndex).toBeGreaterThan(-1);
		expect(throwIndex).toBeGreaterThan(forgetIndex);
		expect(reloadIndex).toBeGreaterThan(throwIndex);
	});
});
