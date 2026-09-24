export interface DiffPart {
	kind: 'same' | 'added' | 'removed';
	text: string;
}

const MAX_WORDS = 400;
const MIN_SHARED = 0.5;

function words(text: string): string[] {
	return text.split(/(\s+)/).filter((part) => part.length > 0);
}

/**
 * Word-level diff (LCS) between two versions of a memory. Returns `null` when
 * the texts are too long to diff cheaply or mostly rewritten; callers then
 * show the new text as-is.
 */
export function wordDiff(before: string, after: string): DiffPart[] | null {
	const a = words(before);
	const b = words(after);
	if (a.length > MAX_WORDS || b.length > MAX_WORDS) return null;
	const rows = a.length + 1;
	const cols = b.length + 1;
	const table = new Uint16Array(rows * cols);
	for (let i = a.length - 1; i >= 0; i -= 1) {
		for (let j = b.length - 1; j >= 0; j -= 1) {
			table[i * cols + j] =
				a[i] === b[j]
					? table[(i + 1) * cols + j + 1] + 1
					: Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
		}
	}
	const parts: DiffPart[] = [];
	const push = (kind: DiffPart['kind'], text: string) => {
		const last = parts[parts.length - 1];
		if (last && last.kind === kind) last.text += text;
		else parts.push({ kind, text });
	};
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			push('same', a[i]);
			i += 1;
			j += 1;
		} else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
			push('removed', a[i]);
			i += 1;
		} else {
			push('added', b[j]);
			j += 1;
		}
	}
	while (i < a.length) push('removed', a[i++]);
	while (j < b.length) push('added', b[j++]);
	const kept = parts
		.filter((part) => part.kind === 'same')
		.reduce((sum, part) => sum + part.text.trim().length, 0);
	// A rewrite reads better as plain text than as a wall of strikethroughs.
	if (kept < after.trim().length * MIN_SHARED) return null;
	return parts;
}
