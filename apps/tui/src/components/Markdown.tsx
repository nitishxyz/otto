import { Fragment, memo, useMemo } from 'react';
import { useTheme } from '../theme.ts';
import type { ThemeColors, ThemeSyntax } from '../theme/types.ts';

/**
 * Lightweight deterministic markdown renderer for the TUI.
 *
 * OpenTUI's MarkdownRenderable conceals syntax markers via async tree-sitter
 * highlighting, which is unreliable in bundled builds (raw `##`/`**` flashes
 * or sticks). This renderer parses common block + inline markdown
 * synchronously and renders themed opentui text primitives.
 */

type InlineNode =
	| { kind: 'text'; text: string }
	| { kind: 'bold'; text: string }
	| { kind: 'italic'; text: string }
	| { kind: 'bolditalic'; text: string }
	| { kind: 'code'; text: string }
	| { kind: 'strike'; text: string }
	| { kind: 'link'; text: string; url: string };

const INLINE_RE =
	/(\*\*\*[^*\n]+?\*\*\*|___[^_\n]+?___|\*\*[^*\n]+?\*\*|__[^_\n]+?__|\*[^*\n]+?\*|_[^_\n]+?_|`[^`\n]+?`|~~[^~\n]+?~~|\[[^\]\n]+?\]\([^)\n]+?\))/;

function parseInline(src: string): InlineNode[] {
	const nodes: InlineNode[] = [];
	let rest = src;
	while (rest.length > 0) {
		const match = INLINE_RE.exec(rest);
		if (!match || match.index === undefined) {
			nodes.push({ kind: 'text', text: rest });
			break;
		}
		if (match.index > 0) {
			nodes.push({ kind: 'text', text: rest.slice(0, match.index) });
		}
		const token = match[0];
		if (token.startsWith('***') || token.startsWith('___')) {
			nodes.push({ kind: 'bolditalic', text: token.slice(3, -3) });
		} else if (token.startsWith('**') || token.startsWith('__')) {
			nodes.push({ kind: 'bold', text: token.slice(2, -2) });
		} else if (token.startsWith('`')) {
			nodes.push({ kind: 'code', text: token.slice(1, -1) });
		} else if (token.startsWith('~~')) {
			nodes.push({ kind: 'strike', text: token.slice(2, -2) });
		} else if (token.startsWith('[')) {
			const close = token.indexOf('](');
			nodes.push({
				kind: 'link',
				text: token.slice(1, close),
				url: token.slice(close + 2, -1),
			});
		} else {
			nodes.push({ kind: 'italic', text: token.slice(1, -1) });
		}
		rest = rest.slice(match.index + token.length);
	}
	return nodes;
}

function InlineSpans({
	nodes,
	colors,
	syntax,
	baseFg,
}: {
	nodes: InlineNode[];
	colors: ThemeColors;
	syntax: ThemeSyntax;
	baseFg: string;
}) {
	return (
		<>
			{nodes.map((node, i) => {
				const key = `${i}-${node.kind}`;
				switch (node.kind) {
					case 'bold':
						return (
							<span key={key} fg={syntax.markupBold}>
								<b>{node.text}</b>
							</span>
						);
					case 'italic':
						return (
							<span key={key} fg={baseFg}>
								<i>{node.text}</i>
							</span>
						);
					case 'bolditalic':
						return (
							<span key={key} fg={syntax.markupBold}>
								<b>
									<i>{node.text}</i>
								</b>
							</span>
						);
					case 'code':
						return (
							<span key={key} fg={syntax.markupRaw} bg={colors.bgHighlight}>
								{node.text}
							</span>
						);
					case 'strike':
						return (
							<span key={key} fg={colors.fgDimmed}>
								{node.text}
							</span>
						);
					case 'link':
						return (
							<Fragment key={key}>
								<span fg={syntax.markupLink}>
									<u>{node.text}</u>
								</span>
								<span fg={colors.fgDimmed}> ({node.url})</span>
							</Fragment>
						);
					default:
						return (
							<span key={key} fg={baseFg}>
								{node.text}
							</span>
						);
				}
			})}
		</>
	);
}

type Block =
	| { kind: 'heading'; level: number; text: string }
	| { kind: 'paragraph'; text: string }
	| { kind: 'code'; lang: string; lines: string[] }
	| { kind: 'quote'; lines: string[] }
	| { kind: 'hr' }
	| {
			kind: 'list';
			items: { indent: number; marker: string; text: string }[];
	  }
	| { kind: 'table'; lines: string[] };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE_RE = /^\s{0,3}(```+|~~~+)\s*(\S*)\s*$/;
const LIST_RE = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const CHECKBOX_RE = /^\[([ xX])\]\s+(.*)$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

function parseBlocks(content: string): Block[] {
	const lines = content.replace(/\r\n/g, '\n').split('\n');
	const blocks: Block[] = [];
	let paragraph: string[] = [];

	const flushParagraph = () => {
		if (paragraph.length) {
			blocks.push({ kind: 'paragraph', text: paragraph.join(' ').trim() });
			paragraph = [];
		}
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		const fence = FENCE_RE.exec(line);
		if (fence) {
			flushParagraph();
			const codeLines: string[] = [];
			const marker = fence[1][0];
			i++;
			while (i < lines.length) {
				const inner = FENCE_RE.exec(lines[i]);
				if (inner && inner[1][0] === marker && !inner[2]) break;
				codeLines.push(lines[i]);
				i++;
			}
			blocks.push({ kind: 'code', lang: fence[2] ?? '', lines: codeLines });
			continue;
		}

		if (!line.trim()) {
			flushParagraph();
			continue;
		}

		const heading = HEADING_RE.exec(line);
		if (heading) {
			flushParagraph();
			blocks.push({
				kind: 'heading',
				level: heading[1].length,
				text: heading[2].trim(),
			});
			continue;
		}

		if (HR_RE.test(line)) {
			flushParagraph();
			blocks.push({ kind: 'hr' });
			continue;
		}

		const quote = QUOTE_RE.exec(line);
		if (quote) {
			flushParagraph();
			const quoteLines: string[] = [quote[1]];
			while (i + 1 < lines.length) {
				const next = QUOTE_RE.exec(lines[i + 1]);
				if (!next) break;
				quoteLines.push(next[1]);
				i++;
			}
			blocks.push({ kind: 'quote', lines: quoteLines });
			continue;
		}

		const list = LIST_RE.exec(line);
		if (list) {
			flushParagraph();
			const items: { indent: number; marker: string; text: string }[] = [];
			let j = i;
			while (j < lines.length) {
				const m = LIST_RE.exec(lines[j]);
				if (!m) {
					// continuation line of previous item (indented, non-empty)
					if (items.length && lines[j].trim() && /^\s{2,}/.test(lines[j])) {
						items[items.length - 1].text += ` ${lines[j].trim()}`;
						j++;
						continue;
					}
					break;
				}
				const indent = Math.floor(m[1].length / 2);
				const rawMarker = m[2];
				const marker = /\d/.test(rawMarker[0]) ? rawMarker : '•';
				items.push({ indent, marker, text: m[3] });
				j++;
			}
			i = j - 1;
			blocks.push({ kind: 'list', items });
			continue;
		}

		if (TABLE_ROW_RE.test(line)) {
			flushParagraph();
			const tableLines: string[] = [line];
			while (i + 1 < lines.length && TABLE_ROW_RE.test(lines[i + 1])) {
				tableLines.push(lines[i + 1]);
				i++;
			}
			blocks.push({ kind: 'table', lines: tableLines });
			continue;
		}

		paragraph.push(line.trim());
	}
	flushParagraph();
	return blocks;
}

function headingColor(level: number, syntax: ThemeSyntax): string {
	if (level === 1) return syntax.markupHeading1;
	if (level === 2) return syntax.markupHeading2;
	return syntax.markupHeading;
}

const BlockView = memo(function BlockView({ block }: { block: Block }) {
	const { colors, theme } = useTheme();
	const syntax = theme.syntax;

	switch (block.kind) {
		case 'heading': {
			const nodes = parseInline(block.text);
			return (
				<text wrapMode="word" fg={headingColor(block.level, syntax)}>
					<b>
						{block.level >= 3 ? (
							<span fg={colors.fgDimmed}>{'›'.repeat(block.level - 2)} </span>
						) : null}
						<InlineSpans
							nodes={nodes}
							colors={colors}
							syntax={syntax}
							baseFg={headingColor(block.level, syntax)}
						/>
					</b>
				</text>
			);
		}
		case 'paragraph': {
			const nodes = parseInline(block.text);
			return (
				<text wrapMode="word" fg={colors.fg}>
					<InlineSpans
						nodes={nodes}
						colors={colors}
						syntax={syntax}
						baseFg={colors.fg}
					/>
				</text>
			);
		}
		case 'code':
			return (
				<box
					style={{
						flexDirection: 'column',
						width: '100%',
						backgroundColor: colors.bgSubtle,
						paddingLeft: 1,
						paddingRight: 1,
					}}
				>
					{block.lang ? (
						<text wrapMode="none" fg={colors.fgDimmed}>
							{block.lang}
						</text>
					) : null}
					{block.lines.map((line, i) => (
						<text
							key={`${i}-${line.slice(0, 16)}`}
							wrapMode="none"
							fg={syntax.markupRawBlock}
						>
							{line || ' '}
						</text>
					))}
				</box>
			);
		case 'quote':
			return (
				<box style={{ flexDirection: 'column', width: '100%' }}>
					{block.lines.map((line, i) => (
						<box
							key={`${i}-${line.slice(0, 16)}`}
							style={{ flexDirection: 'row', width: '100%' }}
						>
							<text style={{ flexShrink: 0 }} fg={colors.fgDimmed}>
								▎
							</text>
							<text wrapMode="word" fg={syntax.markupQuote}>
								<i>
									<InlineSpans
										nodes={parseInline(line)}
										colors={colors}
										syntax={syntax}
										baseFg={syntax.markupQuote}
									/>
								</i>
							</text>
						</box>
					))}
				</box>
			);
		case 'hr':
			return <text fg={colors.borderSubtle}>{'─'.repeat(36)}</text>;
		case 'list':
			return (
				<box style={{ flexDirection: 'column', width: '100%' }}>
					{block.items.map((item, i) => {
						let text = item.text;
						let marker = item.marker;
						let markerFg = syntax.markupList;
						const checkbox = CHECKBOX_RE.exec(text);
						if (checkbox) {
							const checked = checkbox[1] !== ' ';
							marker = checked ? '✓' : '○';
							markerFg = checked ? colors.green : colors.fgDark;
							text = checkbox[2];
						}
						return (
							<box
								key={`${i}-${text.slice(0, 16)}`}
								style={{
									flexDirection: 'row',
									width: '100%',
									paddingLeft: item.indent * 2,
								}}
							>
								<text style={{ flexShrink: 0 }} fg={markerFg}>
									{marker}{' '}
								</text>
								<text wrapMode="word" fg={colors.fg}>
									<InlineSpans
										nodes={parseInline(text)}
										colors={colors}
										syntax={syntax}
										baseFg={colors.fg}
									/>
								</text>
							</box>
						);
					})}
				</box>
			);
		case 'table':
			return (
				<box style={{ flexDirection: 'column', width: '100%' }}>
					{block.lines.map((line, i) => (
						<text
							key={`${i}-${line.slice(0, 16)}`}
							wrapMode="none"
							fg={i === 0 ? colors.fgBright : colors.fgMuted}
						>
							{line.trim()}
						</text>
					))}
				</box>
			);
		default:
			return null;
	}
});

export const MarkdownView = memo(function MarkdownView({
	content,
}: {
	content: string;
}) {
	const blocks = useMemo(() => parseBlocks(content), [content]);

	return (
		<box style={{ flexDirection: 'column', width: '100%', gap: 1 }}>
			{blocks.map((block, i) => (
				<BlockView key={`${i}-${block.kind}`} block={block} />
			))}
		</box>
	);
});
