const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
const BARE_HUNK_HEADER_RE = /^@@(?:\s+(.*))?$/;

function formatRange(start: number, count: number): string {
	if (count === 0) return `${start},0`;
	if (count === 1) return String(start);
	return `${start},${count}`;
}

function isHunkBoundary(lines: string[], index: number): boolean {
	const line = lines[index];
	if (line.startsWith('@@') || line.startsWith('diff --git ')) return true;
	if (line.startsWith('*** ')) return true;
	return (
		/^---\s/.test(line) &&
		index + 1 < lines.length &&
		/^\+\+\+\s/.test(lines[index + 1])
	);
}

function countHunkLines(
	lines: string[],
	start: number,
): { end: number; oldLines: number; newLines: number } {
	let oldLines = 0;
	let newLines = 0;
	let end = start;

	for (; end < lines.length && !isHunkBoundary(lines, end); end++) {
		const line = lines[end];
		if (line.startsWith('-')) {
			oldLines++;
		} else if (line.startsWith('+')) {
			newLines++;
		} else if (line.startsWith(' ')) {
			oldLines++;
			newLines++;
		} else if (line === '' && end !== lines.length - 1) {
			// OpenTUI's parser treats non-terminal empty lines as context lines.
			oldLines++;
			newLines++;
		}
	}

	return { end, oldLines, newLines };
}

/**
 * Repairs unified hunk metadata before handing a patch to OpenTUI's strict
 * parser. Tool artifacts can outlive parser fixes, so this also keeps malformed
 * hunks from persisted sessions renderable.
 */
export function normalizeDiffHunks(patch: string): string {
	const lines = patch.replaceAll('\r\n', '\n').split('\n');
	let fallbackOldStart = 1;
	let fallbackNewStart = 1;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const header = line.match(HUNK_HEADER_RE);
		const bareHeader = header ? null : line.match(BARE_HUNK_HEADER_RE);
		if (!header && !bareHeader) continue;

		const counts = countHunkLines(lines, index + 1);
		const oldStart = header ? Number.parseInt(header[1], 10) : fallbackOldStart;
		const newStart = header ? Number.parseInt(header[3], 10) : fallbackNewStart;
		const declaredOldLines = header
			? header[2] === undefined
				? 1
				: Number.parseInt(header[2], 10)
			: undefined;
		const declaredNewLines = header
			? header[4] === undefined
				? 1
				: Number.parseInt(header[4], 10)
			: undefined;
		const suffix = header
			? header[5]
			: bareHeader?.[1]
				? ` ${bareHeader[1]}`
				: '';

		if (
			declaredOldLines !== counts.oldLines ||
			declaredNewLines !== counts.newLines
		) {
			lines[index] =
				`@@ -${formatRange(oldStart, counts.oldLines)} +${formatRange(newStart, counts.newLines)} @@${suffix}`;
		}

		fallbackOldStart = oldStart + counts.oldLines;
		fallbackNewStart = newStart + counts.newLines;
		index = counts.end - 1;
	}

	return lines.join('\n');
}
