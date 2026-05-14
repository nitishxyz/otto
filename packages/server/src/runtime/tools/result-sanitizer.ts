const MAX_STRING_LENGTH = 20_000;
const MAX_TOTAL_JSON_LENGTH = 650_000;
const MAX_INLINE_IMAGE_BASE64_LENGTH = 500_000;

type ImageLike = {
	data?: unknown;
	mimeType?: unknown;
	mediaType?: unknown;
	[key: string]: unknown;
};

/**
 * Removes large inline payloads from tool results before they are persisted or
 * returned to the model. This keeps screenshots and MCP image blobs from being
 * replayed into future context windows while preserving metadata/artifact paths.
 */
export function sanitizeToolResultForModel(result: unknown): unknown {
	const sanitized = sanitizeValue(result);
	if (estimateJsonLength(sanitized) <= MAX_TOTAL_JSON_LENGTH) return sanitized;
	return summarizeOversizedResult(sanitized);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
	if (depth > 12) return '[omitted: nested value too deep]';
	if (typeof value === 'string') return sanitizeString(value);
	if (!value || typeof value !== 'object') return value;
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeValue(item, depth + 1));
	}

	const record = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(record)) {
		if (key === 'images' && Array.isArray(item)) {
			out.images = item.map((image) => sanitizeImage(image as ImageLike));
			out.imagesOmitted = true;
			continue;
		}

		if (
			key === 'data' &&
			typeof item === 'string' &&
			looksLikeBase64(item) &&
			item.length > MAX_INLINE_IMAGE_BASE64_LENGTH
		) {
			out.data = `[omitted base64 payload: ${item.length} chars]`;
			out.dataOmitted = true;
			continue;
		}

		out[key] = sanitizeValue(item, depth + 1);
	}
	return out;
}

function sanitizeImage(image: ImageLike): Record<string, unknown> {
	const data = typeof image.data === 'string' ? image.data : undefined;
	const mimeType =
		typeof image.mimeType === 'string'
			? image.mimeType
			: typeof image.mediaType === 'string'
				? image.mediaType
				: undefined;
	const out: Record<string, unknown> = {
		mimeType,
	};
	if (data) {
		if (data.length <= MAX_INLINE_IMAGE_BASE64_LENGTH) {
			out.data = data;
		} else {
			out.omitted = true;
			out.base64Length = data.length;
			out.approxBytes = Math.floor(data.length * 0.75);
		}
	}
	if (typeof image.path === 'string') out.path = image.path;
	if (typeof image.fullSizePath === 'string')
		out.fullSizePath = image.fullSizePath;
	if (typeof image.approxBytes === 'number')
		out.approxBytes = image.approxBytes;
	return out;
}

function sanitizeString(value: string): string {
	if (value.length <= MAX_STRING_LENGTH) return value;
	return `${value.slice(0, MAX_STRING_LENGTH)}\n[omitted ${
		value.length - MAX_STRING_LENGTH
	} chars]`;
}

function looksLikeBase64(value: string): boolean {
	return value.length > 8_000 && /^[A-Za-z0-9+/=\r\n]+$/.test(value);
}

function estimateJsonLength(value: unknown): number {
	try {
		return JSON.stringify(value).length;
	} catch {
		return String(value).length;
	}
}

function summarizeOversizedResult(value: unknown): unknown {
	const record = value && typeof value === 'object' ? value : undefined;
	if (!record || Array.isArray(record)) {
		return `[omitted oversized tool result: ~${estimateJsonLength(value)} chars]`;
	}

	const obj = record as Record<string, unknown>;
	return {
		ok: obj.ok,
		message:
			typeof obj.message === 'string'
				? sanitizeString(obj.message)
				: 'Tool result omitted because it was too large for model context.',
		artifact: obj.artifact,
		omitted: true,
		omittedReason: 'tool result exceeded safe context size',
		estimatedChars: estimateJsonLength(value),
	};
}
