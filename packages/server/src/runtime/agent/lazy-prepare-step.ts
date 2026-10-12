import type { Tool } from 'ai';
import { logger } from '@ottocode/sdk';
import type { getDb } from '@ottocode/database';
import { messageParts, messages } from '@ottocode/database/schema';
import { and, eq } from 'drizzle-orm';

export interface LazyToolLoaderState {
	toolRecord: Record<string, Tool>;
	loadedTools: Set<string>;
	canonicalToRegistration: Record<string, string>;
	loadToolRegistrationName: string;
}

export interface LazyPrepareStepState {
	baseToolNames: string[];
	loaders: LazyToolLoaderState[];
	/** Receives only steps not yet seen by previous prepareStep calls. */
	refresh?: (args: { steps: unknown[] }) => void | Promise<void>;
	consumedSteps: number;
}

type StepToolCall = { toolCallId?: string; toolName: string; input?: unknown };
type StepToolResult = {
	toolCallId?: string;
	toolName: string;
	output: unknown;
};
type PreparedStep = {
	toolCalls?: StepToolCall[];
	toolResults?: StepToolResult[];
};

/**
 * Finds the result for a specific call. Results are matched by `toolCallId`;
 * name matching is only used when the provider omitted call ids entirely.
 */
export function findToolResultForCall(
	call: StepToolCall,
	results: StepToolResult[],
): StepToolResult | undefined {
	if (call.toolCallId) {
		return results.find((result) => result.toolCallId === call.toolCallId);
	}
	return results.find(
		(result) => !result.toolCallId && result.toolName === call.toolName,
	);
}

function applyLoadedTools(state: LazyPrepareStepState, steps: unknown[]): void {
	for (const step of steps as PreparedStep[]) {
		if (!step?.toolCalls) continue;
		for (const call of step.toolCalls) {
			for (const loader of state.loaders) {
				if (call.toolName !== loader.loadToolRegistrationName) continue;
				const result = findToolResultForCall(call, step.toolResults ?? []);
				const loaded = parseLoadedToolsOutput(result?.output);
				for (const canonicalName of loaded) {
					const registered = loader.canonicalToRegistration[canonicalName];
					if (registered !== undefined) loader.loadedTools.add(registered);
				}
			}
		}
	}
}

export function createLazyToolLoaderState(
	toolRecord: Record<string, Tool>,
	canonicalToRegistration: Record<string, string>,
	loadToolRegistrationName: string,
	initialLoadedTools: string[] = [],
): LazyToolLoaderState {
	const loadedTools = new Set<string>();
	for (const canonicalName of initialLoadedTools) {
		const registered = canonicalToRegistration[canonicalName];
		if (registered !== undefined) loadedTools.add(registered);
	}

	return {
		toolRecord,
		loadedTools,
		canonicalToRegistration,
		loadToolRegistrationName,
	};
}

function parseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

function isLoadToolName(candidate: unknown, loadToolName: string): boolean {
	if (typeof candidate !== 'string') return false;
	const normalize = (value: string) => value.toLowerCase().replace(/[_-]/g, '');
	return normalize(candidate) === normalize(loadToolName);
}

function parseLoadedToolsOutput(output: unknown): string[] {
	let value = output;
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			return [];
		}
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
	const loaded = (value as Record<string, unknown>).loaded;
	return Array.isArray(loaded)
		? loaded.filter((item): item is string => typeof item === 'string')
		: [];
}

function collectLoadedToolsFromValue(
	value: unknown,
	loadToolName: string,
): string[] {
	if (!value || typeof value !== 'object') return [];
	if (Array.isArray(value)) {
		return value.flatMap((item) =>
			collectLoadedToolsFromValue(item, loadToolName),
		);
	}

	const record = value as Record<string, unknown>;
	const loaded: string[] = [];
	const type = typeof record.type === 'string' ? record.type : '';
	if (
		type === `tool-${loadToolName}` ||
		type.toLowerCase().replace(/[_-]/g, '') ===
			`tool${loadToolName}`.toLowerCase().replace(/[_-]/g, '')
	) {
		loaded.push(...parseLoadedToolsOutput(record.output));
	}

	for (const nested of Object.values(record)) {
		loaded.push(...collectLoadedToolsFromValue(nested, loadToolName));
	}
	return loaded;
}

export async function collectLoadedToolsFromSession(
	db: Awaited<ReturnType<typeof getDb>>,
	sessionId: string,
	loadToolName: string,
): Promise<string[]> {
	const rows = await db
		.select({ content: messageParts.content, toolName: messageParts.toolName })
		.from(messageParts)
		.innerJoin(messages, eq(messageParts.messageId, messages.id))
		.where(
			and(
				eq(messages.sessionId, sessionId),
				eq(messageParts.type, 'tool_result'),
			),
		);

	const loaded = rows.flatMap((row) => {
		const content = parseJson(row.content) as
			| Record<string, unknown>
			| undefined;
		const toolName = row.toolName ?? content?.name;
		if (!isLoadToolName(toolName, loadToolName)) return [];
		const result = content?.result;
		return parseLoadedToolsOutput(result);
	});

	return Array.from(new Set(loaded));
}

export function collectLoadedToolsFromHistory(
	history: unknown[],
	loadToolName: string,
): string[] {
	return Array.from(
		new Set(
			history.flatMap((message) =>
				collectLoadedToolsFromValue(message, loadToolName),
			),
		),
	);
}

export function createLazyPrepareStepState(
	baseToolNames: string[],
	loaders: LazyToolLoaderState[],
	refresh?: (args: { steps: unknown[] }) => void | Promise<void>,
): LazyPrepareStepState {
	return {
		baseToolNames,
		loaders,
		consumedSteps: 0,
		...(refresh ? { refresh } : {}),
	};
}

export function buildLazyPrepareStep(state: LazyPrepareStepState) {
	return async ({ steps }: { stepNumber: number; steps: unknown[] }) => {
		const start = Math.min(state.consumedSteps, steps.length);
		const newSteps = steps.slice(start);
		state.consumedSteps = steps.length;

		if (state.refresh) {
			try {
				await state.refresh({ steps: newSteps });
			} catch (error) {
				logger.warn('[tools] lazy tool refresh failed', {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		applyLoadedTools(state, newSteps);

		const loadedTools = state.loaders.flatMap((loader) => [
			...loader.loadedTools,
		]);
		return {
			activeTools: Array.from(
				new Set([...state.baseToolNames, ...loadedTools]),
			),
		};
	};
}
