import { useRenderer, useKeyboard } from '@opentui/react';
import { TextareaRenderable } from '@opentui/core';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Fuse from 'fuse.js';
import { searchFiles } from '@ottocode/api';
import { useTheme } from '../theme.ts';
import { TinySpinner } from './TinySpinner.tsx';
import { COMMANDS } from '../commands.ts';
import type { StatusIndicator } from '../stores/overlay.ts';
import { useFileAttachments, isFilePath } from '../hooks/useFileAttachments.ts';
import type {
	ImageAttachment,
	FileAttachment,
} from '../hooks/useFileAttachments.ts';

interface ChatInputProps {
	onSubmit: (
		text: string,
		images?: ImageAttachment[],
		files?: FileAttachment[],
	) => void;
	disabled: boolean;
	status: StatusIndicator;
	isStreaming: boolean;
	provider: string;
	model: string;
	escHint: boolean;
	isPlanMode?: boolean;
	onPlanModeToggle?: (isPlanMode: boolean) => void;
}

const MAX_FILE_RESULTS = 15;
const INPUT_MIN_HEIGHT = 2;
const INPUT_MAX_HEIGHT = 8;
const ATTACHMENT_RE = /\[📎 [^\]]+\]/g;

function stripAttachmentMarkers(text: string): string {
	return text
		.replace(ATTACHMENT_RE, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function makeAttachmentMarker(name: string): string {
	const short = name.length > 20 ? `${name.slice(0, 17)}…` : name;
	return `[📎 ${short}]`;
}

export function ChatInput({
	onSubmit,
	disabled,
	status,
	isStreaming,
	provider,
	model,
	escHint,
	isPlanMode: externalIsPlanMode,
	onPlanModeToggle,
}: ChatInputProps) {
	const { colors } = useTheme();
	const renderer = useRenderer();
	const textareaRef = useRef<TextareaRenderable | null>(null);
	const containerRef = useRef<string>(`chat-input-${Date.now()}`);
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
		names: _attachmentNames,
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

	const [commandMatches, setCommandMatches] = useState<typeof COMMANDS>([]);
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

	const fuse = useMemo(
		() =>
			new Fuse(
				files.map((f) => ({
					path: f,
					filename: f.split('/').pop() || f,
					normalized: f.replace(/[.\-_/]/g, ''),
				})),
				{
					keys: [
						{ name: 'filename', weight: 2 },
						{ name: 'normalized', weight: 1.5 },
						{ name: 'path', weight: 1 },
					],
					threshold: 0.3,
					distance: 200,
					ignoreLocation: true,
					includeScore: true,
				},
			),
		[files],
	);

	const filteredFiles = useMemo(() => {
		if (!mentionQuery) {
			return files.slice(0, MAX_FILE_RESULTS);
		}
		const normalizedQuery = mentionQuery.replace(/[.\-_/]/g, '');
		const searchResults = fuse.search(normalizedQuery);
		return searchResults.slice(0, MAX_FILE_RESULTS).map((r) => r.item.path);
	}, [fuse, mentionQuery, files]);

	const filteredFilesRef = useRef(filteredFiles);
	filteredFilesRef.current = filteredFiles;

	useEffect(() => {
		if (!showFileMention) return;
		searchFiles({ query: { q: mentionQuery } }).then((res) => {
			if (res.data) {
				setFiles(res.data.files);
			}
		});
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
		const text = textareaRef.current.plainText;
		const cursor = textareaRef.current.editBuffer.getCursorPosition();

		if (text.startsWith('/') && !text.includes(' ')) {
			setShowFileMention(false);
			const query = text.slice(1).toLowerCase();
			const matches =
				query.length === 0
					? COMMANDS
					: COMMANDS.filter(
							(c) =>
								c.name.startsWith(query) || c.alias?.slice(1).startsWith(query),
						);
			setCommandMatches(matches);
			setSelectedIdx(0);
		} else {
			setCommandMatches([]);
			checkForMention(text, cursor.offset);
		}
	}, [checkForMention]);

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
			onSubmit(`/${cmd.name}`);
			return;
		}
		const rawText = textareaRef.current.plainText.trim();
		const text = stripAttachmentMarkers(rawText);
		if (!text && attachmentCountRef.current === 0) return;
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
	}, [onSubmit, handleFileSelect, disabled]);

	useKeyboard((key) => {
		if (disabled) return;

		if (key.ctrl && key.name === 'l') {
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
		}
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally sparse deps — this effect creates the textarea once; handleSubmit is synced via a separate useEffect below. Do NOT add colors.* or handleSubmit here — it causes the textarea to be destroyed/recreated on every render, breaking input.
	useEffect(() => {
		const container = renderer.root.findDescendantById(containerRef.current);
		if (!container || textareaRef.current) return;

		const textarea = new TextareaRenderable(renderer, {
			id: 'chat-textarea',
			width: '100%',
			height: 'auto',
			minHeight: INPUT_MIN_HEIGHT,
			maxHeight: INPUT_MAX_HEIGHT,
			placeholder: 'Message otto…  ↵ send  ⇧↵ newline  ⇥ mode',
			placeholderColor: colors.fgDark,
			textColor: colors.fgBright,
			focusedTextColor: colors.fgBright,
			cursorColor: colors.blue,
			wrapMode: 'word',
			keyBindings: [
				{ name: 'return', action: 'submit' },
				{ name: 'return', shift: true, action: 'newline' },
			],
			onSubmit: handleSubmit,
		});

		textarea.onContentChange = handleContentChange;

		const origHandlePaste = textarea.handlePaste.bind(textarea);
		textarea.handlePaste = (event) => {
			const text = event.text.trim();
			const filePath = text.replace(/\\ /g, ' ');
			if (isFilePath(filePath)) {
				const added = addFromPathRef.current(filePath);
				if (added) {
					const name = filePath.split('/').pop() || filePath;
					const marker = makeAttachmentMarker(name);
					const current = textarea.plainText;
					const prefix =
						current.length > 0 && !current.endsWith('\n') ? '\n' : '';
					textarea.editBuffer.setText(`${current}${prefix}${marker} `);
					textarea.editBuffer.setCursorByOffset(textarea.plainText.length);
				}
				return;
			}
			origHandlePaste(event);
		};

		container.add(textarea);
		textareaRef.current = textarea;
		textarea.focus();

		return () => {
			if (textareaRef.current) {
				textareaRef.current.destroy();
				textareaRef.current = null;
			}
		};
	}, [renderer, handleContentChange]);

	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.onSubmit = handleSubmit;
		}
	}, [handleSubmit]);

	useEffect(() => {
		if (!textareaRef.current) return;
		if (disabled) {
			textareaRef.current.blur();
		} else {
			textareaRef.current.focus();
		}
	}, [disabled]);

	const hasStatus = isStreaming || status.type !== 'idle';

	return (
		<box
			style={{
				width: '100%',
				flexShrink: 0,
				paddingLeft: 1,
				paddingRight: 1,
				flexDirection: 'column',
			}}
		>
			{showFileMention && filteredFiles.length > 0 && (
				<box
					style={{
						flexDirection: 'column',
						backgroundColor: colors.bgHighlight,
						borderStyle: 'rounded',
						border: true,
						borderColor: colors.border,
						paddingLeft: 1,
						paddingRight: 1,
						width: '100%',
					}}
				>
					{filteredFiles.map((filePath, i) => (
						<box
							key={filePath}
							style={{
								flexDirection: 'row',
								gap: 1,
								height: 1,
								width: '100%',
								backgroundColor:
									i === mentionSelectedIdx ? colors.bgSubtle : undefined,
							}}
						>
							<text fg={i === mentionSelectedIdx ? colors.blue : colors.fgDark}>
								@
							</text>
							<text
								fg={i === mentionSelectedIdx ? colors.green : colors.fgMuted}
							>
								{filePath}
							</text>
						</box>
					))}
				</box>
			)}
			{showFileMention &&
				filteredFiles.length === 0 &&
				mentionQuery.length > 0 && (
					<box
						style={{
							backgroundColor: colors.bgHighlight,
							borderStyle: 'rounded',
							border: true,
							borderColor: colors.border,
							paddingLeft: 1,
							paddingRight: 1,
							width: '100%',
							height: 1,
						}}
					>
						<text fg={colors.fgDark}>No files found</text>
					</box>
				)}
			{commandMatches.length > 0 && (
				<box
					style={{
						flexDirection: 'column',
						backgroundColor: colors.bgHighlight,
						borderStyle: 'rounded',
						border: true,
						borderColor: colors.border,
						paddingLeft: 1,
						paddingRight: 1,
						width: '100%',
					}}
				>
					{commandMatches.map((cmd, i) => (
						<box
							key={cmd.name}
							style={{
								flexDirection: 'row',
								gap: 1,
								height: 1,
								width: '100%',
								backgroundColor:
									i === selectedIdx ? colors.bgSubtle : undefined,
							}}
						>
							<text fg={i === selectedIdx ? colors.green : colors.fgMuted}>
								/{cmd.name}
							</text>
							<text fg={i === selectedIdx ? colors.fgMuted : colors.fgDark}>
								{cmd.description}
							</text>
						</box>
					))}
				</box>
			)}
			<box
				style={{
					width: '100%',
					backgroundColor: colors.bgHighlight,
					flexDirection: 'column',
					paddingTop: 1,
					paddingBottom: 1,
					paddingLeft: 1,
					paddingRight: 1,
					marginBottom: 1,
				}}
			>
				<box id={containerRef.current} style={{ width: '100%' }} />
			</box>
			<box
				style={{
					width: '100%',
					flexShrink: 0,
					flexDirection: 'row',
					justifyContent: 'space-between',
				}}
			>
				<box style={{ flexDirection: 'row', gap: 1 }}>
					<text
						fg={isPlanMode ? colors.bg : colors.bg}
						bg={isPlanMode ? colors.cyan : colors.blue}
					>
						{isPlanMode ? ' PLAN ' : ' BUILD '}
					</text>
					{hasStatus ? (
						<box style={{ flexDirection: 'row' }}>
							{isStreaming && status.type === 'idle' && (
								<box style={{ flexDirection: 'row', gap: 1 }}>
									<TinySpinner fg={colors.streamDot} />
									<text fg={colors.streamDot}>generating</text>
									{escHint && (
										<text fg={colors.yellow}>press Esc again to stop</text>
									)}
								</box>
							)}
							{status.type === 'loading' && (
								<box style={{ flexDirection: 'row', gap: 1 }}>
									<TinySpinner fg={colors.blue} />
									<text fg={colors.blue}>{status.label}</text>
								</box>
							)}
							{status.type === 'success' && (
								<text fg={colors.green}>✓ {status.label}</text>
							)}
							{status.type === 'error' && (
								<text fg={colors.red}>✗ {status.label}</text>
							)}
						</box>
					) : (
						<text fg={colors.fgDark}>⇥ switch mode · ⌃L clear</text>
					)}
				</box>
				<box style={{ flexDirection: 'row' }}>
					<text fg={colors.fgDark}>{provider}</text>
					<text fg={colors.fgDimmed}>/</text>
					<text fg={colors.fgMuted}>{model}</text>
				</box>
			</box>
		</box>
	);
}
