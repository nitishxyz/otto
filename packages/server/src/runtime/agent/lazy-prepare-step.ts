import type { Tool } from 'ai';
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
}

export function createLazyToolLoaderState(
	toolRecord: Record<string, Tool>,
	canonicalToRegistration: Record<string, string>,
	loadToolRegistrationName: string,
	initialLoadedTools: string[] = [],
): LazyToolLoaderState {
	const loadedTools = new Set<string>();
	for (const canonicalName of initialLoadedTools) {
		loadedTools.add(canonicalToRegistration[canonicalName] ?? canonicalName);
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
): LazyPrepareStepState {
	return {
		baseToolNames,
		loaders,
	};
}

export function buildLazyPrepareStep(state: LazyPrepareStepState) {
	return async ({
		stepNumber,
		steps,
	}: {
		stepNumber: number;
		steps: unknown[];
	}) => {
		const previousSteps = steps as Array<{
			toolCalls?: Array<{ toolName: string; input: unknown }>;
			toolResults?: Array<{ toolName: string; output: unknown }>;
		}>;

		for (const step of previousSteps) {
			if (!step.toolCalls) continue;
			for (const call of step.toolCalls) {
				for (const loader of state.loaders) {
					if (call.toolName !== loader.loadToolRegistrationName) continue;
					const result = (step.toolResults ?? []).find(
						(r) => r.toolName === loader.loadToolRegistrationName,
					);
					const output = result?.output as { loaded?: string[] } | undefined;
					if (!output?.loaded) continue;
					for (const canonicalName of output.loaded) {
						const regName =
							loader.canonicalToRegistration[canonicalName] ?? canonicalName;
						if (!loader.loadedTools.has(regName)) {
							loader.loadedTools.add(regName);
						}
					}
				}
			}
		}

		const loadedTools = state.loaders.flatMap((loader) => [
			...loader.loadedTools,
		]);
		const activeTools = [...state.baseToolNames, ...loadedTools];
		void stepNumber;

		return { activeTools };
	};
}
