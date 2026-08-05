import { describe, expect, it } from 'bun:test';
import { DaemonVersionMismatchError } from '../apps/cli/src/daemon.ts';
import { offerDaemonMismatchUpgrade } from '../apps/cli/src/commands/upgrade.ts';

describe('daemon version mismatch upgrade', () => {
	it('offers an interactive upgrade with acceptance as the default path', async () => {
		const messages: string[] = [];
		const upgraded: string[] = [];
		let confirmCalls = 0;
		const result = await offerDaemonMismatchUpgrade(
			new DaemonVersionMismatchError('1.2.3', '1.2.4'),
			{
				interactive: true,
				confirmUpgrade: async () => {
					confirmCalls++;
					return true;
				},
				upgrade: async (version) => {
					upgraded.push(version);
				},
				print: (message) => messages.push(message),
			},
		);

		expect(result).toBe(true);
		expect(confirmCalls).toBe(1);
		expect(upgraded).toEqual(['1.2.4']);
		expect(messages[0]).toContain('daemon v1.2.4, CLI v1.2.3');
	});

	it('prints upgrade instructions without prompting in non-interactive mode', async () => {
		const messages: string[] = [];
		let confirmCalls = 0;
		const result = await offerDaemonMismatchUpgrade(
			new DaemonVersionMismatchError('1.2.3', '1.2.4'),
			{
				interactive: false,
				confirmUpgrade: async () => {
					confirmCalls++;
					return true;
				},
				print: (message) => messages.push(message),
			},
		);

		expect(result).toBe(false);
		expect(confirmCalls).toBe(0);
		expect(messages.at(-1)).toContain('otto upgrade');
	});
});
