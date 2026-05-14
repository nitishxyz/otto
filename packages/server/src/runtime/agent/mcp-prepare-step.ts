export interface LazyToolLoaderState {
	baseToolNames: string[];
	loadedTools: Set<string>;
	loaders: Array<{
		registrationName: string;
		canonicalToRegistration: Record<string, string>;
	}>;
}

export function createLazyToolPrepareStepState(
	baseToolNames: string[],
	loaders: LazyToolLoaderState['loaders'],
	initialLoadedTools: string[] = [],
): LazyToolLoaderState {
	return {
		baseToolNames,
		loadedTools: new Set(initialLoadedTools),
		loaders,
	};
}

function parseToolOutput(output: unknown): { loaded?: string[] } | undefined {
	if (!output) return undefined;
	if (typeof output === 'object') {
		const maybeTextOutput = output as { value?: unknown };
		if (typeof maybeTextOutput.value === 'string') {
			return parseToolOutput(maybeTextOutput.value);
		}

		return output as { loaded?: string[] };
	}
	if (typeof output !== 'string') return undefined;
	try {
		return JSON.parse(output) as { loaded?: string[] };
	} catch {
		return undefined;
	}
}

export function getLoadedLazyToolsFromMessages(
	messages: unknown[],
	loaders: LazyToolLoaderState['loaders'],
): string[] {
	const loadedTools = new Set<string>();
	for (const message of messages) {
		const content = (message as { content?: unknown }).content;
		const parts = Array.isArray(content) ? content : [];
		for (const part of parts) {
			const toolPart = part as {
				type?: unknown;
				toolName?: unknown;
				output?: unknown;
			};
			const partType =
				typeof toolPart.type === 'string' ? toolPart.type : undefined;
			const toolName =
				typeof toolPart.toolName === 'string' ? toolPart.toolName : undefined;
			if (!partType && !toolName) continue;

			const loader = stateLoaderForToolPart({ partType, toolName }, loaders);
			if (!loader) continue;

			const output = parseToolOutput(toolPart.output);
			if (!output?.loaded) continue;
			for (const canonicalName of output.loaded) {
				const regName =
					loader.canonicalToRegistration[canonicalName] ?? canonicalName;
				loadedTools.add(regName);
			}
		}
	}

	return [...loadedTools];
}

function stateLoaderForToolPart(
	part: { partType?: string; toolName?: string },
	loaders: LazyToolLoaderState['loaders'],
) {
	return loaders.find(
		(loader) =>
			part.toolName === loader.registrationName ||
			part.partType === `tool-${loader.registrationName}` ||
			part.partType === loader.registrationName,
	);
}

export function buildPrepareStep(state: LazyToolLoaderState) {
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
				const loader = state.loaders.find(
					(item) => call.toolName === item.registrationName,
				);
				if (!loader) continue;
				const result = (step.toolResults ?? []).find(
					(r) => r.toolName === loader.registrationName,
				);
				const output = parseToolOutput(result?.output);
				if (!output?.loaded) continue;
				for (const canonicalName of output.loaded) {
					const regName =
						loader.canonicalToRegistration[canonicalName] ?? canonicalName;
					if (!state.loadedTools.has(regName)) {
						state.loadedTools.add(regName);
					}
				}
			}
		}

		const activeTools = [...state.baseToolNames, ...state.loadedTools];
		void stepNumber;

		return { activeTools };
	};
}
