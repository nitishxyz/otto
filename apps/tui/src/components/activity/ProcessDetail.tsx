import { useKeyboard } from '@opentui/react';
import { memo, useCallback, useState } from 'react';
import { abortSessionShellJob, deleteTerminalsById } from '@ottocode/api';
import { getProjectQuery } from '../../api.ts';
import { useTerminalOutput } from '../../hooks/useTerminalOutput.ts';
import { cleanProcessOutput } from '../../lib/activity.ts';
import { useTheme } from '../../theme.ts';
import type { ActivityShellJob, ActivityTerminal } from './types.ts';

function outputLines(raw: string): string[] {
	const bounded =
		raw.length > 40_000
			? `… earlier output truncated …\n${raw.slice(-40_000)}`
			: raw;
	const cleaned = cleanProcessOutput(bounded).replace(/\n+$/, '');
	return cleaned ? cleaned.split('\n') : [];
}

export const ShellDetail = memo(function ShellDetail({
	job,
	focused,
	onRefresh,
}: {
	job: ActivityShellJob;
	focused: boolean;
	onRefresh: () => void;
}) {
	const { colors } = useTheme();
	const [actionStatus, setActionStatus] = useState<string | null>(null);
	const stop = useCallback(async () => {
		if (job.status !== 'running') return;
		setActionStatus('stopping…');
		try {
			const response = await abortSessionShellJob({
				path: { sessionId: job.sessionId, jobId: job.id },
				query: getProjectQuery(),
			} as never);
			setActionStatus(response.error ? 'stop failed' : 'stopped');
			onRefresh();
		} catch {
			setActionStatus('stop failed');
		}
	}, [job.id, job.sessionId, job.status, onRefresh]);

	useKeyboard((key) => {
		if (!focused) return;
		if (key.raw === 's' && job.status === 'running') void stop();
		else if (key.raw === 'r') onRefresh();
	});

	let rawOutput = job.output;
	if (!rawOutput && job.result !== null && job.result !== undefined) {
		rawOutput =
			typeof job.result === 'string'
				? job.result
				: JSON.stringify(job.result, null, 2);
	}

	return (
		<ProcessFrame
			title="shell"
			status={job.status}
			command={job.command}
			cwd={job.cwd}
			meta={
				job.exitCode === null
					? job.detached
						? 'detached'
						: 'foreground'
					: `exit ${job.exitCode}`
			}
			lines={outputLines(rawOutput)}
			actionHint={job.status === 'running' ? 's stop · r refresh' : 'r refresh'}
			actionStatus={actionStatus}
			accent={colors.blue}
		/>
	);
});

export const TerminalDetail = memo(function TerminalDetail({
	terminal,
	focused,
	onRefresh,
}: {
	terminal: ActivityTerminal;
	focused: boolean;
	onRefresh: () => void;
}) {
	const { colors } = useTheme();
	const stream = useTerminalOutput(terminal.id);
	const [actionStatus, setActionStatus] = useState<string | null>(null);
	const stop = useCallback(async () => {
		if (terminal.status !== 'running') return;
		setActionStatus('stopping…');
		try {
			const response = await deleteTerminalsById({
				path: { id: terminal.id },
			} as never);
			setActionStatus(response.error ? 'stop failed' : 'stopped');
			onRefresh();
		} catch {
			setActionStatus('stop failed');
		}
	}, [onRefresh, terminal.id, terminal.status]);

	useKeyboard((key) => {
		if (!focused) return;
		if (key.raw === 's' && terminal.status === 'running') void stop();
		else if (key.raw === 'r') onRefresh();
	});

	return (
		<ProcessFrame
			title={terminal.title || terminal.purpose || 'terminal'}
			status={terminal.status}
			command={[terminal.command, ...terminal.args].join(' ')}
			cwd={terminal.cwd}
			meta={`pid ${terminal.pid}${stream.exitCode === null ? '' : ` · exit ${stream.exitCode}`}`}
			lines={outputLines(stream.output)}
			actionHint={
				terminal.status === 'running' ? 's stop · r refresh' : 'r refresh'
			}
			actionStatus={actionStatus ?? stream.error}
			accent={colors.yellow}
		/>
	);
});

function ProcessFrame({
	title,
	status,
	command,
	cwd,
	meta,
	lines,
	actionHint,
	actionStatus,
	accent,
}: {
	title: string;
	status: string;
	command: string;
	cwd: string;
	meta: string;
	lines: string[];
	actionHint: string;
	actionStatus: string | null;
	accent: string;
}) {
	const { colors } = useTheme();
	const failed = status === 'failed' || status === 'cancelled';
	return (
		<box style={{ width: '100%', height: '100%', flexDirection: 'column' }}>
			<box
				style={{
					flexDirection: 'column',
					paddingLeft: 1,
					paddingRight: 1,
					paddingBottom: 1,
				}}
			>
				<box style={{ flexDirection: 'row', gap: 1 }}>
					<text fg={accent}>▣</text>
					<text fg={colors.fgBright}>
						<b>{title}</b>
					</text>
					<text
						fg={
							failed
								? colors.red
								: status === 'running'
									? colors.blue
									: colors.green
						}
					>
						{status}
					</text>
					<text fg={colors.fgDimmed}>{meta}</text>
				</box>
				<text fg={colors.fgMuted} wrapMode="word">
					$ {command}
				</text>
				<text fg={colors.fgDark}>{cwd}</text>
			</box>

			<scrollbox
				style={{
					flexGrow: 1,
					width: '100%',
					paddingLeft: 1,
					paddingRight: 1,
					paddingTop: 1,
					backgroundColor: colors.bg,
				}}
				stickyScroll
				stickyStart="bottom"
			>
				{lines.length ? (
					lines.map((line, index) => (
						<text
							key={`${index}-${line.slice(0, 24)}`}
							fg={colors.fgMuted}
							wrapMode="word"
						>
							{line || ' '}
						</text>
					))
				) : (
					<text fg={colors.fgDimmed}>No output yet</text>
				)}
			</scrollbox>

			<box
				style={{
					height: 1,
					paddingLeft: 1,
					paddingRight: 1,
					flexDirection: 'row',
					gap: 2,
				}}
			>
				<text fg={colors.fgDimmed}>{actionHint}</text>
				{actionStatus ? <text fg={colors.yellow}>{actionStatus}</text> : null}
			</box>
		</box>
	);
}
