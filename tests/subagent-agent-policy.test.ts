import { describe, expect, test } from 'bun:test';
import { isDelegatableAgent } from '@ottocode/sdk';

describe('subagent agent policy', () => {
	test('allows an agent name to delegate to another instance of itself', () => {
		expect(isDelegatableAgent('build')).toBe(true);
		expect(isDelegatableAgent('plan')).toBe(true);
		expect(isDelegatableAgent('research')).toBe(true);
	});

	test('excludes non-worker agents from delegation', () => {
		expect(isDelegatableAgent('general')).toBe(false);
		expect(isDelegatableAgent('looper')).toBe(false);
	});
});
