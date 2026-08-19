import type { Command } from 'commander';

export function registerOttoRouterCommand(program: Command) {
	program
		.command('ottorouter')
		.description('Manage OttoRouter wallet and view balance')
		.option('--login', 'Login/setup OttoRouter wallet')
		.action(async (options) => {
			const { handleOttoRouter } = await import('../ottorouter.ts');
			await handleOttoRouter(options);
		});
}
