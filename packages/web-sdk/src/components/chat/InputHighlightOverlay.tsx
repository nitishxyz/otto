import { memo, useMemo } from 'react';
import { mentionHighlightClasses } from '../../lib/mentionHighlightStyles';

interface InputHighlightOverlayProps {
	value: string;
	agentNames: string[];
	skillNames: string[];
	scrollTop?: number;
	className?: string;
}

type SegmentKind = 'text' | 'agent' | 'file' | 'skill';

interface Segment {
	text: string;
	kind: SegmentKind;
}

const MENTION_TOKEN_REGEX = /(@[^\s@]+|\$[a-z0-9][a-z0-9-]*)/g;
const TRAILING_PUNCTUATION_REGEX = /[.,;:!?)\]}'"`]+$/;
const BOUNDARY_CHARS = new Set([' ', '\t', '\n', '(', '[', '{']);

function classifyToken(
	token: string,
	agentNames: Set<string>,
	skillNames: Set<string>,
): SegmentKind {
	if (token.startsWith('$')) {
		const name = token.slice(1);
		return skillNames.has(name) ? 'skill' : 'text';
	}
	const name = token.slice(1).replace(TRAILING_PUNCTUATION_REGEX, '');
	if (!name) return 'text';
	if (agentNames.has(name)) return 'agent';
	if (skillNames.has(name)) return 'skill';
	if (name.includes('/') || name.includes('.')) return 'file';
	return 'text';
}

function tokenize(
	value: string,
	agentNames: Set<string>,
	skillNames: Set<string>,
): Segment[] {
	const segments: Segment[] = [];
	let lastIndex = 0;

	for (const match of value.matchAll(MENTION_TOKEN_REGEX)) {
		const index = match.index ?? 0;
		const token = match[0];
		const prevChar = index > 0 ? value[index - 1] : '';
		const hasBoundary = index === 0 || BOUNDARY_CHARS.has(prevChar);
		const kind = hasBoundary
			? classifyToken(token, agentNames, skillNames)
			: 'text';

		if (kind === 'text') continue;

		const trailing = token.startsWith('@')
			? (token.slice(1).match(TRAILING_PUNCTUATION_REGEX)?.[0] ?? '')
			: '';
		const highlightText = trailing
			? token.slice(0, token.length - trailing.length)
			: token;

		if (index > lastIndex) {
			segments.push({ text: value.slice(lastIndex, index), kind: 'text' });
		}
		segments.push({ text: highlightText, kind });
		lastIndex = index + highlightText.length;
	}

	if (lastIndex < value.length) {
		segments.push({ text: value.slice(lastIndex), kind: 'text' });
	}

	return segments;
}

/**
 * Renders a transparent-text backdrop behind the chat textarea that paints
 * rounded background highlights underneath @agent, @file, and $skill mentions.
 * Must receive the exact same typography/padding classes as the textarea so
 * the text layout lines up character-for-character.
 */
export const InputHighlightOverlay = memo(function InputHighlightOverlay({
	value,
	agentNames,
	skillNames,
	scrollTop = 0,
	className = '',
}: InputHighlightOverlayProps) {
	const agentSet = useMemo(() => new Set(agentNames), [agentNames]);
	const skillSet = useMemo(() => new Set(skillNames), [skillNames]);

	const segments = useMemo(() => {
		if (!value || (!value.includes('@') && !value.includes('$'))) return null;
		const result = tokenize(value, agentSet, skillSet);
		return result.some((segment) => segment.kind !== 'text') ? result : null;
	}, [value, agentSet, skillSet]);

	if (!segments) return null;

	return (
		<div
			aria-hidden
			data-input-highlight-overlay
			className="absolute inset-0 pointer-events-none overflow-hidden"
		>
			<div
				className={`whitespace-pre-wrap break-words text-transparent select-none ${className}`}
				style={{ transform: `translateY(-${scrollTop}px)` }}
			>
				{segments.map((segment, index) => {
					const key = `${index}-${segment.kind}`;
					if (segment.kind === 'text') {
						return <span key={key}>{segment.text}</span>;
					}
					return (
						<span key={key} className={mentionHighlightClasses[segment.kind]}>
							{segment.text}
						</span>
					);
				})}
				{value.endsWith('\n') ? '\u200b' : null}
			</div>
		</div>
	);
});
