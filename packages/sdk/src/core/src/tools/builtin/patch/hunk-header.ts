export function parseHunkHeader(raw: string) {
	const match = raw.match(
		/^@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@(?:\s*(.*))?$/,
	);
	if (match) {
		const [, oldStart, oldCount, newStart, newCount, context] = match;
		return {
			oldStart: Number.parseInt(oldStart, 10),
			oldLines: oldCount ? Number.parseInt(oldCount, 10) : undefined,
			newStart: Number.parseInt(newStart, 10),
			newLines: newCount ? Number.parseInt(newCount, 10) : undefined,
			context: context?.trim() || undefined,
		};
	}
	const context = raw.replace(/^@@/, '').trim();
	return context ? { context } : {};
}
