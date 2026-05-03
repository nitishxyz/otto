import type { Command } from 'commander';
import { dispatchVersionedCommand, pushFlag } from './helpers.ts';

export function registerUpgradeCommand(program: Command, version: string) {
	program
		.command('upgrade')
		.description('Check for updates and upgrade otto')
		.option('-c, --check', 'Only check for updates, do not install')
		.action(async (opts) => {
			const argv = ['upgrade'];
			pushFlag(argv, '--check', opts.check);
			const { registerUpgradeCommand: register } = await import(
				'../upgrade.ts'
			);
			await dispatchVersionedCommand(register, version, argv);
		});
}
