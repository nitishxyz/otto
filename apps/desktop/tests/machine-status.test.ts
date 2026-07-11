import { describe, expect, test } from 'bun:test';
import { machinePresence } from '../src/lib/machine-status';

describe('machine presence badges', () => {
	test('reports checking while the list is refreshing', () => {
		expect(machinePresence('online', true)).toBe('checking');
	});

	test('normalizes online-like statuses', () => {
		expect(machinePresence('online')).toBe('online');
		expect(machinePresence('Connected')).toBe('online');
		expect(machinePresence(' ACTIVE ')).toBe('online');
	});

	test('normalizes offline-like statuses', () => {
		expect(machinePresence('offline')).toBe('offline');
		expect(machinePresence('Disconnected')).toBe('offline');
		expect(machinePresence('unreachable')).toBe('offline');
	});

	test('keeps unknown statuses in checking instead of guessing', () => {
		expect(machinePresence(null)).toBe('checking');
		expect(machinePresence(undefined)).toBe('checking');
		expect(machinePresence('mystery-state')).toBe('checking');
	});
});
