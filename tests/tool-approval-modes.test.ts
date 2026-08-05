import { describe, expect, test } from 'bun:test';
import {
	requiresApproval,
	skipsGuardApproval,
} from '../packages/server/src/runtime/tools/approval.ts';

describe('tool approval modes', () => {
	test('yolo does not add baseline tool approvals', () => {
		expect(requiresApproval('shell', 'yolo')).toBe(false);
		expect(requiresApproval('write', 'yolo')).toBe(false);
		expect(requiresApproval('git_push', 'yolo')).toBe(false);
	});

	test('dangerous mode still requires approval for dangerous tools', () => {
		expect(requiresApproval('shell', 'dangerous')).toBe(true);
		expect(requiresApproval('bash', 'dangerous')).toBe(true);
		expect(requiresApproval('write', 'dangerous')).toBe(true);
		expect(requiresApproval('read', 'dangerous')).toBe(false);
	});

	test('dangerous mode uses extension effects instead of tool names', () => {
		expect(
			requiresApproval('plugin__inspect', 'dangerous', {}, ['workspace-read']),
		).toBe(false);
		expect(
			requiresApproval('plugin__deploy', 'dangerous', {}, [
				'workspace-read',
				'external-write',
			]),
		).toBe(true);
		expect(requiresApproval('plugin__run', 'dangerous', {}, ['process'])).toBe(
			true,
		);
	});

	test('dangerous mode only prompts for mutating browser actions', () => {
		for (const action of [
			'open',
			'navigate',
			'back',
			'forward',
			'reload',
			'click',
			'type',
			'press',
			'evaluate',
		]) {
			expect(requiresApproval('browser', 'dangerous', { action })).toBe(true);
		}
		for (const action of [
			'snapshot',
			'screenshot',
			'html',
			'find',
			'console',
			'network',
			'hover',
			'scroll',
			'wait_for',
			'stop',
		]) {
			expect(requiresApproval('browser', 'dangerous', { action })).toBe(false);
		}
		expect(requiresApproval('browser', 'all', { action: 'snapshot' })).toBe(
			true,
		);
		expect(requiresApproval('browser', 'yolo', { action: 'click' })).toBe(
			false,
		);
	});

	test('yolo skips guard-driven approvals only', () => {
		expect(skipsGuardApproval('yolo')).toBe(true);
		expect(skipsGuardApproval('auto')).toBe(false);
		expect(skipsGuardApproval('dangerous')).toBe(false);
		expect(skipsGuardApproval('all')).toBe(false);
		expect(skipsGuardApproval(undefined)).toBe(false);
	});
});
