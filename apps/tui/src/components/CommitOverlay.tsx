import { useKeyboard } from '@opentui/react';
import type { TextareaRenderable } from '@opentui/core';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
	getGitStatus,
	stageFiles,
	generateCommitMessage,
	commitChanges,
} from '@ottocode/api';
import { useTheme } from '../theme.ts';
import { ModalFrame } from './ModalFrame.tsx';
import { TinySpinner } from './TinySpinner.tsx';
import { getProjectQuery } from '../api.ts';

interface GitFileInfo {
	path: string;
	status: string;
}

interface CommitOverlayProps {
	onClose: () => void;
	onCommitted: () => void;
}

type Phase =
	| 'loading'
	| 'idle'
	| 'generating'
	| 'committing'
	| 'done'
	| 'error';

export function CommitOverlay({ onClose, onCommitted }: CommitOverlayProps) {
	const { colors } = useTheme();
	const [phase, setPhase] = useState<Phase>('loading');
	const [staged, setStaged] = useState<GitFileInfo[]>([]);
	const [unstaged, setUnstaged] = useState<GitFileInfo[]>([]);
	const [untracked, setUntracked] = useState<GitFileInfo[]>([]);
	const [message, setMessage] = useState('');
	const [errorText, setErrorText] = useState('');
	const [statusText, setStatusText] = useState('');
	const textareaRef = useRef<TextareaRenderable | null>(null);
	const phaseRef = useRef(phase);
	phaseRef.current = phase;

	const loadStatus = useCallback(async () => {
		try {
			const res = await getGitStatus({ query: getProjectQuery() } as never);
			// biome-ignore lint/suspicious/noExplicitAny: SDK response type
			const data = (res.data as any)?.data;
			if (data) {
				setStaged(data.staged || []);
				setUnstaged(data.unstaged || []);
				setUntracked(data.untracked || []);
			}
			setPhase('idle');
		} catch {
			setErrorText('Failed to load git status');
			setPhase('error');
		}
	}, []);

	useEffect(() => {
		loadStatus();
	}, [loadStatus]);

	const stagedRef = useRef(staged);
	stagedRef.current = staged;
	const unstagedRef = useRef(unstaged);
	unstagedRef.current = unstaged;
	const untrackedRef = useRef(untracked);
	untrackedRef.current = untracked;

	const handleGenerate = useCallback(async () => {
		setPhase('generating');
		setErrorText('');
		setStatusText('Generating commit message…');
		try {
			const hasUnstaged =
				unstagedRef.current.length > 0 || untrackedRef.current.length > 0;
			if (stagedRef.current.length === 0 && hasUnstaged) {
				setStatusText('Staging files…');
				await stageFiles({
					query: getProjectQuery(),
					body: { files: ['.'] },
				} as never);
				await loadStatus();
				setStatusText('Generating commit message…');
			}
			const res = await generateCommitMessage({
				query: getProjectQuery(),
				body: {},
			} as never);
			// biome-ignore lint/suspicious/noExplicitAny: SDK response type
			if ((res as any).error) {
				// biome-ignore lint/suspicious/noExplicitAny: SDK error type
				const errData = (res as any).error;
				throw new Error(
					errData?.error || errData?.message || 'Unknown API error',
				);
			}
			// biome-ignore lint/suspicious/noExplicitAny: SDK response type
			const data = (res.data as any)?.data;
			const msg = data?.message;
			if (msg && textareaRef.current) {
				setMessage(msg);
				textareaRef.current.editBuffer.setText(msg);
				textareaRef.current.editBuffer.setCursorByOffset(msg.length);
				textareaRef.current.focus();
			} else if (!msg) {
				throw new Error('No commit message returned');
			}
			setStatusText('');
			setPhase('idle');
		} catch (err) {
			setErrorText(
				`Generate failed: ${err instanceof Error ? err.message : 'unknown error'}`,
			);
			setStatusText('');
			setPhase('idle');
		}
	}, [loadStatus]);

	const handleCommit = useCallback(async () => {
		const msg = textareaRef.current?.plainText.trim() || message.trim();
		if (!msg) {
			setErrorText('Enter a commit message first');
			return;
		}
		setPhase('committing');
		setErrorText('');
		setStatusText('Committing…');
		try {
			if (stagedRef.current.length === 0) {
				setStatusText('Staging files…');
				await stageFiles({
					query: getProjectQuery(),
					body: { files: ['.'] },
				} as never);
				setStatusText('Committing…');
			}
			const commitRes = await commitChanges({
				query: getProjectQuery(),
				body: { message: msg },
			} as never);
			// biome-ignore lint/suspicious/noExplicitAny: SDK error check
			if ((commitRes as any).error) {
				// biome-ignore lint/suspicious/noExplicitAny: SDK error type
				const errData = (commitRes as any).error;
				throw new Error(errData?.error || errData?.message || 'Commit failed');
			}
			setPhase('done');
			setStatusText('');
			onCommitted();
			setTimeout(onClose, 800);
		} catch (err) {
			setErrorText(
				`Commit failed: ${err instanceof Error ? err.message : 'unknown error'}`,
			);
			setStatusText('');
			setPhase('idle');
		}
	}, [message, onClose, onCommitted]);

	const handleContentChange = useCallback(() => {
		if (!textareaRef.current) return;
		setMessage(textareaRef.current.plainText);
	}, []);

	const handleGenerateRef = useRef(handleGenerate);
	handleGenerateRef.current = handleGenerate;
	const handleCommitRef = useRef(handleCommit);
	handleCommitRef.current = handleCommit;

	useKeyboard((key) => {
		if (key.name === 'escape') {
			onClose();
		} else if (key.name === 'return' && key.ctrl) {
			if (phaseRef.current === 'idle') handleCommitRef.current();
		} else if (key.name === 'g' && key.ctrl) {
			if (phaseRef.current === 'idle') handleGenerateRef.current();
		}
	});

	const totalChanges = staged.length + unstaged.length + untracked.length;

	const statusColor = (s: string) => {
		if (s === 'added' || s === 'untracked') return colors.green;
		if (s === 'deleted') return colors.red;
		return colors.yellow;
	};

	const statusChar = (s: string) => {
		if (s === 'added' || s === 'untracked') return 'A';
		if (s === 'deleted') return 'D';
		if (s === 'renamed') return 'R';
		return 'M';
	};

	return (
		<ModalFrame
			title="Commit"
			size="md"
			footer="Ctrl+G generate · Ctrl+Enter commit · Esc close"
		>
			{phase === 'loading' && (
				<box style={{ flexDirection: 'row', gap: 1 }}>
					<TinySpinner fg={colors.blue} />
					<text fg={colors.blue}>Loading git status…</text>
				</box>
			)}

			{phase === 'done' && (
				<text fg={colors.green}>✓ Committed successfully</text>
			)}

			{phase !== 'loading' && phase !== 'done' && (
				<box style={{ flexDirection: 'column' }}>
					{totalChanges === 0 && (
						<text fg={colors.fgDark}>No changes to commit</text>
					)}

					{staged.length > 0 && (
						<box style={{ flexDirection: 'column', marginBottom: 1 }}>
							<text fg={colors.green}>
								<b>Staged ({staged.length})</b>
							</text>
							{staged.slice(0, 8).map((f) => (
								<box
									key={f.path}
									style={{ flexDirection: 'row', gap: 1, height: 1 }}
								>
									<text fg={statusColor(f.status)}>{statusChar(f.status)}</text>
									<text fg={colors.fgMuted}>{f.path}</text>
								</box>
							))}
							{staged.length > 8 && (
								<text fg={colors.fgDark}> …and {staged.length - 8} more</text>
							)}
						</box>
					)}

					{unstaged.length > 0 && (
						<box style={{ flexDirection: 'column', marginBottom: 1 }}>
							<text fg={colors.yellow}>
								<b>Unstaged ({unstaged.length})</b>
							</text>
							{unstaged.slice(0, 5).map((f) => (
								<box
									key={f.path}
									style={{ flexDirection: 'row', gap: 1, height: 1 }}
								>
									<text fg={statusColor(f.status)}>{statusChar(f.status)}</text>
									<text fg={colors.fgDark}>{f.path}</text>
								</box>
							))}
							{unstaged.length > 5 && (
								<text fg={colors.fgDark}> …and {unstaged.length - 5} more</text>
							)}
						</box>
					)}

					{untracked.length > 0 && (
						<box style={{ flexDirection: 'column', marginBottom: 1 }}>
							<text fg={colors.fgDark}>
								<b>Untracked ({untracked.length})</b>
							</text>
							{untracked.slice(0, 3).map((f) => (
								<box
									key={f.path}
									style={{ flexDirection: 'row', gap: 1, height: 1 }}
								>
									<text fg={colors.fgDark}>?</text>
									<text fg={colors.fgDark}>{f.path}</text>
								</box>
							))}
							{untracked.length > 3 && (
								<text fg={colors.fgDark}>
									{' '}
									…and {untracked.length - 3} more
								</text>
							)}
						</box>
					)}

					<box style={{ flexDirection: 'column', marginTop: 1 }}>
						<box style={{ flexDirection: 'row', gap: 1 }}>
							<text fg={colors.fgDimmed}>Commit message:</text>
							{statusText && (
								<box style={{ flexDirection: 'row', gap: 1 }}>
									<TinySpinner fg={colors.yellow} />
									<text fg={colors.yellow}>{statusText}</text>
								</box>
							)}
						</box>
						<box
							style={{
								width: '100%',
								height: 5,
								flexShrink: 0,
								border: true,
								borderStyle: 'rounded',
								borderColor:
									phase === 'generating' ? colors.yellow : colors.border,
							}}
						>
							<textarea
								ref={textareaRef}
								focused
								placeholder="Type commit message or press Ctrl+G to generate"
								placeholderColor={colors.fgDark}
								textColor={colors.fgBright}
								focusedTextColor={colors.fgBright}
								backgroundColor={colors.bg}
								focusedBackgroundColor={colors.bg}
								cursorColor={colors.blue}
								wrapMode="word"
								onContentChange={handleContentChange}
								style={{ width: '100%', height: 3 }}
							/>
						</box>
					</box>

					{errorText && <text fg={colors.red}>{errorText}</text>}
				</box>
			)}
		</ModalFrame>
	);
}
