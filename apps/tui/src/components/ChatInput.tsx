import { useKeyboard } from '@opentui/react';
import { decodePasteBytes } from '@opentui/core';
import type { TextareaOptions, TextareaRenderable } from '@opentui/core';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { searchFiles } from '@ottocode/api';
import { fuzzyMatchFilePath } from '@ottocode/sdk/search/file-rank';
import { useTheme } from '../theme.ts';
import { TinySpinner } from './TinySpinner.tsx';
import { getCommandSuggestions, type SlashCommand } from '../commands/index.ts';
import { getVisibleWindow } from './ModalFrame.tsx';
import type { StatusIndicator } from '../stores/overlay.ts';
import { useFileAttachments, isFilePath } from '../hooks/useFileAttachments.ts';
import { NARROW_RAIL_BORDER_CHARS } from './rail.ts';
import type {
	ImageAttachment,
	FileAttachment,
} from '../hooks/useFileAttachments.ts';
import { getProjectQuery } from '../api.ts';
import { useDictation } from '../hooks/useDictation.ts';
import { useOverlayStore } from '../stores/overlay.ts';
import { DictationWaveform } from './DictationWaveform.tsx';

interface ChatInputProps {
	onSubmit: (
		text: string,
		images?: ImageAttachment[],
		files?: FileAttachment[],
	) => void;
	disabled: boolean;
	status: StatusIndicator;
	isStreaming: boolean;
	agent: string;
	provider: string;
	model: string;
	escHint: boolean;
	queueSize?: number;
	isPlanMode?: boolean;
	paneActive?: boolean;
	releaseToSend?: boolean;
	onPlanModeToggle?: (isPlanMode: boolean) => void;
	recipeCommands?: SlashCommand[];
}

const MAX_PROMPT_HISTORY = 50;

const MAX_FILE_RESULTS = 15;
const MENU_VISIBLE_ROWS = 8;

const INPUT_KEY_BINDINGS: NonNullable<TextareaOptions['keyBindings']> = [
	{ name: 'return', action: 'submit' },
	{ name: 'return', shift: true, action: 'newline' },
];

export function ChatInput({
	onSubmit,
	disabled,
	status,
	isStreaming,
	agent,
	provider,
	model,
	escHint,
	queueSize = 0,
	isPlanMode: externalIsPlanMode,
	paneActive = true,
	releaseToSend = false,
	onPlanModeToggle,
	recipeCommands = [],
}: ChatInputProps) {
	const { colors } = useTheme();
	const textareaRef = useRef<TextareaRenderable | null>(null);
	const [isPlanMode, setIsPlanMode] = useState(externalIsPlanMode || false);
	const isPlanModeRef = useRef(isPlanMode);
	isPlanModeRef.current = isPlanMode;

	useEffect(() => {
		if (externalIsPlanMode !== undefined) {
			setIsPlanMode(externalIsPlanMode);
		}
	}, [externalIsPlanMode]);

	const {
		images: attachedImages,
		files: attachedFiles,
		count: attachmentCount,
		names: attachmentNames,
		addFromPath,
		clear: clearAttachments,
	} = useFileAttachments();
	const addFromPathRef = useRef(addFromPath);
	const attachedImagesRef = useRef(attachedImages);
	const attachedFilesRef = useRef(attachedFiles);
	const attachmentCountRef = useRef(attachmentCount);
	const clearAttachmentsRef = useRef(clearAttachments);
	addFromPathRef.current = addFromPath;
	attachedImagesRef.current = attachedImages;
	attachedFilesRef.current = attachedFiles;
	attachmentCountRef.current = attachmentCount;
	clearAttachmentsRef.current = clearAttachments;

	const requestDictationInstall = useOverlayStore(
		(state) => state.requestDictationInstall,
	);
	const showStatus = useOverlayStore((state) => state.showStatus);
	const dictation = useDictation({
		getDraft: () => textareaRef.current?.plainText ?? '',
		setDraft: (text) => {
			const textarea = textareaRef.current;
			if (!textarea) return;
			textarea.editBuffer.setText(text);
			textarea.editBuffer.setCursorByOffset(text.length);
			textarea.focus();
		},
		submit: (text) => {
			const imageData =
				attachedImagesRef.current.length > 0
					? attachedImagesRef.current
					: undefined;
			const fileData =
				attachedFilesRef.current.length > 0
					? attachedFilesRef.current
					: undefined;
			onSubmit(text, imageData, fileData);
			textareaRef.current?.clear();
			clearAttachmentsRef.current();
		},
		releaseToSend,
		onNeedsInstall: requestDictationInstall,
		onError: (message) => showStatus({ type: 'error', label: message }, 5_000),
	});

	useEffect(() => {
		if (!disabled && !dictation.isActive) textareaRef.current?.focus();
	}, [dictation.isActive, disabled]);

	const [commandMatches, setCommandMatches] = useState<SlashCommand[]>([]);
	const [selectedIdx, setSelectedIdx] = useState(0);
	const commandMatchesRef = useRef(commandMatches);
	const selectedIdxRef = useRef(selectedIdx);
	commandMatchesRef.current = commandMatches;
	selectedIdxRef.current = selectedIdx;

	const [files, setFiles] = useState<string[]>([]);
	const [showFileMention, setShowFileMention] = useState(false);
	const [mentionQuery, setMentionQuery] = useState('');
	const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0);
	const mentionSelectedIdxRef = useRef(mentionSelectedIdx);
	const showFileMentionRef = useRef(showFileMention);
	showFileMentionRef.current = showFileMention;
	mentionSelectedIdxRef.current = mentionSelectedIdx;

	const filteredFiles = useMemo(() => {
		if (!mentionQuery) {
			return files.slice(0, MAX_FILE_RESULTS);
		}
		return files
			.map((file) => ({ file, ...fuzzyMatchFilePath(mentionQuery, file) }))
			.filter((result) => result.match)
			.sort((a, b) => b.score - a.score)
			.slice(0, MAX_FILE_RESULTS)
			.map((result) => result.file);
	}, [mentionQuery, files]);

	const filteredFilesRef = useRef(filteredFiles);
	filteredFilesRef.current = filteredFiles;

	const historyRef = useRef<string[]>([]);
	const historyIdxRef = useRef<number | null>(null);
	const historyDraftRef = useRef('');
	const restoringHistoryRef = useRef(false);

	const pushHistory = useCallback((text: string) => {
		const entries = historyRef.current;
		if (entries[entries.length - 1] !== text) {
			entries.push(text);
			if (entries.length > MAX_PROMPT_HISTORY) entries.shift();
		}
		historyIdxRef.current = null;
		historyDraftRef.current = '';
	}, []);

	const recallHistory = useCallback((direction: -1 | 1): boolean => {
		const textarea = textareaRef.current;
		const entries = historyRef.current;
		if (!textarea || entries.length === 0) return false;
		const current = historyIdxRef.current;

		if (direction === -1) {
			if (current === null) {
				if (textarea.plainText.trim().length > 0) return false;
				historyDraftRef.current = textarea.plainText;
				historyIdxRef.current = entries.length - 1;
			} else if (current > 0) {
				historyIdxRef.current = current - 1;
			} else {
				return true;
			}
		} else {
			if (current === null) return false;
			if (current < entries.length - 1) {
				historyIdxRef.current = current + 1;
			} else {
				historyIdxRef.current = null;
			}
		}

		const idx = historyIdxRef.current;
		const next = idx === null ? historyDraftRef.current : entries[idx];
		restoringHistoryRef.current = true;
		textarea.editBuffer.setText(next);
		textarea.editBuffer.setCursorByOffset(next.length);
		restoringHistoryRef.current = false;
		return true;
	}, []);

	useEffect(() => {
		if (!showFileMention) return;
		searchFiles({ query: { ...getProjectQuery(), q: mentionQuery } }).then(
			(res) => {
				if (res.data) {
					setFiles(res.data.files);
				}
			},
		);
	}, [showFileMention, mentionQuery]);

	const checkForMention = useCallback((text: string, cursorOffset: number) => {
		const textBeforeCursor = text.slice(0, cursorOffset);
		const match = textBeforeCursor.match(/(^|[\s])@(\S*)$/);
		if (match) {
			setShowFileMention(true);
			setMentionQuery(match[2]);
			setMentionSelectedIdx(0);
		} else {
			setShowFileMention(false);
		}
	}, []);

	const handleFileSelect = useCallback((filePath: string) => {
		const textarea = textareaRef.current;
		if (!textarea) return;

		const text = textarea.plainText;
		const cursor = textarea.editBuffer.getCursorPosition();
		const cursorOffset = cursor.offset;
		const textBeforeCursor = text.slice(0, cursorOffset);

		const match = textBeforeCursor.match(/(^|[\s])@(\S*)$/);
		if (!match) return;

		const atPos = cursorOffset - match[0].length + match[1].length;
		const newValue = `${text.slice(0, atPos)}@${filePath} ${text.slice(cursorOffset)}`;

		textarea.editBuffer.setText(newValue);
		const newCursorOffset = atPos + filePath.length + 2;
		textarea.editBuffer.setCursorByOffset(newCursorOffset);

		setShowFileMention(false);
		setMentionQuery('');
	}, []);

	const handleContentChange = useCallback(() => {
		if (!textareaRef.current) return;
		if (!restoringHistoryRef.current) {
			historyIdxRef.current = null;
		}
		const text = textareaRef.current.plainText;
		const cursor = textareaRef.current.editBuffer.getCursorPosition();

		if (text.startsWith('/') && !text.includes(' ')) {
			setShowFileMention(false);
			const query = text.slice(1).toLowerCase();
			const matches = getCommandSuggestions(
				query,
				queueSize > 0,
				recipeCommands,
			);
			setCommandMatches(matches);
			setSelectedIdx(0);
		} else {
			setCommandMatches([]);
			checkForMention(text, cursor.offset);
		}
	}, [checkForMention, queueSize, recipeCommands]);

	useEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		const text = textarea.plainText;
		if (!text.startsWith('/') || text.includes(' ')) return;
		setCommandMatches(
			getCommandSuggestions(
				text.slice(1).toLowerCase(),
				queueSize > 0,
				recipeCommands,
			),
		);
		setSelectedIdx(0);
	}, [queueSize, recipeCommands]);

	const handleToggleDictation = useCallback(() => {
		setCommandMatches([]);
		setSelectedIdx(0);
		setShowFileMention(false);
		setMentionQuery('');
		setMentionSelectedIdx(0);
		dictation.toggle();
	}, [dictation]);

	const handleSubmit = useCallback(() => {
		if (disabled) return;
		if (!textareaRef.current) return;

		if (showFileMentionRef.current) {
			const ff = filteredFilesRef.current;
			const idx = mentionSelectedIdxRef.current;
			if (ff.length > 0 && idx >= 0 && idx < ff.length) {
				handleFileSelect(ff[idx]);
				return;
			}
		}

		const matches = commandMatchesRef.current;
		const idx = selectedIdxRef.current;
		if (matches.length > 0 && idx >= 0 && idx < matches.length) {
			const cmd = matches[idx];
			textareaRef.current.clear();
			setCommandMatches([]);
			if (cmd.name === 'dictate') {
				handleToggleDictation();
				return;
			}
			onSubmit(`/${cmd.name}`);
			return;
		}
		const text = textareaRef.current.plainText.trim();
		if (text === '/dictate' || text === '/d') {
			textareaRef.current.clear();
			setCommandMatches([]);
			handleToggleDictation();
			return;
		}
		if (!text && attachmentCountRef.current === 0) return;
		if (text) pushHistory(text);
		const imgData =
			attachedImagesRef.current.length > 0
				? attachedImagesRef.current
				: undefined;
		const fileData =
			attachedFilesRef.current.length > 0
				? attachedFilesRef.current
				: undefined;
		onSubmit(text, imgData, fileData);
		textareaRef.current.clear();
		clearAttachmentsRef.current();
		setCommandMatches([]);
		setShowFileMention(false);
	}, [
		onSubmit,
		handleFileSelect,
		disabled,
		pushHistory,
		handleToggleDictation,
	]);

	useKeyboard((key) => {
		if (dictation.isActive) {
			if (
				(key.ctrl && key.name === 'd') ||
				(key.name === 'return' && dictation.phase === 'recording')
			) {
				key.preventDefault();
				key.stopPropagation();
				void dictation.stop();
			} else if (key.name === 'escape') {
				key.preventDefault();
				key.stopPropagation();
				void dictation.cancel();
			}
			return;
		}
		if (disabled) return;

		if (key.ctrl && key.name === 'd') {
			key.preventDefault();
			key.stopPropagation();
			handleToggleDictation();
			return;
		}

		if (
			key.name === '/' &&
			!key.ctrl &&
			!key.meta &&
			!key.shift &&
			!key.option &&
			textareaRef.current &&
			!textareaRef.current.focused
		) {
			key.preventDefault();
			textareaRef.current.focus();
			return;
		}

		if (key.ctrl && key.name === 'k') {
			if (textareaRef.current) {
				textareaRef.current.clear();
			}
			clearAttachmentsRef.current();
			setCommandMatches([]);
			setSelectedIdx(0);
			setShowFileMention(false);
			setMentionQuery('');
			setMentionSelectedIdx(0);
			return;
		}

		if (showFileMentionRef.current && filteredFilesRef.current.length > 0) {
			if (key.name === 'up') {
				setMentionSelectedIdx((prev) => {
					const next = prev - 1;
					return next < 0 ? filteredFilesRef.current.length - 1 : next;
				});
			} else if (key.name === 'down') {
				setMentionSelectedIdx((prev) => {
					const next = prev + 1;
					return next >= filteredFilesRef.current.length ? 0 : next;
				});
			} else if (key.name === 'tab') {
				const ff = filteredFilesRef.current;
				const idx = mentionSelectedIdxRef.current;
				if (ff.length > 0 && idx >= 0 && idx < ff.length) {
					handleFileSelect(ff[idx]);
				}
			} else if (key.name === 'escape') {
				setShowFileMention(false);
			}
			return;
		}

		if (commandMatchesRef.current.length > 0) {
			if (key.name === 'up') {
				setSelectedIdx((prev) => {
					const next = prev - 1;
					return next < 0 ? commandMatchesRef.current.length - 1 : next;
				});
			} else if (key.name === 'down') {
				setSelectedIdx((prev) => {
					const next = prev + 1;
					return next >= commandMatchesRef.current.length ? 0 : next;
				});
			} else if (key.name === 'tab') {
				const matches = commandMatchesRef.current;
				const idx = selectedIdxRef.current;
				if (
					matches.length > 0 &&
					idx >= 0 &&
					idx < matches.length &&
					textareaRef.current
				) {
					textareaRef.current.clear();
					textareaRef.current.insertText(`/${matches[idx].name}`);
					handleContentChange();
				}
			} else if (key.name === 'escape') {
				setCommandMatches([]);
			}
			return;
		}

		if (key.name === 'tab') {
			const next = !isPlanModeRef.current;
			setIsPlanMode(next);
			onPlanModeToggle?.(next);
			return;
		}

		if (key.name === 'up' && !key.ctrl && !key.meta && !key.shift) {
			recallHistory(-1);
			return;
		}
		if (key.name === 'down' && !key.ctrl && !key.meta && !key.shift) {
			recallHistory(1);
		}
	});

	// Intercept pasted file paths and turn them into attachments instead of text.
	useEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		const origHandlePaste = textarea.handlePaste.bind(textarea);
		textarea.handlePaste = (event) => {
			const text = decodePasteBytes(event.bytes).trim();
			const filePath = text.replace(/\\ /g, ' ');
			if (isFilePath(filePath)) {
				addFromPathRef.current(filePath);
				return;
			}
			origHandlePaste(event);
		};
		return () => {
			textarea.handlePaste = origHandlePaste;
		};
	}, []);

	const hasStatus = isStreaming || status.type !== 'idle';
	const hasModelLabel = provider.length > 0 || model.length > 0;
	const accent = isPlanMode ? colors.cyan : colors.blue;
	const railColor = disabled ? colors.border : accent;
	const inputBg = paneActive ? colors.bgSubtle : colors.bgDark;
	const inputTextColor = paneActive ? colors.fgBright : colors.fgMuted;

	const fileWindow = getVisibleWindow(
		filteredFiles.length,
		mentionSelectedIdx,
		MENU_VISIBLE_ROWS,
	);
	const commandWindow = getVisibleWindow(
		commandMatches.length,
		selectedIdx,
		MENU_VISIBLE_ROWS,
	);

	return (
		<box
			style={{
				width: '100%',
				flexShrink: 0,
				position: 'relative',
				zIndex: 1000,
				paddingLeft: 1,
				paddingRight: 1,
				flexDirection: 'column',
			}}
		>
			{showFileMention && filteredFiles.length > 0 && (
				<box
					style={{
						position: 'absolute',
						bottom: 5,
						left: 1,
						right: 1,
						zIndex: 1001,
						flexDirection: 'column',
						backgroundColor: colors.bg,
						border: true,
						borderStyle: 'rounded',
						borderColor: colors.border,
						paddingLeft: 1,
						paddingRight: 1,
						width: '100%',
					}}
				>
					{filteredFiles
						.slice(fileWindow.start, fileWindow.end)
						.map((filePath, wi) => {
							const i = fileWindow.start + wi;
							const active = i === mentionSelectedIdx;
							return (
								<box
									key={filePath}
									style={{
										flexDirection: 'row',
										height: 1,
										width: '100%',
										backgroundColor: active ? colors.bgHighlight : undefined,
									}}
								>
									<text fg={active ? colors.blue : colors.bg}>▌</text>
									<text fg={active ? colors.blue : colors.fgDark}> @</text>
									<text fg={active ? colors.fgBright : colors.fgMuted}>
										{filePath}
									</text>
								</box>
							);
						})}
					{filteredFiles.length > MENU_VISIBLE_ROWS && (
						<box style={{ height: 1, paddingLeft: 2 }}>
							<text fg={colors.fgDark}>
								{mentionSelectedIdx + 1}/{filteredFiles.length}
							</text>
						</box>
					)}
				</box>
			)}
			{showFileMention &&
				filteredFiles.length === 0 &&
				mentionQuery.length > 0 && (
					<box
						style={{
							position: 'absolute',
							bottom: 5,
							left: 1,
							right: 1,
							zIndex: 1001,
							backgroundColor: colors.bg,
							border: true,
							borderStyle: 'rounded',
							borderColor: colors.border,
							paddingLeft: 2,
							paddingRight: 1,
							width: '100%',
							height: 3,
						}}
					>
						<text fg={colors.fgDark}>No files found</text>
					</box>
				)}
			{commandMatches.length > 0 && (
				<box
					style={{
						position: 'absolute',
						bottom: 5,
						left: 1,
						right: 1,
						zIndex: 1001,
						flexDirection: 'column',
						backgroundColor: colors.bg,
						border: true,
						borderStyle: 'rounded',
						borderColor: colors.border,
						paddingLeft: 1,
						paddingRight: 1,
						width: '100%',
					}}
				>
					{commandMatches
						.slice(commandWindow.start, commandWindow.end)
						.map((cmd, wi) => {
							const i = commandWindow.start + wi;
							const active = i === selectedIdx;
							return (
								<box
									key={cmd.name}
									style={{
										flexDirection: 'row',
										gap: 1,
										height: 1,
										width: '100%',
										backgroundColor: active ? colors.bgHighlight : undefined,
									}}
								>
									<text
										style={{ flexShrink: 0 }}
										fg={active ? colors.blue : colors.bg}
									>
										▌
									</text>
									<text
										style={{ flexShrink: 0 }}
										fg={active ? colors.green : colors.fgMuted}
										wrapMode="none"
									>
										/{cmd.name}
									</text>
									<text
										style={{ flexShrink: 1, overflow: 'hidden' }}
										fg={active ? colors.fgMuted : colors.fgDark}
										wrapMode="none"
										truncate
									>
										{cmd.description}
									</text>
								</box>
							);
						})}
					{commandMatches.length > MENU_VISIBLE_ROWS && (
						<box style={{ height: 1, paddingLeft: 2 }}>
							<text fg={colors.fgDark}>
								{selectedIdx + 1}/{commandMatches.length}
							</text>
						</box>
					)}
				</box>
			)}
			<box
				customBorderChars={NARROW_RAIL_BORDER_CHARS}
				style={{
					width: '100%',
					border: ['left'],
					borderColor: railColor,
					backgroundColor: inputBg,
					flexDirection: 'column',
					paddingLeft: 2,
					paddingRight: 2,
					paddingTop: dictation.isActive ? 0 : 1,
					paddingBottom: dictation.isActive ? 0 : 1,
					gap: dictation.isActive ? 0 : 1,
				}}
			>
				{attachmentCount > 0 && !dictation.isActive && (
					<box
						style={{
							flexDirection: 'row',
							gap: 1,
							height: 1,
							width: '100%',
							flexShrink: 0,
						}}
					>
						{attachmentNames.map((name) => (
							<text key={name} fg={colors.fgMuted} bg={colors.bgHighlight}>
								{' ◳ '}
								{name.length > 24 ? `${name.slice(0, 21)}…` : name}{' '}
							</text>
						))}
					</box>
				)}
				<box
					style={{
						flexDirection: 'row',
						width: '100%',
					}}
					visible={!dictation.isActive}
				>
					<textarea
						ref={textareaRef}
						focused={!disabled && !dictation.isActive}
						placeholder="Message otto…"
						placeholderColor={colors.fgDark}
						textColor={inputTextColor}
						focusedTextColor={inputTextColor}
						backgroundColor={inputBg}
						focusedBackgroundColor={inputBg}
						cursorColor={accent}
						wrapMode="word"
						keyBindings={INPUT_KEY_BINDINGS}
						onSubmit={handleSubmit}
						onContentChange={handleContentChange}
						style={{
							flexGrow: 1,
							height: 'auto',
							minHeight: 1,
							maxHeight: 8,
						}}
					/>
				</box>
				{dictation.isActive && (
					<box
						style={{
							width: '100%',
							height: 6,
							flexShrink: 0,
						}}
					>
						<DictationWaveform
							phase={dictation.phase}
							level={dictation.level}
							startedAt={dictation.startedAt}
						/>
					</box>
				)}
				<box
					style={{
						width: '100%',
						height: 1,
						flexShrink: 0,
						flexDirection: 'row',
						justifyContent: dictation.isActive ? 'center' : 'space-between',
						overflow: 'hidden',
					}}
				>
					{dictation.isActive && (
						<text fg={colors.fgDark} wrapMode="none">
							{dictation.phase === 'recording'
								? 'Ctrl+D or Enter stop  ·  Esc cancel'
								: dictation.phase === 'transcribing'
									? 'Finishing transcript  ·  Esc cancel'
									: 'Esc cancel'}
						</text>
					)}
					<box
						visible={!dictation.isActive}
						style={{
							flexDirection: 'row',
							gap: 1,
							flexShrink: 1,
							overflow: 'hidden',
						}}
					>
						<text style={{ flexShrink: 0 }} fg={accent} wrapMode="none">
							<b>{agent || 'build'}</b>
						</text>
						{hasStatus && (
							<box style={{ flexDirection: 'row', overflow: 'hidden' }}>
								{isStreaming && status.type === 'idle' && (
									<box
										style={{ flexDirection: 'row', gap: 1, overflow: 'hidden' }}
									>
										<TinySpinner fg={railColor} />
										{escHint && (
											<text fg={colors.yellow} wrapMode="none" truncate>
												press Esc again to stop
											</text>
										)}
									</box>
								)}
								{status.type === 'loading' && (
									<box
										style={{ flexDirection: 'row', gap: 1, overflow: 'hidden' }}
									>
										<TinySpinner fg={railColor} />
										<text fg={colors.blue} wrapMode="none" truncate>
											{status.label}
										</text>
									</box>
								)}
								{status.type === 'success' && (
									<text fg={colors.green} wrapMode="none" truncate>
										✓ {status.label}
									</text>
								)}
								{status.type === 'error' && (
									<text fg={colors.red} wrapMode="none" truncate>
										✗ {status.label}
									</text>
								)}
							</box>
						)}
						{queueSize > 0 && (
							<box style={{ flexDirection: 'row', gap: 1, flexShrink: 0 }}>
								<text fg={colors.fgDark}>·</text>
								<text fg={colors.yellow} wrapMode="none">
									{queueSize} queued
								</text>
							</box>
						)}
					</box>
					{hasModelLabel && (
						<box
							visible={!dictation.isActive}
							style={{
								flexDirection: 'row',
								flexShrink: 1,
								overflow: 'hidden',
							}}
						>
							{provider.length > 0 && (
								<text
									style={{ flexShrink: 0 }}
									fg={colors.fgDark}
									wrapMode="none"
								>
									{provider}
								</text>
							)}
							{provider.length > 0 && model.length > 0 && (
								<text
									style={{ flexShrink: 0 }}
									fg={colors.fgDimmed}
									wrapMode="none"
								>
									/
								</text>
							)}
							{model.length > 0 && (
								<text
									style={{ flexShrink: 1, overflow: 'hidden' }}
									fg={colors.fgMuted}
									wrapMode="none"
									truncate
								>
									{model}
								</text>
							)}
						</box>
					)}
				</box>
			</box>
		</box>
	);
}
