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
