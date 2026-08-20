import { memo } from 'react';
import {
	OTTO_TUI_GLYPHS,
	OTTO_TUI_WORDMARK_GAPS,
	OTTO_TUI_WORDMARK_WIDTH,
	resolveOttoWordmarkVariant,
	type OttoTuiWordmarkVariant,
} from '../brand/wordmark.ts';
import { useTerminalDimensions } from '../terminal-dimensions.tsx';

export interface OttoWordmarkProps {
	variant?: OttoTuiWordmarkVariant;
}

const WORDMARK_ROWS = [
	{ key: 'ascenders', index: 0 },
	{ key: 'shoulders', index: 1 },
	{ key: 'counters', index: 2 },
	{ key: 'baseline', index: 3 },
] as const;

function WordmarkCell({
	char,
	face,
	cast,
}: {
	char: string;
	face: string;
	cast: string;
}) {
	if (char === '_') {
		return (
			<text fg={face} bg={cast} selectable={false}>
				{' '}
			</text>
		);
	}
	if (char === '^') {
		return (
			<text fg={face} bg={cast} selectable={false}>
				▀
			</text>
		);
	}
	if (char === '~') {
		return (
			<text fg={cast} selectable={false}>
				▀
			</text>
		);
	}
	if (char === ',') {
		return (
			<text fg={cast} selectable={false}>
				▄
			</text>
		);
	}
	return (
		<text fg={face} selectable={false}>
			{char}
		</text>
	);
}

function FullWordmark() {
	return (
		<box flexDirection="column" width={OTTO_TUI_WORDMARK_WIDTH}>
			{WORDMARK_ROWS.map((row) => (
				<box key={row.key} flexDirection="row">
					{OTTO_TUI_GLYPHS.map((glyph, glyphIndex) => (
						<box key={glyph.key} flexDirection="row">
							{Array.from(glyph.lines[row.index].slice(glyph.trimLeft)).map(
								(char, cellIndex) => (
									<WordmarkCell
										key={`${glyph.key}-${row.key}-${cellIndex}`}
										char={char}
										face={glyph.face}
										cast={glyph.cast}
									/>
								),
							)}
							{(OTTO_TUI_WORDMARK_GAPS[glyphIndex] ?? 0) > 0 && (
								<text selectable={false}>
									{' '.repeat(OTTO_TUI_WORDMARK_GAPS[glyphIndex] ?? 0)}
								</text>
							)}
						</box>
					))}
				</box>
			))}
		</box>
	);
}

function CompactWordmark() {
	return (
		<box flexDirection="row">
			<text fg="#4865cc" selectable={false}>
				<b>o</b>
			</text>
			<text fg="#c9403a" selectable={false}>
				<b>tt</b>
			</text>
			<text fg="#62ad8b" selectable={false}>
				<b>o</b>
			</text>
		</box>
	);
}

/** Terminal-cell adaptation of the multicolor NeoPop Otto wordmark. */
export const OttoWordmark = memo(function OttoWordmark({
	variant = 'auto',
}: OttoWordmarkProps) {
	const { width } = useTerminalDimensions();
	const resolved = resolveOttoWordmarkVariant(width, variant);

	return resolved === 'full' ? <FullWordmark /> : <CompactWordmark />;
});
