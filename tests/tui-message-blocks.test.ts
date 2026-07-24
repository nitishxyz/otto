import { describe, expect, test } from 'bun:test';
import {
	buildMessageBlocks,
	extractPartText,
} from '../apps/tui/src/lib/message-blocks.ts';
import type { MessagePart } from '../apps/tui/src/types.ts';

function part(
	id: string,
	type: MessagePart['type'],
	text: string,
	toolName: string | null = null,
): MessagePart {
	return {
		id,
		type,
		toolName,
		toolCallId: toolName ? `${id}-call` : null,
		contentJson: type === 'tool_result' ? { args: { path: text } } : { text },
	} as MessagePart;
}

describe('TUI message blocks', () => {
	test('groups adjacent reasoning parts into one block', () => {
		const blocks = buildMessageBlocks([
			part('reason-1', 'reasoning', 'First thought'),
			part('reason-2', 'reasoning', 'Second thought'),
			part('answer', 'text', 'Answer'),
		]);

		expect(blocks).toHaveLength(2);
		expect(blocks[0]?.kind).toBe('reasoning');
		if (blocks[0]?.kind === 'reasoning') {
			expect(blocks[0].parts.map(extractPartText)).toEqual([
				'First thought',
				'Second thought',
			]);
		}
	});

	test('starts a new reasoning group after another visible block', () => {
		const blocks = buildMessageBlocks([
			part('reason-1', 'reasoning', 'Before tool'),
			part('read', 'tool_result', 'README.md', 'read'),
			part('reason-2', 'reasoning', 'After tool'),
		]);

		expect(blocks.map((block) => block.kind)).toEqual([
			'reasoning',
			'tools',
			'reasoning',
		]);
	});

	test('drops empty reasoning parts without splitting a group', () => {
		const blocks = buildMessageBlocks([
			part('reason-1', 'reasoning', 'First'),
			part('empty', 'reasoning', '   '),
			part('reason-2', 'reasoning', 'Second'),
		]);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.kind).toBe('reasoning');
		if (blocks[0]?.kind === 'reasoning') {
			expect(blocks[0].parts).toHaveLength(2);
		}
	});
});
