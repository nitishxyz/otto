import type { ToolResultContent } from './events.ts';

export function buildToolResultContent(args: {
	name: string;
	result: unknown;
	callId?: string;
	input?: unknown;
}): ToolResultContent {
	const content: ToolResultContent = {
		name: args.name,
		result: args.result,
		callId: args.callId,
	};

	if (args.input !== undefined) {
		content.args = args.input;
	}

	if (
		args.result &&
		typeof args.result === 'object' &&
		'artifact' in args.result
	) {
		try {
			const maybeArtifact = (args.result as { artifact?: unknown }).artifact;
			if (maybeArtifact !== undefined) {
				content.artifact = maybeArtifact;
			}
		} catch {}
	}

	return content;
}
