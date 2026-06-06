export interface CodeMirrorTextSelection {
	from: number;
	to: number;
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
	text: string;
	anchorRect?: {
		top: number;
		left: number;
		bottom: number;
		right: number;
	};
}

export interface FileSelectionContext {
	type: 'file-selection';
	id: string;
	filePath: string;
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
	text: string;
	label: string;
	source: 'viewer';
	revision?: string;
}

function escapeXmlAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function escapeXmlText(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

export function formatFileSelectionLabel(
	filePath: string,
	startLine: number,
	endLine: number,
): string {
	return startLine === endLine
		? `${filePath}:${startLine}`
		: `${filePath}:${startLine}-${endLine}`;
}

export function createFileSelectionContext(
	filePath: string,
	selection: CodeMirrorTextSelection,
): FileSelectionContext {
	const label = formatFileSelectionLabel(
		filePath,
		selection.startLine,
		selection.endLine,
	);

	return {
		type: 'file-selection',
		id: `${filePath}:${selection.startLine}:${selection.startColumn}-${selection.endLine}:${selection.endColumn}`,
		filePath,
		startLine: selection.startLine,
		startColumn: selection.startColumn,
		endLine: selection.endLine,
		endColumn: selection.endColumn,
		text: selection.text,
		label,
		source: 'viewer',
	};
}

export function formatFileSelectionForMessage(
	selection: FileSelectionContext,
): string {
	return `<file-selection path="${escapeXmlAttribute(selection.filePath)}" startLine="${selection.startLine}" startColumn="${selection.startColumn}" endLine="${selection.endLine}" endColumn="${selection.endColumn}">\n${escapeXmlText(selection.text)}\n</file-selection>`;
}

export function formatFileSelectionsForMessage(
	selections: FileSelectionContext[],
): string {
	return selections.map(formatFileSelectionForMessage).join('\n\n');
}

export interface ParsedFileSelectionTag {
	id: string;
	filePath: string;
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
	text: string;
	label: string;
}

export interface ParseFileSelectionsResult {
	fileSelections: ParsedFileSelectionTag[];
	cleanContent: string;
}

const FILE_SELECTION_REGEX =
	/<file-selection\s+path="([^"]+)"\s+startLine="(\d+)"\s+startColumn="(\d+)"\s+endLine="(\d+)"\s+endColumn="(\d+)"[^>]*>([\s\S]*?)<\/file-selection>/g;

function decodeXmlEntities(value: string): string {
	return value
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, '&');
}

export function parseFileSelections(
	content: string,
): ParseFileSelectionsResult {
	const fileSelections: ParsedFileSelectionTag[] = [];
	let cleanContent = content;

	const regex = new RegExp(FILE_SELECTION_REGEX);
	let match = regex.exec(content);

	while (match !== null) {
		const [fullMatch, path, startLine, startColumn, endLine, endColumn, inner] =
			match;
		const startLineNum = Number(startLine);
		const endLineNum = Number(endLine);
		fileSelections.push({
			id: `${path}:${startLine}:${startColumn}-${endLine}:${endColumn}`,
			filePath: path,
			startLine: startLineNum,
			startColumn: Number(startColumn),
			endLine: endLineNum,
			endColumn: Number(endColumn),
			text: decodeXmlEntities(inner.replace(/^\n+/, '').replace(/\n+$/, '')),
			label: formatFileSelectionLabel(path, startLineNum, endLineNum),
		});
		cleanContent = cleanContent.replace(fullMatch, '');
		match = regex.exec(content);
	}

	cleanContent = cleanContent.trim();

	return { fileSelections, cleanContent };
}
