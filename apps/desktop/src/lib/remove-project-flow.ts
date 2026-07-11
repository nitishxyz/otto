export type RemoveProjectFlowResult =
	| { status: 'cancelled' }
	| { status: 'removed' }
	| { status: 'error'; message: string };

/**
 * Confirmation-first removal flow for "Remove from list". The remove
 * mutation is invoked only after the confirmation promise resolves true;
 * Cancel leaves the registry untouched, and a failed removal surfaces an
 * error while the row stays (the cache is only updated after success by
 * the caller's remove function).
 */
export async function runRemoveProjectFlow(
	confirmRemoval: () => Promise<boolean>,
	removeProject: () => Promise<void> | void,
): Promise<RemoveProjectFlowResult> {
	const confirmed = await confirmRemoval();
	if (!confirmed) return { status: 'cancelled' };
	try {
		await removeProject();
		return { status: 'removed' };
	} catch (cause) {
		return {
			status: 'error',
			message:
				cause instanceof Error
					? cause.message
					: 'Could not remove the project from the list.',
		};
	}
}
