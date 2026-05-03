import type { Command } from 'commander';
import { dispatchRegisteredCommand, pushFlag, pushOption } from './helpers.ts';

export function registerShareCommand(program: Command) {
	program
		.command('share [sessionId]')
		.description('Share a session publicly')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--title <title>', 'Custom title for the share')
		.option('--description <desc>', 'Description for OG preview')
		.option('--until <messageId>', 'Share only up to this message')
		.option('--update', 'Update an existing share with new messages')
		.option('--delete', 'Delete a shared session')
		.option('--status', 'Show share status for a session')
		.option('--list', 'List all shared sessions')
		.action(async (sessionId, opts) => {
			const argv = ['share'];
			if (sessionId) argv.push(sessionId);
			pushOption(argv, '--project', opts.project);
			pushOption(argv, '--title', opts.title);
			pushOption(argv, '--description', opts.description);
			pushOption(argv, '--until', opts.until);
			pushFlag(argv, '--update', opts.update);
			pushFlag(argv, '--delete', opts.delete);
			pushFlag(argv, '--status', opts.status);
			pushFlag(argv, '--list', opts.list);
			const { registerShareCommand: register } = await import('../share.ts');
			await dispatchRegisteredCommand(register, argv);
		});
}
