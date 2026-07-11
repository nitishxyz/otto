import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { planOttoRouterActions } from '../src/lib/ottorouter-actions';

function countOccurrences(source: string, needle: string): number {
	return source.split(needle).length - 1;
}

describe('OttoRouter action plan', () => {
	test('signed out: header renders nothing, exactly one Connect in Machines', () => {
		const plan = planOttoRouterActions({
			configured: false,
			initializing: false,
		});
		expect(plan.headerControl).toBe('none');
		expect(plan.machinesConnectButtons).toBe(1);
		expect(plan.localTunnelAction).toBe('notice');
		expect(plan.totalConnectButtons).toBe(1);
	});

	test('connected: one header status/disconnect pill, one tunnel toggle, zero Connect', () => {
		const plan = planOttoRouterActions({
			configured: true,
			initializing: false,
		});
		expect(plan.headerControl).toBe('account');
		expect(plan.machinesConnectButtons).toBe(0);
		expect(plan.localTunnelAction).toBe('toggle');
		expect(plan.totalConnectButtons).toBe(0);
	});

	test('checking: no Connect flash anywhere, unobtrusive header placeholder', () => {
		const plan = planOttoRouterActions({
			configured: false,
			initializing: true,
		});
		expect(plan.headerControl).toBe('checking');
		expect(plan.totalConnectButtons).toBe(0);
		expect(plan.machinesConnectButtons).toBe(0);
	});
});

describe('landing Connect button de-duplication (static)', () => {
	test('header control has no Connect button and returns null signed out', async () => {
		const control = await readFile(
			'src/components/OttoRouterAccountControl.tsx',
			'utf8',
		);
		expect(control).not.toContain('Connect OttoRouter');
		expect(control).toContain('planOttoRouterActions');
		expect(control).toContain(
			"if (plan.headerControl === 'none') return null;",
		);
		// Drag guards and disconnect affordance stay intact.
		expect(control).toContain('data-no-drag');
		expect(control).toContain('Disconnect OttoRouter');
	});

	test('local tunnel card carries no auth button, only the requirement notice', async () => {
		const panel = await readFile('src/components/LocalTunnelPanel.tsx', 'utf8');
		const picker = await readFile('src/components/ProjectPicker.tsx', 'utf8');
		// No Connect button label (the notice text may reference it in prose).
		expect(panel).not.toContain("'Connect OttoRouter'");
		expect(panel).not.toContain('onConnect');
		expect(panel).toContain('Requires an OttoRouter connection');
		expect(panel).toContain("'Disable'");
		expect(panel).toContain("'Enable'");
		expect(picker).toContain('{machineState?.configured && (');
		expect(picker).toContain('<LocalTunnelPanel ottorouterConfigured />');
	});

	test('exactly one Connect OttoRouter button exists across landing components', async () => {
		const files = [
			'src/components/ProjectPicker.tsx',
			'src/components/OttoRouterAccountControl.tsx',
			'src/components/LocalTunnelPanel.tsx',
			'src/components/MachineLauncher.tsx',
		];
		let total = 0;
		for (const path of files) {
			total += countOccurrences(
				await readFile(path, 'utf8'),
				"'Connect OttoRouter'",
			);
		}
		expect(total).toBe(1);

		const launcher = await readFile(
			'src/components/MachineLauncher.tsx',
			'utf8',
		);
		expect(launcher).toContain('onConnect');
		expect(launcher).toContain('Sign in to view your machines');
		expect(launcher).not.toContain(
			"state?.error ? state.error : 'Sign in to view your machines'",
		);
		// Connect failures surface next to the single Connect button (no dead-end).
		expect(launcher).toContain('connectError');
	});
});
