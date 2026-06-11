import { memo, useMemo } from 'react';
import { useTheme } from '../theme.ts';

export const SUBAGENT_RESULTS_TAG = '<subagent_results>';

export function isSubagentResultsMessage(content: string): boolean {
	return content.trimStart().startsWith(SUBAGENT_RESULTS_TAG);
}

export interface ParsedSubagentResult {
	id: string;
	agent: string;
	status: string;
	task: string;
	result: string;
}

const RESULT_BLOCK_RE =
	/<subagent_result\s+id="([^"]*)"\s+agent="([^"]*)"\s+status="([^"]*)">([\s\S]*?)<\/subagent_result>/g;

export function parseSubagentResults(content: string): ParsedSubagentResult[] {
	const results: ParsedSubagentResult[] = [];
	for (const match of content.matchAll(RESULT_BLOCK_RE)) {
		const body = match[4] ?? '';
		const task = /<task>([\s\S]*?)<\/task>/.exec(body)?.[1]?.trim() ?? '';
		const result = /<result>([\s\S]*?)<\/result>/.exec(body)?.[1]?.trim() ?? '';
		results.push({
			id: match[1],
			agent: match[2],
			status: match[3],
			task,
			result,
		});
	}
	return results;
}

function clipLine(value: string, max: number): string {
	const line = value.replace(/\s+/g, ' ').trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const SubagentResultRow = memo(function SubagentResultRow({
	result,
}: {
	result: ParsedSubagentResult;
}) {
	const { colors } = useTheme();
	const ok = result.status === 'completed';
	const failed = result.status === 'failed' || result.status === 'cancelled';
	const icon = ok ? '✓' : failed ? '✗' : '→';
	const iconColor = ok ? colors.green : failed ? colors.red : colors.yellow;

	const resultLines = useMemo(
		() => result.result.split('\n').filter((l) => l.trim()),
		[result.result],
	);
	const preview = resultLines[0] ? clipLine(resultLines[0], 100) : '';
	const extra = resultLines.length > 1 ? resultLines.length - 1 : 0;

	return (
		<box style={{ flexDirection: 'column', width: '100%' }}>
			<box style={{ flexDirection: 'row', gap: 1, width: '100%' }}>
				<text style={{ flexShrink: 0 }} fg={iconColor}>
					{icon}
				</text>
				<text style={{ flexShrink: 0 }} fg={colors.fgBright}>
					<b>{result.agent}</b>
				</text>
				<text style={{ flexShrink: 0 }} fg={iconColor}>
					{result.status}
				</text>
				{result.task ? (
					<text
						style={{ flexShrink: 1, overflow: 'hidden' }}
						fg={colors.fgDark}
					>
						{clipLine(result.task, 120)}
					</text>
				) : null}
			</box>
			{preview ? (
				<box style={{ flexDirection: 'row', gap: 1, paddingLeft: 2 }}>
					<text
						style={{ flexShrink: 1, overflow: 'hidden' }}
						fg={colors.fgMuted}
					>
						{preview}
					</text>
					{extra > 0 && (
						<text style={{ flexShrink: 0 }} fg={colors.fgDimmed}>
							(+{extra} lines)
						</text>
					)}
				</box>
			) : null}
		</box>
	);
});

/**
 * Compact card for the automated "<subagent_results>" message injected into a
 * parent session, instead of rendering the raw tagged XML payload. Mirrors the
 * web UI SubagentResultsNotice in a TUI-friendly layout.
 */
export const SubagentResultsCard = memo(function SubagentResultsCard({
	results,
	timestamp,
}: {
	results: ParsedSubagentResult[];
	timestamp?: string;
}) {
	const { colors } = useTheme();

	return (
		<box
			style={{
				flexDirection: 'column',
				width: '100%',
				backgroundColor: colors.bgSubtle,
				paddingLeft: 1,
				paddingRight: 1,
				paddingTop: 1,
				paddingBottom: 1,
				gap: 1,
			}}
		>
			<box style={{ flexDirection: 'row', gap: 1 }}>
				<text fg={colors.purple}>◇</text>
				<text fg={colors.fgMuted}>
					<b>
						sub-agent {results.length === 1 ? 'result' : 'results'} received
					</b>
				</text>
				{timestamp ? <text fg={colors.fgDimmed}>{timestamp}</text> : null}
			</box>
			{results.map((result) => (
				<SubagentResultRow key={result.id} result={result} />
			))}
		</box>
	);
});
