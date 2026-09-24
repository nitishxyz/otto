import type { RunOpts } from '../../session/queue.ts';
import type { MemorySettings } from '@ottocode/sdk';

export type MemoryTurnKind =
	| 'human'
	| 'parent-agent'
	| 'agent-results'
	| 'system';

/** Metadata takes precedence; these exact wrapper checks handle old queued messages without origin metadata. */
export function classifyMemoryTurn(
	opts: Pick<RunOpts, 'messageOrigin' | 'userContent'>,
	sessionType: string,
): MemoryTurnKind {
	if (opts.messageOrigin) return opts.messageOrigin;
	const content = opts.userContent?.trim() ?? '';
	if (sessionType === 'subagent') return 'parent-agent';
	if (/^<subagent_(?:results|compaction)\b/.test(content))
		return 'agent-results';
	if (!content) return 'system';
	return 'human';
}

/** Legacy delegated prompt wrappers are removed when only the task should drive recall. */
export function parentTaskText(
	opts: Pick<RunOpts, 'memoryTask' | 'userContent'>,
): string {
	if (opts.memoryTask !== undefined) return opts.memoryTask;
	const content = opts.userContent ?? '';
	const match =
		/(?:^|\n)(?:New task:|Task:|Follow-up from the delegating agent:)\s*\n([\s\S]*?)(?=\n(?:Additional context from the delegating agent:|Complete the task, then END|You still have your prior context\.|## Result)|$)/.exec(
			content,
		);
	return match?.[1]?.trim() ?? content;
}

export function memoryTurnPolicy(
	kind: MemoryTurnKind,
	settings?: MemorySettings,
	envCapture = true,
): {
	recall: boolean;
	capture: boolean;
	captureReason?: 'disabled' | 'not-human-turn';
} {
	const capture =
		settings?.enabled !== false &&
		settings?.autoCapture !== false &&
		envCapture &&
		(kind === 'human' ||
			(kind === 'parent-agent' && settings?.captureInSubagents === true));
	const recall =
		settings?.enabled !== false &&
		settings?.recall !== false &&
		(kind === 'human' ||
			(kind === 'parent-agent' && settings?.recallInSubagents !== false));
	return {
		capture,
		recall,
		...(!capture
			? {
					captureReason:
						kind === 'human'
							? ('disabled' as const)
							: ('not-human-turn' as const),
				}
			: {}),
	};
}
