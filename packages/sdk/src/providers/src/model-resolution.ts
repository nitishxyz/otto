import type { createOpenAI } from '@ai-sdk/openai';

export function shouldUseOpenAIResponsesApi(model: string): boolean {
	const lower = model.toLowerCase();
	return (
		lower.includes('gpt-5') ||
		lower.startsWith('o1') ||
		lower.startsWith('o3') ||
		lower.startsWith('o4') ||
		lower.includes('codex-mini')
	);
}

export function resolveOpenAIResponsesModel(
	instance: ReturnType<typeof createOpenAI>,
	model: string,
) {
	return shouldUseOpenAIResponsesApi(model)
		? instance.responses(model)
		: instance(model);
}
