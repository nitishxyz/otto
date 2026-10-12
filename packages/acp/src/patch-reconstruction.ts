export function normalizePatchPath(filePath: string): string {
	return filePath.replace(/\\/g, '/').replace(/^[ab]\//, '');
}

export function parsePatchFileDirective(line: string): string | undefined {
	return line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/)?.[1]?.trim();
}

export function parseUnifiedFileHeader(line: string): string | undefined {
	const filePath = line.match(/^(?:---|\+\+\+) (?:[ab]\/)?(.+)$/)?.[1]?.trim();
	return filePath && filePath !== '/dev/null' ? filePath : undefined;
}

export function reversePatchForFile(
	patch: string,
	filePath: string,
	newText: string,
): string | null {
	const hunks: Array<{
		newStart: number;
		newLines: string[];
		oldLines: string[];
	}> = [];
	let inTargetFile = false;
	let currentHunk: (typeof hunks)[number] | undefined;
	for (const line of patch.split('\n')) {
		const header =
			parsePatchFileDirective(line) ?? parseUnifiedFileHeader(line);
		if (header) {
			inTargetFile =
				normalizePatchPath(header) === normalizePatchPath(filePath);
			currentHunk = undefined;
			continue;
		}
		if (!inTargetFile) continue;
		const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
		if (match) {
			currentHunk = { newStart: Number(match[2]), newLines: [], oldLines: [] };
			hunks.push(currentHunk);
			continue;
		}
		if (!currentHunk) continue;
		if (line.startsWith('*** ')) {
			currentHunk = undefined;
			continue;
		}
		if (line[0] === ' ' || line[0] === '-')
			currentHunk.oldLines.push(line.slice(1));
		if (line[0] === ' ' || line[0] === '+')
			currentHunk.newLines.push(line.slice(1));
	}
	if (!hunks.length) return null;
	const oldLines = newText.length ? newText.split('\n') : [];
	for (const hunk of hunks.reverse()) {
		const index = Math.max(0, hunk.newStart - 1);
		if (hunk.newLines.some((line, offset) => oldLines[index + offset] !== line))
			return null;
		oldLines.splice(index, hunk.newLines.length, ...hunk.oldLines);
	}
	return oldLines.join('\n');
}
