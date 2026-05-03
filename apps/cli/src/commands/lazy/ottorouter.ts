import type { Command } from 'commander';
import { dispatchRegisteredCommand, pushFlag } from './helpers.ts';

export function registerOttoRouterCommand(program: Command) {
	program
		.command('ottorouter')
		.description('Manage OttoRouter wallet and view balance')
		.option('--login', 'Login/setup OttoRouter wallet')
		.action(async (options) => {
			const argv = ['ottorouter'];
			pushFlag(argv, '--login', options.login);
			const { registerOttoRouterCommand: register } = await import(
				'../ottorouter.ts'
			);
			await dispatchRegisteredCommand(register, argv);
		});
}
