/**
 * Parsing helpers for live tool-call argument streams. Tool args arrive as
 * partial JSON text on the `input` channel; these extract displayable
 * content, mirroring the web UI's ActionToolBox logic.
 */

const LIVE_CONTENT_PREVIEW_CHARS = 8000;

const TOOL_NAME_ALIASES: Record<string, string> = {
	bash: 'shell',
	applypatch: 'apply_patch',
	copyinto: 'copy_into',
};

export function normalizeStreamToolName(name: string | null): string {
	const lower = (name || '').toLowerCase();
	return TOOL_NAME_ALIASES[lower] ?? lower;
}

function decodeJsonStringChar(
	raw: string,
	index: number,
): { value: string; nextIndex: number } | null {
	if (raw[index] !== '\\' || index + 1 >= raw.length) return null;
	const next = raw[index + 1];
	if (next === 'n') return { value: '\n', nextIndex: index + 2 };
	if (next === 't') return { value: '\t', nextIndex: index + 2 };
	if (next === 'r') return { value: '\r', nextIndex: index + 2 };
	if (next === 'b') return { value: '\b', nextIndex: index + 2 };
	if (next === 'f') return { value: '\f', nextIndex: index + 2 };
	if (next === '"') return { value: '"', nextIndex: index + 2 };
	if (next === '\\') return { value: '\\', nextIndex: index + 2 };
	if (next === '/') return { value: '/', nextIndex: index + 2 };
	if (next === 'u' && index + 5 < raw.length) {
		const hex = raw.slice(index + 2, index + 6);
		if (/^[0-9a-fA-F]{4}$/.test(hex)) {
			return {
				value: String.fromCharCode(Number.parseInt(hex, 16)),
				nextIndex: index + 6,
			};
		}
	}
	return { value: next, nextIndex: index + 2 };
}

/**
 * Extracts a string field from partial JSON args text, decoding escapes.
 * Tolerates the stream ending mid-string (no closing quote yet).
 */
export function extractJsonStringField(raw: string, field: string): string {
	const pattern = new RegExp(`"${field}"\\s*:\\s*"`);
	const m = pattern.exec(raw);
	if (!m) return '';
	let result = '';
	let i = m.index + m[0].length;
	while (i < raw.length) {
		const decoded = decodeJsonStringChar(raw, i);
		if (decoded) {
			result += decoded.value;
			i = decoded.nextIndex;
		} else if (raw[i] === '"') {
			break;
		} else {
			result += raw[i];
			i += 1;
		}
	}
	return result;
}

function boundPreview(content: string): string {
	if (content.length <= LIVE_CONTENT_PREVIEW_CHARS) return content;
	return content.slice(-LIVE_CONTENT_PREVIEW_CHARS);
}

/**
 * Live content being streamed into a tool's arguments, for the preview box.
 * Matches web: write → content, apply_patch → patch, edit → oldString,
 * multiedit → newString, shell → cmd.
 */
export function getStreamedContent(
	toolName: string | null,
	raw: string,
): string {
	if (!raw) return '';
	switch (normalizeStreamToolName(toolName)) {
		case 'write':
			return boundPreview(extractJsonStringField(raw, 'content'));
		case 'apply_patch':
			return boundPreview(extractJsonStringField(raw, 'patch'));
		case 'edit':
			return boundPreview(
				extractJsonStringField(raw, 'newString') ||
					extractJsonStringField(raw, 'oldString'),
			);
		case 'multiedit':
			return boundPreview(extractJsonStringField(raw, 'newString'));
		case 'shell':
			return '';
		default:
			return '';
	}
}

/** Header target (path/command) derived from still-streaming args. */
export function getStreamedTarget(
	toolName: string | null,
	raw: string,
): string {
	if (!raw) return '';
	switch (normalizeStreamToolName(toolName)) {
		case 'shell':
			return extractJsonStringField(raw, 'cmd');
		case 'apply_patch': {
			const m = raw.match(
				/\*\*\*\s+(?:Update File|Add File|Delete File|Replace in|Replace Lines in|Delete Lines in|Insert Before in|Insert After in|Update|Add|Delete):\s+(.+?)(?:\\n|")/,
			);
			return m ? m[1].trim() : '';
		}
		case 'copy_into': {
			const source = extractJsonStringField(raw, 'sourcePath');
			const target = extractJsonStringField(raw, 'targetPath');
			if (source && target) return `${source} → ${target}`;
			return target || source;
		}
		default:
			return (
				extractJsonStringField(raw, 'path') ||
				extractJsonStringField(raw, 'filePath')
			);
	}
}
