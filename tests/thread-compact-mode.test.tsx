import { beforeEach, describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
	buildThreadRows,
	createThreadRowCache,
	resetThreadRowCache,
	type ThreadRow,
	type ThreadRowCache,
} from '../packages/web-sdk/src/components/messages/threadRowModel';
import {
	AssistantCompactGroupRow,
	AssistantItemRow,
} from '../packages/web-sdk/src/components/messages/ThreadRows';
import { resolveThreadCompactMode } from '../packages/web-sdk/src/components/messages/threadCompactMode';
import { AUTO_COMPACT_COMPLETED_PART_THRESHOLD } from '../packages/web-sdk/src/components/messages/assistantTurnModel';
import type { Message, MessagePart } from '../packages/web-sdk/src/types/api';

function part(overrides: Partial<MessagePart> & { id: string }): MessagePart {
	return {
		messageId: 'assistant-1',
		index: 0,
		stepIndex: null,
		type: 'text',
		content: JSON.stringify({ text: 'hello' }),
		agent: 'build',
		provider: 'anthropic',
		model: 'sonnet',
		startedAt: 1,
		completedAt: 2,
		toolName: null,
		toolCallId: null,
		toolDurationMs: null,
		...overrides,
	};
}

function message(overrides: Partial<Message> & { id: string }): Message {
	return {
		sessionId: 'session-1',
		role: 'assistant',
		status: 'complete',
		agent: 'build',
		provider: 'anthropic',
		model: 'sonnet',
		createdAt: 1,
		completedAt: 2,
		latencyMs: null,
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
		error: null,
		parts: [],
		...overrides,
	};
}

const EMPTY = new Set<string>();

function build(messages: Message[], compact: boolean, cache?: ThreadRowCache) {
	return buildThreadRows({
		messages,
		sessionId: 'session-1',
		compact,
		currentMessageId: null,
		queueLength: 0,
		queuedMessageIds: EMPTY,
		cache,
	}).rows;
}

type ItemRow = Extract<ThreadRow, { kind: 'assistant-item' }>;
type GroupRow = Extract<ThreadRow, { kind: 'assistant-compact-group' }>;

function itemRows(rows: readonly ThreadRow[]): ItemRow[] {
	return rows.filter((row): row is ItemRow => row.kind === 'assistant-item');
}

function groupRows(rows: readonly ThreadRow[]): GroupRow[] {
	return rows.filter(
		(row): row is GroupRow => row.kind === 'assistant-compact-group',
	);
}

/** Every persisted part the rows account for, in thread order. */
function coveredPartIds(rows: readonly ThreadRow[]) {
	const ids: string[] = [];
	for (const row of rows) {
		if (row.kind === 'assistant-item') ids.push(row.part.id);
		if (row.kind === 'assistant-compact-group') {
			for (const groupPart of row.parts) ids.push(groupPart.id);
		}
	}
	return ids;
}

function renderItemRow(row: ItemRow, compact: boolean) {
	return renderToStaticMarkup(
		<AssistantItemRow
			messageId={row.messageId}
			part={row.part}
			variant={row.variant}
			showLine={row.showLine}
			isFirstPart={row.isFirstPart}
			isLiveToolCall={row.isLiveToolCall}
			isLastMessage={row.isLastMessage}
			canRetry={row.canRetry}
			sessionId="session-1"
			compact={compact}
		/>,
	);
}

function renderGroupRow(row: GroupRow) {
	return renderToStaticMarkup(
		<AssistantCompactGroupRow
			entries={row.entries}
			titleOverride={row.titleOverride}
			collapsed={row.collapsed}
			showLine={row.showLine}
		/>,
	);
}

function countOccurrences(haystack: string, needle: string) {
	return haystack.split(needle).length - 1;
}

function readPart(id: string, index: number, path: string) {
	return part({
		id,
		index,
		type: 'tool_result',
		toolName: 'read',
		toolCallId: `call-${id}`,
		contentJson: { result: { path } },
	});
}

function reasoningPart(id: string, index: number, text: string) {
	return part({
		id,
		index,
		type: 'reasoning',
		content: JSON.stringify({ text }),
		contentJson: { text },
	});
}

function textPart(id: string, index: number, text: string) {
	return part({
		id,
		index,
		type: 'text',
		content: JSON.stringify({ text }),
		contentJson: { text },
	});
}

/** A turn of exploratory activity: a read, a search and a reasoning step. */
function explorationTurn() {
	return message({
		id: 'assistant-1',
		parts: [
			readPart('read-result', 0, 'src/app.ts'),
			part({
				id: 'search-result',
				index: 1,
				type: 'tool_result',
				toolName: 'search',
				toolCallId: 'c2',
				contentJson: { args: { query: 'useMessages' }, result: {} },
			}),
			reasoningPart('reasoning-1', 2, 'Checking the paging code first.'),
			textPart('answer', 3, 'Here is the answer.'),
		],
	});
}

beforeEach(() => {
	resetThreadRowCache();
});

describe('compact thread preference reaches the rows', () => {
	it('maps the preference onto the compact flags', () => {
		expect(resolveThreadCompactMode({ compactThreadPreference: true })).toEqual(
			{ compact: true, responsiveCompact: true },
		);
		expect(
			resolveThreadCompactMode({ compactThreadPreference: false }),
		).toEqual({ compact: false, responsiveCompact: false });
	});

	it('forces compact rendering for looper threads without forcing density', () => {
		expect(
			resolveThreadCompactMode({
				sessionType: 'looper',
				compactThreadPreference: false,
			}),
		).toEqual({ compact: true, responsiveCompact: false });
		expect(
			resolveThreadCompactMode({
				forceCompact: true,
				compactThreadPreference: false,
			}),
		).toEqual({ compact: true, responsiveCompact: false });
	});

	it('turns the preference into the grouped activity presentation', () => {
		const turn = explorationTurn();
		const rowsFor = (compactThreadPreference: boolean) => {
			resetThreadRowCache();
			const { compact } = resolveThreadCompactMode({ compactThreadPreference });
			return build([turn], compact);
		};

		// Preference off: every part keeps its full renderer, nothing is grouped.
		const roomy = rowsFor(false);
		expect(groupRows(roomy)).toHaveLength(0);
		expect(itemRows(roomy).map((row) => row.variant)).toEqual([
			'part',
			'part',
			'part',
			'part',
		]);

		// Preference on: the exploratory run collapses into one activity box and
		// the answer keeps its own row.
		const compact = rowsFor(true);
		const groups = groupRows(compact);
		expect(groups).toHaveLength(1);
		expect(groups[0].key).toBe('cg:read-result');
		expect(groups[0].parts.map((p) => p.id)).toEqual([
			'read-result',
			'search-result',
			'reasoning-1',
		]);
		expect(itemRows(compact).map((row) => row.part.id)).toEqual(['answer']);
	});

	it('still auto-compacts very long completed turns outside compact mode', () => {
		const turn = message({
			id: 'assistant-1',
			parts: Array.from(
				{ length: AUTO_COMPACT_COMPLETED_PART_THRESHOLD + 2 },
				(_, index) => readPart(`read-${index}`, index, `file-${index}.ts`),
			),
		});
		const rows = build([turn], false);

		expect(groupRows(rows)).toHaveLength(1);
		expect(coveredPartIds(rows)).toHaveLength(
			AUTO_COMPACT_COMPLETED_PART_THRESHOLD + 2,
		);
	});
});

describe('compact activity group boundaries', () => {
	/** read, reason | answer | read, read | answer */
	function twoRunTurn(status: Message['status'] = 'complete') {
		return message({
			id: 'assistant-1',
			status,
			completedAt: status === 'pending' ? null : 2,
			parts: [
				readPart('r1', 0, 'a.ts'),
				reasoningPart('think-1', 1, 'Looking at a.ts'),
				textPart('mid-answer', 2, 'Found the entry point.'),
				readPart('r2', 3, 'b.ts'),
				readPart('r3', 4, 'c.ts'),
				textPart('final-answer', 5, 'Here is the fix.'),
			],
		});
	}

	it('opens a new box at every non-exploratory part', () => {
		const rows = build([twoRunTurn()], true);
		const groups = groupRows(rows);

		expect(groups.map((group) => group.key)).toEqual(['cg:r1', 'cg:r2']);
		expect(groups.map((group) => group.parts.map((p) => p.id))).toEqual([
			['r1', 'think-1'],
			['r2', 'r3'],
		]);
		// Boundaries land exactly around the text parts, which keep their rows.
		expect(
			rows.filter((row) => row.kind !== 'assistant-header').map((r) => r.key),
		).toEqual([
			'cg:r1',
			'i:mid-answer',
			'cg:r2',
			'i:final-answer',
			'ft:assistant-1',
		]);
	});

	it('covers every persisted part exactly once across boxes and rows', () => {
		const turn = twoRunTurn();
		const covered = coveredPartIds(build([turn], true));

		expect(covered).toEqual((turn.parts ?? []).map((p) => p.id));
		expect(new Set(covered).size).toBe(covered.length);
	});

	it('keeps one keyed entry per part inside a box', () => {
		const groups = groupRows(build([explorationTurn()], true));
		const entryIds = groups[0].entries.map((entry) => entry.id);

		expect(entryIds).toEqual(['read-result', 'search-result', 'reasoning-1']);
		expect(new Set(entryIds).size).toBe(entryIds.length);
	});

	it('keys a box on its first part so appends never remount it', () => {
		const first = message({
			id: 'assistant-1',
			status: 'pending',
			completedAt: null,
			parts: [readPart('r1', 0, 'a.ts')],
		});
		const grown = message({
			...first,
			parts: [
				first.parts?.[0] as MessagePart,
				readPart('r2', 1, 'b.ts'),
				reasoningPart('think-1', 2, 'Both files agree.'),
			],
		});

		const before = groupRows(build([first], true));
		const after = groupRows(build([grown], true));

		expect(before[0].key).toBe('cg:r1');
		expect(after[0].key).toBe('cg:r1');
		expect(after[0].entries).toHaveLength(3);
	});

	it('reuses the box row identity when none of its parts changed', () => {
		const turn = explorationTurn();
		const first = build([turn], true);
		const second = build([turn], true);

		for (let index = 0; index < first.length; index++) {
			expect(second[index]).toBe(first[index]);
		}
	});

	it('titles a box with the progress update that precedes it', () => {
		const turn = message({
			id: 'assistant-1',
			parts: [
				part({
					id: 'progress-1',
					index: 0,
					type: 'tool_result',
					toolName: 'progress_update',
					toolCallId: 'pc1',
					contentJson: { args: { message: 'Mapping the row model' } },
				}),
				readPart('r1', 1, 'a.ts'),
				readPart('r2', 2, 'b.ts'),
			],
		});
		const groups = groupRows(build([turn], true));

		expect(groups).toHaveLength(1);
		expect(groups[0].titleOverride).toBe('Mapping the row model');
		expect(renderGroupRow(groups[0])).toContain('Mapping the row model');
	});

	it('expands only the last box of a streaming turn', () => {
		const stillExploring = message({
			id: 'assistant-1',
			status: 'pending',
			completedAt: null,
			// Same two runs, but the turn is still inside the second one.
			parts: (twoRunTurn('pending').parts ?? []).filter(
				(p) => p.id !== 'final-answer',
			),
		});
		const streaming = groupRows(build([stillExploring], true));
		expect(streaming.map((group) => group.collapsed)).toEqual([true, false]);

		resetThreadRowCache();
		const finished = groupRows(build([twoRunTurn('complete')], true));
		expect(finished.map((group) => group.collapsed)).toEqual([true, true]);
	});

	it('does not collapse activity the reader watched live', () => {
		const cache = createThreadRowCache();
		const live = message({
			id: 'assistant-1',
			status: 'pending',
			completedAt: null,
			parts: [readPart('r1', 0, 'a.ts'), reasoningPart('t1', 1, 'Thinking')],
		});

		const whileLive = groupRows(build([live], true, cache));
		expect(whileLive[0].collapsed).toBe(false);

		const withAnswer = message({
			...live,
			parts: [...(live.parts ?? []), textPart('answer', 2, 'Final answer')],
		});
		const whileAnswering = groupRows(build([withAnswer], true, cache));
		expect(whileAnswering[0].collapsed).toBe(false);

		const complete = message({
			...withAnswer,
			status: 'complete',
			completedAt: 3,
		});
		const afterCompletion = groupRows(build([complete], true, cache));
		expect(afterCompletion[0].collapsed).toBe(false);
	});

	it('still collapses activity first encountered after completion', () => {
		const complete = message({
			id: 'assistant-1',
			status: 'complete',
			completedAt: 3,
			parts: [readPart('r1', 0, 'a.ts'), reasoningPart('t1', 1, 'Done')],
		});

		const groups = groupRows(build([complete], true, createThreadRowCache()));
		expect(groups[0].collapsed).toBe(true);
	});

	it('only opens activity first seen as the pending turn\u2019s last drawn row', () => {
		const streaming = message({
			id: 'assistant-1',
			status: 'pending',
			completedAt: null,
			parts: [readPart('r1', 0, 'a.ts'), reasoningPart('t1', 1, 'Thinking')],
		});
		expect(groupRows(build([streaming], true))[0].collapsed).toBe(false);

		resetThreadRowCache();
		const answered = message({
			...streaming,
			parts: [
				...(streaming.parts ?? []),
				textPart('answer', 2, 'Streaming answer'),
			],
		});
		expect(groupRows(build([answered], true))[0].collapsed).toBe(true);
	});
});

describe('compact activity group rendering', () => {
	it('renders one bordered, scrolling box around all of its activity lines', () => {
		const turn = message({
			id: 'assistant-1',
			status: 'pending',
			completedAt: null,
			parts: [
				readPart('read-result', 0, 'src/app.ts'),
				readPart('read-2', 1, 'src/list.ts'),
				reasoningPart('reasoning-1', 2, 'Checking the paging code first.'),
			],
		});
		const group = groupRows(build([turn], true))[0];
		expect(group.collapsed).toBe(false);

		const markup = renderGroupRow(group);

		// One box: exactly one visible boundary and one scrolling viewport for
		// the whole run, not one per part.
		expect(countOccurrences(markup, 'hsl(var(--border) / 0.6)')).toBe(1);
		expect(countOccurrences(markup, 'role="log"')).toBe(1);
		expect(countOccurrences(markup, 'overflow-y-auto')).toBe(1);
		expect(markup).toContain('Exploring');
		// Every part of the run is a line inside that single box.
		expect(markup).toContain('Reading src/app.ts');
		expect(markup).toContain('Reading src/list.ts');
		expect(markup).toContain('Checking the paging code first.');
	});

	it('collapses a finished box to a single summary line', () => {
		const group = groupRows(build([explorationTurn()], true))[0];
		expect(group.collapsed).toBe(true);

		const markup = renderGroupRow(group);

		// No live log, no visible border: just the summary.
		expect(markup).not.toContain('Reading src/app.ts');
		expect(countOccurrences(markup, 'hsl(var(--border) / 0.6)')).toBe(0);
		expect(markup).toContain('1px solid transparent');
		expect(markup).toMatch(/Reviewed|Searched|Explored|Thought/);
	});

	it('caps the live box height instead of growing with the run', () => {
		const longRun = message({
			id: 'assistant-1',
			status: 'pending',
			completedAt: null,
			parts: Array.from({ length: 40 }, (_, index) =>
				readPart(`read-${index}`, index, `file-${index}.ts`),
			),
		});
		const group = groupRows(build([longRun], true))[0];

		expect(group.entries).toHaveLength(40);
		const markup = renderGroupRow(group);
		// A single constrained viewport with the old fade mask, whatever the
		// number of lines.
		expect(countOccurrences(markup, 'role="log"')).toBe(1);
		expect(markup).toContain('max-height:168px');
		expect(markup).toContain('linear-gradient(to bottom, transparent 0px');
	});

	it('keeps the measured viewport growth animation and max-height cap', () => {
		const turn = message({
			id: 'assistant-1',
			status: 'pending',
			completedAt: null,
			parts: [readPart('read-result', 0, 'src/app.ts')],
		});
		const markup = renderGroupRow(groupRows(build([turn], true))[0]);

		// Preserve the existing growth UX. The collapse glitch is handled by
		// keeping live entries mounted until the outer max-height transition ends.
		expect(markup).toContain('height:28px');
		expect(markup).toContain('transition:height 320ms');
		expect(markup).toContain('will-change:height');
		expect(markup).toContain('max-height:168px');
	});

	it('does not use the compact chrome when compact mode is off', () => {
		const row = itemRows(build([explorationTurn()], false)).find(
			(item) => item.key === 'i:search-result',
		);
		if (!row) throw new Error('missing roomy row');

		const markup = renderItemRow(row, false);
		expect(markup).not.toContain('Exploring');
		expect(markup).not.toContain('role="log"');
		expect(markup.length).toBeGreaterThan(50);
	});

	it('renders measurable markup for every compact row', () => {
		const rows = build([explorationTurn()], true);
		for (const row of groupRows(rows)) {
			const markup = renderGroupRow(row);
			expect(markup.startsWith('<')).toBe(true);
		}
		for (const row of itemRows(rows)) {
			const markup = renderItemRow(row, true);
			expect(markup.startsWith('<')).toBe(true);
		}
	});
});
