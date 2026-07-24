import { describe, expect, test } from 'bun:test';
import {
	extractJsonStringField,
	getStreamedContent,
	getStreamedTarget,
} from '../apps/tui/src/lib/tool-stream.ts';
import { messageReducer } from '../apps/tui/src/stream/reducer.ts';
import type { Message } from '../apps/tui/src/types.ts';

function makeAssistant(): Message {
	return {
		id: 'a-1',
		sessionId: 's-1',
		role: 'assistant',
		status: 'pending',
		agent: 'build',
		provider: 'anthropic',
		model: 'claude',
		createdAt: Date.now(),
		completedAt: null,
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
		error: null,
		parts: [],
	};
}

/** Splits text into small chunks like the AI SDK inputTextDelta stream. */
function chunk(text: string, size = 7): string[] {
	const out: string[] = [];
	for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
	return out;
}

describe('tool-stream parsing', () => {
	const writeArgs = JSON.stringify({
		path: 'src/components/Button.tsx',
		content:
			'import React from "react";\n\nexport function Button() {\n\treturn <button>Click</button>;\n}\n',
	});

	test('extractJsonStringField decodes escapes from partial JSON', () => {
		const partial = writeArgs.slice(0, writeArgs.length - 10);
		const content = extractJsonStringField(partial, 'content');
		expect(content).toContain('import React from "react";');
		expect(content.split('\n').length).toBeGreaterThan(3);
	});

	test('getStreamedContent returns multi-line write content mid-stream', () => {
		const partial = writeArgs.slice(0, Math.floor(writeArgs.length * 0.8));
		const content = getStreamedContent('write', partial);
		expect(content.split('\n').length).toBeGreaterThanOrEqual(3);
	});

	test('getStreamedTarget finds path early in the stream', () => {
		const partial = writeArgs.slice(0, 40);
		expect(getStreamedTarget('write', partial)).toBe(
			'src/components/Button.tsx',
		);
	});

	test('getStreamedTarget extracts shell cmd and patch target', () => {
		expect(getStreamedTarget('shell', '{"cmd":"bun test tests/foo')).toBe(
			'bun test tests/foo',
		);
		const patchRaw =
			'{"patch":"*** Begin Patch\\n*** Update File: src/app.ts\\n';
		expect(getStreamedTarget('apply_patch', patchRaw)).toBe('src/app.ts');
	});

	test('full pipeline: chunked write stream accumulates to multi-line preview', () => {
		let state: Message[] = [makeAssistant()];
		for (const delta of chunk(writeArgs)) {
			state = messageReducer(state, {
				type: 'TOOL_DELTA',
				payload: {
					channel: 'input',
					callId: 'c-1',
					name: 'write',
					messageId: 'a-1',
					delta,
				},
			});
		}
		const part = state[0].parts?.[0];
		expect(part?.toolName).toBe('write');
		const raw = (part?.contentJson as Record<string, unknown>)
			?._streamedInput as string;
		expect(raw).toBe(writeArgs);
		const content = getStreamedContent('write', raw);
		expect(content).toBe(
			'import React from "react";\n\nexport function Button() {\n\treturn <button>Click</button>;\n}\n',
		);
		expect(content.split('\n').length).toBe(6);
	});

	test('edit stream prefers newString and falls back to oldString', () => {
		const editRaw = '{"path":"a.ts","oldString":"const a = 1;\\nconst b';
		expect(getStreamedContent('edit', editRaw)).toBe('const a = 1;\nconst b');
		const withNew = `${editRaw} = 2;","newString":"const a = 10;\\nconst`;
		expect(getStreamedContent('edit', withNew)).toBe('const a = 10;\nconst');
	});
});
