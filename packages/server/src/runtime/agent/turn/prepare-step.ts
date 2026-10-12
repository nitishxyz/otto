import type { ModelMessage } from 'ai';

export type PrepareStepArgs<M = ModelMessage> = {
	stepNumber: number;
	steps: unknown[];
	messages: M[];
};

export type PrepareStepResult<M = ModelMessage> = Record<string, unknown> & {
	messages?: M[];
};

export type PrepareStepFn<M = ModelMessage> = (
	args: PrepareStepArgs<M>,
) => unknown;

/** Normalizes an inner stage result to an object (or undefined). */
export function asPrepareStepResult<M>(
	value: unknown,
): PrepareStepResult<M> | undefined {
	return value && typeof value === 'object'
		? (value as PrepareStepResult<M>)
		: undefined;
}

/**
 * The message list the next stage must transform: the previous stage's
 * output when it replaced messages, otherwise the SDK-provided list.
 */
export function currentStepMessages<M>(
	args: PrepareStepArgs<M>,
	previous: PrepareStepResult<M> | undefined,
): M[] {
	return previous?.messages ?? args.messages;
}

export type ResultPair = {
	callId: string;
	messages: ModelMessage[];
};

type RetainedResultPair = ResultPair & { insertionIndex: number };

export function hasToolCallId(messages: ModelMessage[], callId: string) {
	return messages.some(
		(message) =>
			Array.isArray(message.content) &&
			message.content.some(
				(part) =>
					typeof part === 'object' &&
					part !== null &&
					'toolCallId' in part &&
					part.toolCallId === callId,
			),
	);
}

/**
 * Keeps synthetic tool call/result pairs injected by prepareStep stages so
 * they stay at their original position in every later step, even though the
 * SDK rebuilds `messages` from its own step history.
 */
export function createRetainedPairBuffer() {
	const pairs: RetainedResultPair[] = [];
	return {
		get size() {
			return pairs.length;
		},
		retain(messages: ModelMessage[], pair: ResultPair): void {
			const retainedInBase = pairs.reduce(
				(count, existing) =>
					count +
					(hasToolCallId(messages, existing.callId)
						? existing.messages.length
						: 0),
				0,
			);
			pairs.push({
				...pair,
				insertionIndex: Math.max(0, messages.length - retainedInBase),
			});
		},
		apply(messages: ModelMessage[]): ModelMessage[] {
			const result = [...messages];
			let offset = 0;
			for (const pair of pairs) {
				const insertionIndex = Math.min(
					pair.insertionIndex + offset,
					result.length,
				);
				if (!hasToolCallId(result, pair.callId)) {
					result.splice(insertionIndex, 0, ...pair.messages);
				}
				offset += pair.messages.length;
			}
			return result;
		},
	};
}

/**
 * Builds a prepareStep stage that persists source-specific results (claim and
 * persist policy stays with the source) and re-injects every retained pair.
 */
export function withRetainedResultPairs(
	inner: PrepareStepFn | undefined,
	persist: (args: PrepareStepArgs) => Promise<ResultPair | undefined>,
	onError: (error: unknown) => void,
): (args: PrepareStepArgs) => Promise<PrepareStepResult | undefined> {
	const buffer = createRetainedPairBuffer();
	return async (args) => {
		const previous = asPrepareStepResult<ModelMessage>(
			inner ? await inner(args) : undefined,
		);
		const messages = currentStepMessages(args, previous);
		try {
			const persisted = await persist(args);
			if (persisted) buffer.retain(messages, persisted);
		} catch (error) {
			onError(error);
		}
		if (buffer.size === 0) return previous;
		return { ...(previous ?? {}), messages: buffer.apply(messages) };
	};
}
