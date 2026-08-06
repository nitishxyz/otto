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
			const isInlineBrowserScreenshot =
				args.name === 'browser' &&
				maybeArtifact !== null &&
				typeof maybeArtifact === 'object' &&
				(maybeArtifact as { kind?: unknown }).kind === 'browser_screenshot';
			if (maybeArtifact !== undefined && !isInlineBrowserScreenshot) {
				content.artifact = maybeArtifact;
			}
		} catch {}
	}

	return content;
}
