import type { Command } from 'commander';

export function registerUpgradeCommand(program: Command, version: string) {
	program
		.command('upgrade')
		.description('Check for updates and upgrade otto')
		.option('-c, --check', 'Only check for updates, do not install')
		.action(async (opts) => {
			const { handleUpgrade } = await import('../upgrade.ts');
			await handleUpgrade(opts, version);
		});
}
