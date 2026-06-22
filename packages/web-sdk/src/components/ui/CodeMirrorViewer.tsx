import {
	Compartment,
	type Extension,
	EditorState,
	RangeSetBuilder,
} from '@codemirror/state';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import {
	HighlightStyle,
	StreamLanguage,
	syntaxHighlighting,
} from '@codemirror/language';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { go } from '@codemirror/legacy-modes/mode/go';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import {
	Decoration,
	EditorView,
	lineNumbers,
	type DecorationSet,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CodeMirrorTextSelection } from '../../lib/fileSelectionContext';

export type CodeMirrorLineTone = 'add' | 'remove' | 'primary';
export interface CodeMirrorLineToneRange {
	from: number;
	to: number;
	tone: CodeMirrorLineTone;
}
type CodeMirrorLineNumberFormatter = (lineNumber: number) => string;

const LARGE_SYNTAX_DISABLE_CHARS = 80_000;
const SMALL_CHANGE_MAX_CHARS = 20_000;

interface CodeMirrorViewerProps {
	content: string;
	path?: string;
	className?: string;
	highlightedLines?: Set<number>;
	highlightTone?: CodeMirrorLineTone;
	lineTones?: Map<number, CodeMirrorLineTone>;
	lineToneRanges?: readonly CodeMirrorLineToneRange[];
	scrollToLine?: number;
	scrollToEndSignal?: string | number;
	disableMarkdownSyntax?: boolean;
	lineNumberFormatter?: CodeMirrorLineNumberFormatter;
	onSelectionChange?: (selection: CodeMirrorTextSelection | null) => void;
}

const viewerTheme = EditorView.theme({
	'&': {
		height: '100%',
		backgroundColor: 'hsl(var(--sidebar-background))',
		color: 'hsl(var(--foreground))',
		fontSize: '13px',
		'--otto-cm-keyword': '#8b5cf6',
		'--otto-cm-name': 'hsl(var(--foreground) / 0.86)',
		'--otto-cm-property': '#2563eb',
		'--otto-cm-function': '#0f766e',
		'--otto-cm-constant': '#b45309',
		'--otto-cm-definition': '#4f46e5',
		'--otto-cm-number': '#a16207',
		'--otto-cm-type': '#0e7490',
		'--otto-cm-operator': 'hsl(var(--muted-foreground))',
		'--otto-cm-string': '#15803d',
		'--otto-cm-comment': 'hsl(var(--muted-foreground) / 0.72)',
		'--otto-cm-invalid': '#dc2626',
	},
	'.dark &': {
		'--otto-cm-keyword': '#c586c0',
		'--otto-cm-name': '#d4d4d4',
		'--otto-cm-property': '#9cdcfe',
		'--otto-cm-function': '#dcdcaa',
		'--otto-cm-constant': '#4fc1ff',
		'--otto-cm-definition': '#9cdcfe',
		'--otto-cm-number': '#b5cea8',
		'--otto-cm-type': '#4ec9b0',
		'--otto-cm-operator': '#d4d4d4',
		'--otto-cm-string': '#ce9178',
		'--otto-cm-comment': '#6a9955',
		'--otto-cm-invalid': '#f44747',
	},
	'&.cm-focused': {
		outline: 'none',
	},
	'.cm-scroller': {
		fontFamily:
			'var(--otto-font-family, "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
		lineHeight: '1.3125rem',
		scrollbarWidth: 'none',
		msOverflowStyle: 'none',
	},
	'.cm-scroller::-webkit-scrollbar': {
		display: 'none',
		width: 0,
		height: 0,
	},
	'.cm-content': {
		padding: '1rem 0',
		caretColor: 'transparent',
	},
	'.cm-line': {
		padding: '0 0.75rem',
	},
	'.cm-gutters': {
		backgroundColor: 'hsl(var(--sidebar-background))',
		borderRight: '1px solid hsl(var(--border))',
		color: 'hsl(var(--muted-foreground))',
		zIndex: 5,
	},
	'.cm-gutter': {
		backgroundColor: 'hsl(var(--sidebar-background))',
	},
	'.cm-lineNumbers .cm-gutterElement': {
		padding: '0 0.625rem',
		minWidth: '3.5rem',
	},
	'.cm-activeLine, .cm-activeLineGutter': {
		backgroundColor: 'transparent',
	},
	'.cm-selectionBackground': {
		backgroundColor: 'hsl(var(--primary) / 0.16) !important',
	},
	'.cm-line.cm-line-primary': {
		backgroundColor: 'rgb(59 130 246 / 0.11)',
		boxShadow: 'inset 3px 0 0 rgb(59 130 246 / 0.9)',
	},
	'.dark & .cm-line.cm-line-primary': {
		backgroundColor: 'rgb(96 165 250 / 0.13)',
		boxShadow: 'inset 3px 0 0 rgb(96 165 250 / 0.95)',
	},
	'.cm-line.cm-line-add': {
		backgroundColor: 'rgb(16 185 129 / 0.12)',
		boxShadow: 'inset 3px 0 0 rgb(16 185 129 / 0.9)',
	},
	'.cm-line.cm-line-remove': {
		backgroundColor: 'rgb(239 68 68 / 0.11)',
		boxShadow: 'inset 3px 0 0 rgb(239 68 68 / 0.85)',
	},
});

const syntaxTheme = HighlightStyle.define([
	{ tag: tags.keyword, color: 'var(--otto-cm-keyword)' },
	{
		tag: [tags.name, tags.deleted, tags.character],
		color: 'var(--otto-cm-name)',
	},
	{
		tag: [tags.propertyName, tags.attributeName],
		color: 'var(--otto-cm-property)',
	},
	{
		tag: [tags.function(tags.variableName), tags.labelName],
		color: 'var(--otto-cm-function)',
	},
	{
		tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)],
		color: 'var(--otto-cm-constant)',
	},
	{
		tag: [tags.definition(tags.name), tags.separator],
		color: 'var(--otto-cm-definition)',
	},
	{
		tag: [
			tags.className,
			tags.number,
			tags.changed,
			tags.annotation,
			tags.modifier,
		],
		color: 'var(--otto-cm-number)',
	},
	{
		tag: [tags.typeName, tags.self, tags.namespace],
		color: 'var(--otto-cm-type)',
	},
	{
		tag: [tags.operator, tags.operatorKeyword],
		color: 'var(--otto-cm-operator)',
	},
	{
		tag: [tags.url, tags.escape, tags.regexp, tags.link],
		color: 'var(--otto-cm-string)',
	},
	{
		tag: [tags.meta, tags.comment],
		color: 'var(--otto-cm-comment)',
		fontStyle: 'italic',
	},
	{ tag: tags.strong, fontWeight: 'bold' },
	{ tag: tags.emphasis, fontStyle: 'italic' },
	{ tag: tags.strikethrough, textDecoration: 'line-through' },
	{ tag: tags.link, textDecoration: 'underline' },
	{ tag: tags.heading, fontWeight: 'bold', color: 'var(--otto-cm-property)' },
	{
		tag: [tags.atom, tags.bool, tags.special(tags.variableName)],
		color: 'var(--otto-cm-constant)',
	},
	{
		tag: [tags.processingInstruction, tags.string, tags.inserted],
		color: 'var(--otto-cm-string)',
	},
	{ tag: tags.invalid, color: 'var(--otto-cm-invalid)' },
]);

function lineDecorationsExtension(
	highlightedLines?: Set<number>,
	highlightTone: CodeMirrorLineTone = 'primary',
	lineTones?: Map<number, CodeMirrorLineTone>,
	lineToneRanges?: readonly CodeMirrorLineToneRange[],
): Extension {
	return EditorView.decorations.compute(['doc'], (state): DecorationSet => {
		const sortedRanges = lineToneRanges?.length
			? [...lineToneRanges]
					.filter((range) => range.to > 0 && range.from <= state.doc.lines)
					.sort((left, right) => left.from - right.from)
			: [];
		const sortedToneLines = lineTones?.size
			? [...lineTones.entries()]
					.filter(([line]) => line > 0 && line <= state.doc.lines)
					.sort((left, right) => left[0] - right[0])
			: [];
		const sortedHighlightedLines = highlightedLines?.size
			? [...highlightedLines]
					.filter((line) => line > 0 && line <= state.doc.lines)
					.sort((left, right) => left - right)
			: [];
		let toneIndex = 0;
		let highlightIndex = 0;
		let rangeIndex = 0;

		const builder = new RangeSetBuilder<Decoration>();
		for (let line = 1; line <= state.doc.lines; line += 1) {
			while (sortedToneLines[toneIndex]?.[0] < line) toneIndex += 1;
			while (sortedHighlightedLines[highlightIndex] < line) highlightIndex += 1;
			while (sortedRanges[rangeIndex]?.to < line) rangeIndex += 1;
			const range = sortedRanges[rangeIndex];
			const rangeTone =
				range && line >= range.from && line <= range.to
					? range.tone
					: undefined;
			const tone =
				sortedToneLines[toneIndex]?.[0] === line
					? sortedToneLines[toneIndex]?.[1]
					: (rangeTone ??
						(sortedHighlightedLines[highlightIndex] === line
							? highlightTone
							: undefined));
			if (!tone) continue;
			const position = state.doc.line(line).from;
			builder.add(
				position,
				position,
				Decoration.line({ class: `cm-line-${tone}` }),
			);
			if (
				toneIndex < sortedToneLines.length &&
				sortedToneLines[toneIndex]?.[0] === line
			) {
				toneIndex += 1;
			}
		}
		return builder.finish();
	});
}

function getLanguageExtension(
	path?: string,
	disableMarkdownSyntax = false,
): Extension {
	const ext = path?.split('.').pop()?.toLowerCase() ?? '';
	switch (ext) {
		case 'js':
		case 'jsx':
			return javascript({ jsx: true });
		case 'ts':
			return javascript({ typescript: true });
		case 'tsx':
			return javascript({ jsx: true, typescript: true });
		case 'diff':
		case 'patch':
			return StreamLanguage.define(diff);
		case 'json':
			return json();
		case 'go':
			return StreamLanguage.define(go);
		case 'py':
			return python();
		case 'rb':
			return StreamLanguage.define(ruby);
		case 'rs':
			return StreamLanguage.define(rust);
		case 'html':
		case 'htm':
			return html();
		case 'css':
		case 'scss':
			return css();
		case 'md':
		case 'markdown':
		case 'mdx':
			if (disableMarkdownSyntax) return [];
			return markdown();
		case 'sql':
			return sql();
		case 'xml':
			return xml();
		case 'yaml':
		case 'yml':
			return yaml();
		case 'sh':
		case 'bash':
		case 'zsh':
			return StreamLanguage.define(shell);
		case 'toml':
			return StreamLanguage.define(toml);
		default:
			return [];
	}
}

function lineNumbersExtension(
	lineNumberFormatter?: CodeMirrorLineNumberFormatter,
): Extension {
	if (!lineNumberFormatter) return lineNumbers();
	return lineNumbers({ formatNumber: lineNumberFormatter });
}

function getIncrementalContentChange(
	previous: string,
	next: string,
): { from: number; to: number; insert: string } | null {
	if (previous === next) return null;
	if (next.startsWith(previous)) {
		return {
			from: previous.length,
			to: previous.length,
			insert: next.slice(previous.length),
		};
	}

	let prefixLength = 0;
	const maxPrefixLength = Math.min(previous.length, next.length);
	while (
		prefixLength < maxPrefixLength &&
		previous.charCodeAt(prefixLength) === next.charCodeAt(prefixLength)
	) {
		prefixLength += 1;
	}

	let previousSuffix = previous.length;
	let nextSuffix = next.length;
	while (
		previousSuffix > prefixLength &&
		nextSuffix > prefixLength &&
		previous.charCodeAt(previousSuffix - 1) === next.charCodeAt(nextSuffix - 1)
	) {
		previousSuffix -= 1;
		nextSuffix -= 1;
	}

	const removedLength = previousSuffix - prefixLength;
	const insertedLength = nextSuffix - prefixLength;
	if (removedLength + insertedLength > SMALL_CHANGE_MAX_CHARS) return null;

	return {
		from: prefixLength,
		to: previousSuffix,
		insert: next.slice(prefixLength, nextSuffix),
	};
}

function getTextSelection(view: EditorView): CodeMirrorTextSelection | null {
	const { state } = view;
	const range = state.selection.main;
	if (range.empty) return null;

	const from = Math.min(range.from, range.to);
	const to = Math.max(range.from, range.to);
	const startLine = state.doc.lineAt(from);
	const endLine = state.doc.lineAt(to);
	const text = state.doc.sliceString(from, to);
	if (!text) return null;
	const fromCoords = view.coordsAtPos(from);
	const toCoords = view.coordsAtPos(to);
	const anchorRect =
		fromCoords || toCoords
			? {
					top: Math.min(
						fromCoords?.top ?? toCoords?.top ?? 0,
						toCoords?.top ?? fromCoords?.top ?? 0,
					),
					left: Math.min(
						fromCoords?.left ?? toCoords?.left ?? 0,
						toCoords?.left ?? fromCoords?.left ?? 0,
					),
					bottom: Math.max(
						fromCoords?.bottom ?? toCoords?.bottom ?? 0,
						toCoords?.bottom ?? fromCoords?.bottom ?? 0,
					),
					right: Math.max(
						fromCoords?.right ?? toCoords?.right ?? 0,
						toCoords?.right ?? fromCoords?.right ?? 0,
					),
				}
			: undefined;

	return {
		from,
		to,
		startLine: startLine.number,
		startColumn: from - startLine.from + 1,
		endLine: endLine.number,
		endColumn: to - endLine.from + 1,
		text,
		anchorRect,
	};
}

export function CodeMirrorViewer({
	content,
	path,
	className,
	highlightedLines,
	highlightTone = 'primary',
	lineTones,
	lineToneRanges,
	scrollToLine,
	scrollToEndSignal,
	disableMarkdownSyntax = false,
	lineNumberFormatter,
	onSelectionChange,
}: CodeMirrorViewerProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const contentRef = useRef(content);
	const onSelectionChangeRef = useRef(onSelectionChange);
	const lineNumbersCompartmentRef = useRef(new Compartment());
	const languageCompartmentRef = useRef(new Compartment());
	const decorationsCompartmentRef = useRef(new Compartment());
	const selectionCompartmentRef = useRef(new Compartment());
	const lineNumbersExtensionRef = useRef<Extension>([]);
	const languageExtensionRef = useRef<Extension>([]);
	const decorationsExtensionRef = useRef<Extension>([]);
	const selectionExtensionRef = useRef<Extension>([]);

	useEffect(() => {
		onSelectionChangeRef.current = onSelectionChange;
	}, [onSelectionChange]);

	const lineNumberExtension = useMemo(
		() => lineNumbersExtension(lineNumberFormatter),
		[lineNumberFormatter],
	);
	const languageExtension = useMemo(
		() =>
			getLanguageExtension(
				path,
				disableMarkdownSyntax || content.length > LARGE_SYNTAX_DISABLE_CHARS,
			),
		[path, disableMarkdownSyntax, content.length],
	);
	const decorationsExtension = useMemo(
		() =>
			lineDecorationsExtension(
				highlightedLines,
				highlightTone,
				lineTones,
				lineToneRanges,
			),
		[highlightedLines, highlightTone, lineTones, lineToneRanges],
	);
	const selectionExtension = useMemo(
		() =>
			EditorView.updateListener.of((update) => {
				if (!update.selectionSet && !update.docChanged) return;
				onSelectionChangeRef.current?.(getTextSelection(update.view));
			}),
		[],
	);
	lineNumbersExtensionRef.current = lineNumberExtension;
	languageExtensionRef.current = languageExtension;
	decorationsExtensionRef.current = decorationsExtension;
	selectionExtensionRef.current = selectionExtension;
	const createEditorState = useCallback(
		(doc: string) =>
			EditorState.create({
				doc,
				extensions: [
					lineNumbersCompartmentRef.current.of(lineNumberExtension),
					EditorState.readOnly.of(true),
					EditorView.editable.of(false),
					viewerTheme,
					syntaxHighlighting(syntaxTheme, { fallback: true }),
					languageCompartmentRef.current.of(languageExtension),
					decorationsCompartmentRef.current.of(decorationsExtension),
					selectionCompartmentRef.current.of(selectionExtension),
				],
			}),
		[
			lineNumberExtension,
			languageExtension,
			decorationsExtension,
			selectionExtension,
		],
	);
	const scrollToRequestedPosition = useCallback(
		(view: EditorView, options: { line?: number; end?: boolean }) => {
			try {
				if (options.end) {
					view.dispatch({
						effects: EditorView.scrollIntoView(view.state.doc.length, {
							y: 'end',
						}),
					});
					return;
				}

				if (!options.line || options.line < 1) return;
				const line = view.state.doc.line(
					Math.min(options.line, view.state.doc.lines),
				);
				view.dispatch({
					effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
				});
			} catch {
				view.setState(createEditorState(contentRef.current));
			}
		},
		[createEditorState],
	);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		if (viewRef.current) return;

		const view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: contentRef.current,
				extensions: [
					lineNumbersCompartmentRef.current.of(lineNumbersExtensionRef.current),
					EditorState.readOnly.of(true),
					EditorView.editable.of(false),
					viewerTheme,
					syntaxHighlighting(syntaxTheme, { fallback: true }),
					languageCompartmentRef.current.of(languageExtensionRef.current),
					decorationsCompartmentRef.current.of(decorationsExtensionRef.current),
					selectionCompartmentRef.current.of(selectionExtensionRef.current),
				],
			}),
		});
		viewRef.current = view;

		return () => {
			view.destroy();
			viewRef.current = null;
		};
	}, []);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		try {
			view.dispatch({
				effects:
					lineNumbersCompartmentRef.current.reconfigure(lineNumberExtension),
			});
		} catch {
			view.setState(createEditorState(contentRef.current));
		}
	}, [lineNumberExtension, createEditorState]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		try {
			view.dispatch({
				effects: languageCompartmentRef.current.reconfigure(languageExtension),
			});
		} catch {
			view.setState(createEditorState(contentRef.current));
		}
	}, [languageExtension, createEditorState]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		try {
			view.dispatch({
				effects:
					decorationsCompartmentRef.current.reconfigure(decorationsExtension),
			});
		} catch {
			view.setState(createEditorState(contentRef.current));
		}
	}, [decorationsExtension, createEditorState]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		if (
			contentRef.current === content &&
			view.state.doc.length === content.length
		) {
			return;
		}

		try {
			const change = getIncrementalContentChange(contentRef.current, content);
			view.dispatch({
				changes: change ?? {
					from: 0,
					to: view.state.doc.length,
					insert: content,
				},
			});
		} catch {
			view.setState(createEditorState(content));
		}
		contentRef.current = content;

		scrollToRequestedPosition(view, {
			end: scrollToEndSignal !== undefined,
			line: scrollToLine,
		});
	}, [
		content,
		scrollToLine,
		scrollToEndSignal,
		scrollToRequestedPosition,
		createEditorState,
	]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view || !scrollToLine || scrollToLine < 1) return;
		scrollToRequestedPosition(view, { line: scrollToLine });
	}, [scrollToLine, scrollToRequestedPosition]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view || scrollToEndSignal === undefined) return;
		scrollToRequestedPosition(view, { end: true });
	}, [scrollToEndSignal, scrollToRequestedPosition]);

	return <div ref={hostRef} className={className ?? 'h-full w-full'} />;
}
