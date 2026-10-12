import type { ModelMessage, Tool } from 'ai';
import { logger, type DiscoveredTool } from '@ottocode/sdk';
import { adaptTools, type ToolAdapterContext } from '../../../tools/adapter.ts';
import {
	buildRegistrationNames,
	requiresClaudeCodeNaming,
} from '../../tools/mapping.ts';

export type ToolRegistrationMap = {
	canonicalToRegistration: Record<string, string>;
	registrationToCanonical: Record<string, string>;
};

export function createToolRegistrationMap(): ToolRegistrationMap {
	return {
		canonicalToRegistration: Object.create(null),
		registrationToCanonical: Object.create(null),
	};
}

/** Adapts one tool batch while retaining the exact accepted registration inverse. */
export function registerRunnerTools(args: {
	tools: DiscoveredTool[];
	ctx: ToolAdapterContext;
	provider: string;
	authType?: string;
	registration: ToolRegistrationMap;
}): Record<string, Tool> {
	const names = buildRegistrationNames(
		args.tools.map(({ name }) => name),
		requiresClaudeCodeNaming(args.provider, args.authType),
	).names;
	const accepted = args.tools.filter(({ name }) => {
		const registered = names.get(name);
		if (!registered) return false;
		const existing = args.registration.registrationToCanonical[registered];
		if (existing !== undefined && existing !== name) {
			logger.warn('[tools] rejected cross-batch registration collision', {
				registration: registered,
				kept: existing,
				rejected: name,
			});
			return false;
		}
		return true;
	});
	const adapted = adaptTools(accepted, args.ctx, args.provider, args.authType);
	for (const { name } of accepted) {
		const registered = names.get(name);
		if (!registered || !Object.hasOwn(adapted, registered)) continue;
		args.registration.canonicalToRegistration[name] = registered;
		args.registration.registrationToCanonical[registered] = name;
	}
	return adapted;
}

/** Maps only tool identities in model history, never user text or tool arguments. */
export function mapModelHistoryToolNames(
	messages: ModelMessage[],
	names: Record<string, string>,
): ModelMessage[] {
	return messages.map((message) => {
		if (
			(message.role !== 'assistant' && message.role !== 'tool') ||
			!Array.isArray(message.content)
		)
			return message;
		return {
			...message,
			content: message.content.map((part) => {
				if (part.type !== 'tool-call' && part.type !== 'tool-result')
					return part;
				const name = names[part.toolName];
				return name === undefined ? part : { ...part, toolName: name };
			}),
		} as ModelMessage;
	});
}
