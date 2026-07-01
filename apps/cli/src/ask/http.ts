export type SSEEvent = { event: string; data: string };
type RequestHeaders = Record<string, string>;

async function* sseIterator(resp: Response): AsyncGenerator<SSEEvent> {
	if (!resp.body) return;
	const reader = resp.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let idx = buffer.indexOf('\n\n');
		while (idx !== -1) {
			const raw = buffer.slice(0, idx);
			buffer = buffer.slice(idx + 2);
			const lines = raw.split('\n');
			let event = 'message';
			let data = '';
			for (const line of lines) {
				if (line.startsWith('event: ')) event = line.slice(7).trim();
				else if (line.startsWith('data: '))
					data += (data ? '\n' : '') + line.slice(6);
			}
			if (data) yield { event, data };
			idx = buffer.indexOf('\n\n');
		}
	}
}

export async function connectSSE(url: string, headers?: RequestHeaders) {
	const controller = new AbortController();
	const res = await fetch(url, {
		headers: { ...headers, Accept: 'text/event-stream' },
		signal: controller.signal,
	});
	const iterator = sseIterator(res);
	return {
		async *[Symbol.asyncIterator]() {
			for await (const ev of iterator) yield ev;
		},
		async close() {
			try {
				controller.abort();
			} catch {}
		},
	};
}

export function safeJson(input: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(input);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {}
	return undefined;
}
