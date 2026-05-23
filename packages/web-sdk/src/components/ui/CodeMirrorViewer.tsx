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

export type CodeMirrorLineTone = 'add' | 'remove' | 'primary';

interface CodeMirrorViewerProps {
	content: string;
	path?: string;
	className?: string;
	highlightedLines?: Set<number>;
	highlightTone?: CodeMirrorLineTone;
	lineTones?: Map<number, CodeMirrorLineTone>;
	scrollToLine?: number;
	scrollToEndSignal?: string | number;
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
): Extension {
	return EditorView.decorations.compute([], (state): DecorationSet => {
		const decorations: Array<{ line: number; tone: CodeMirrorLineTone }> = [];
		for (const [line, tone] of lineTones ?? []) {
			if (line > 0) decorations.push({ line, tone });
		}
		for (const line of highlightedLines ?? []) {
			if (line > 0 && !lineTones?.has(line)) {
				decorations.push({ line, tone: highlightTone });
			}
		}
		decorations.sort((a, b) => a.line - b.line);

		const builder = new RangeSetBuilder<Decoration>();
		for (const { line, tone } of decorations) {
			if (line > state.doc.lines) continue;
			builder.add(
				state.doc.line(line).from,
				state.doc.line(line).from,
				Decoration.line({ class: `cm-line-${tone}` }),
			);
		}
		return builder.finish();
	});
}

function getLanguageExtension(path?: string): Extension {
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

export function CodeMirrorViewer({
	content,
	path,
	className,
	highlightedLines,
	highlightTone = 'primary',
	lineTones,
	scrollToLine,
	scrollToEndSignal,
}: CodeMirrorViewerProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const contentRef = useRef(content);
	const languageCompartmentRef = useRef(new Compartment());
	const decorationsCompartmentRef = useRef(new Compartment());
	const languageExtensionRef = useRef<Extension>([]);
	const decorationsExtensionRef = useRef<Extension>([]);

	const languageExtension = useMemo(() => getLanguageExtension(path), [path]);
	const decorationsExtension = useMemo(
		() => lineDecorationsExtension(highlightedLines, highlightTone, lineTones),
		[highlightedLines, highlightTone, lineTones],
	);
	languageExtensionRef.current = languageExtension;
	decorationsExtensionRef.current = decorationsExtension;
	const createEditorState = useCallback(
		(doc: string) =>
			EditorState.create({
				doc,
				extensions: [
					lineNumbers(),
					EditorState.readOnly.of(true),
					EditorView.editable.of(false),
					viewerTheme,
					syntaxHighlighting(syntaxTheme, { fallback: true }),
					languageCompartmentRef.current.of(languageExtension),
					decorationsCompartmentRef.current.of(decorationsExtension),
				],
			}),
		[languageExtension, decorationsExtension],
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
					lineNumbers(),
					EditorState.readOnly.of(true),
					EditorView.editable.of(false),
					viewerTheme,
					syntaxHighlighting(syntaxTheme, { fallback: true }),
					languageCompartmentRef.current.of(languageExtensionRef.current),
					decorationsCompartmentRef.current.of(decorationsExtensionRef.current),
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
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: content },
			});
		} catch {
			view.setState(createEditorState(content));
		}
		contentRef.current = content;
	}, [content, createEditorState]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view || !scrollToLine || scrollToLine < 1) return;
		const line = view.state.doc.line(
			Math.min(scrollToLine, view.state.doc.lines),
		);
		try {
			view.dispatch({
				effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
			});
		} catch {
			view.setState(createEditorState(contentRef.current));
		}
	}, [scrollToLine, createEditorState]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view || scrollToEndSignal === undefined) return;
		try {
			view.dispatch({
				effects: EditorView.scrollIntoView(view.state.doc.length, { y: 'end' }),
			});
		} catch {
			view.setState(createEditorState(contentRef.current));
		}
	}, [scrollToEndSignal, createEditorState]);

	return <div ref={hostRef} className={className ?? 'h-full w-full'} />;
}
