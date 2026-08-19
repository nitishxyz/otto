import type { Command } from 'commander';

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
			const { handleShare } = await import('../share.ts');
			await handleShare(sessionId, opts);
		});
}
