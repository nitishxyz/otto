import { createOpenAI } from '@ai-sdk/openai';
import type { OAuth } from '../../types/src/index.ts';

const COPILOT_BASE_URL = 'https://api.githubcopilot.com';

export type CopilotOAuthConfig = {
	oauth: OAuth;
	fetch?: typeof fetch;
};

const COPILOT_REASONING_DROP_TYPES = new Set([
	'response.reasoning.delta',
	'response.reasoning.done',
	'response.reasoning_summary_part.added',
	'response.reasoning_summary_text.delta',
	'response.reasoning_summary_part.done',
]);

function shouldDropCopilotEvent(data: string): boolean {
	try {
		const parsed = JSON.parse(data) as Record<string, unknown>;
		const type = typeof parsed.type === 'string' ? parsed.type : '';
		if (!type) return false;

		if (COPILOT_REASONING_DROP_TYPES.has(type)) return true;

		if (
			(type === 'response.output_item.added' ||
				type === 'response.output_item.done') &&
			parsed.item &&
			typeof parsed.item === 'object'
		) {
			return (parsed.item as Record<string, unknown>).type === 'reasoning';
		}

		return false;
	} catch {
		return false;
	}
}

function filterSseEvent(rawEvent: string): string | null {
	if (!rawEvent.trim()) return rawEvent;

	const dataLines: string[] = [];
	for (const line of rawEvent.split('\n')) {
		if (line.startsWith('data:')) {
			dataLines.push(line.slice('data:'.length).trimStart());
		}
	}

	if (!dataLines.length) return rawEvent;

	const data = dataLines.join('\n');
	if (data === '[DONE]') return rawEvent;

	if (shouldDropCopilotEvent(data)) return null;
	return rawEvent;
}

const SYNTHETIC_COMPLETED =
	'data: {"type":"response.completed","response":{"status":"completed","incomplete_details":null,"usage":{"input_tokens":0,"output_tokens":0}}}';

function sanitizeCopilotResponsesStream(response: Response): Response {
	if (!response.body) return response;

	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let buffer = '';
	let seenCompleted = false;
	let seenDone = false;

	function processBuffer(
		controller: TransformStreamDefaultController<Uint8Array>,
	) {
		let boundary = buffer.indexOf('\n\n');
		while (boundary !== -1) {
			const rawEvent = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary + 2);

			const filtered = filterSseEvent(rawEvent);
			if (filtered !== null) {
				const dataLine = filtered
					.split('\n')
					.find((l) => l.startsWith('data:'));
				const d = dataLine?.slice(5).trim();
				if (d === '[DONE]') {
					seenDone = true;
				} else if (d) {
					try {
						const p = JSON.parse(d) as Record<string, unknown>;
						if (
							p.type === 'response.completed' ||
							p.type === 'response.incomplete'
						) {
							seenCompleted = true;
						}
					} catch {}
				}
				controller.enqueue(encoder.encode(`${filtered}\n\n`));
			}

			boundary = buffer.indexOf('\n\n');
		}
	}

	const transform = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
			processBuffer(controller);
		},
		flush(controller) {
			buffer += decoder.decode().replace(/\r\n/g, '\n');
			if (buffer.trim()) {
				buffer += '\n\n';
				processBuffer(controller);
			}
			if (!seenCompleted) {
				controller.enqueue(encoder.encode(`${SYNTHETIC_COMPLETED}\n\n`));
			}
			if (!seenDone) {
				controller.enqueue(encoder.encode('data: [DONE]\n\n'));
			}
		},
	});

	return new Response(response.body.pipeThrough(transform), {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

function sanitizeCopilotRequestBody(body: string): string {
	try {
		const parsed = JSON.parse(body);
		delete parsed.store;
		delete parsed.previous_response_id;
		if (Array.isArray(parsed.input)) {
			for (const item of parsed.input) {
				if (item && typeof item === 'object') {
					if (item.type === 'function_call' && 'id' in item) {
						delete item.id;
					}
				}
			}
		}
		return JSON.stringify(parsed);
	} catch {
		return body;
	}
}

export function createCopilotFetch(
	config: CopilotOAuthConfig,
): (
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1],
) => Promise<Response> {
	return async (
		input: string | URL | Request,
		init?: RequestInit,
	): Promise<Response> => {
		const headers = new Headers(init?.headers);
		headers.delete('Authorization');
		headers.delete('authorization');
		headers.set('Authorization', `Bearer ${config.oauth.refresh}`);
		headers.set('Openai-Intent', 'conversation-edits');
		headers.set('User-Agent', 'ottocode');

		const requestUrl =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.href
					: input.url;

		if (requestUrl.includes('/responses') && typeof init?.body === 'string') {
			init = { ...init, body: sanitizeCopilotRequestBody(init.body) };
		}

		const response = await (config.fetch ?? fetch)(input, {
			...init,
			headers,
		});

		if (requestUrl.includes('/responses') && response.ok) {
			return sanitizeCopilotResponsesStream(response);
		}

		return response;
	};
}

function isGpt5OrLater(model: string): boolean {
	const match = /^gpt-(\d+)/.exec(model);
	if (!match) return false;
	return Number(match[1]) >= 5;
}

function needsResponsesApi(model: string): boolean {
	return isGpt5OrLater(model) && !model.startsWith('gpt-5-mini');
}

export function createCopilotModel(model: string, config: CopilotOAuthConfig) {
	const customFetch = createCopilotFetch(config);

	const provider = createOpenAI({
		apiKey: 'copilot-oauth',
		baseURL: COPILOT_BASE_URL,
		fetch: customFetch as typeof fetch,
	});

	return needsResponsesApi(model)
		? provider.responses(model)
		: provider.chat(model);
}
