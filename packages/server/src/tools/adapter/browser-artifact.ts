type JsonRecord = Record<string, unknown>;

export interface BrowserScreenshotArtifact {
	data: string;
	mediaType: string;
}

function asRecord(value: unknown): JsonRecord | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as JsonRecord)
		: null;
}

function isBrowserScreenshotArtifact(
	value: unknown,
): value is JsonRecord & BrowserScreenshotArtifact {
	const artifact = asRecord(value);
	if (!artifact) return false;
	return (
		artifact.kind === 'browser_screenshot' &&
		typeof artifact.data === 'string' &&
		artifact.data.length > 0 &&
		typeof artifact.mediaType === 'string' &&
		/^image\/[a-z0-9.+-]+$/i.test(artifact.mediaType)
	);
}

export function browserScreenshotContentUrl(
	sessionId: string,
	callId: string,
): string {
	return `/v1/sessions/${encodeURIComponent(sessionId)}/tool-results/${encodeURIComponent(callId)}/artifact`;
}

export function extractBrowserScreenshot(
	content: unknown,
): BrowserScreenshotArtifact | null {
	const record = asRecord(content);
	if (!record) return null;
	const result = asRecord(record.result);
	const artifact = result?.artifact ?? record.artifact;
	if (!isBrowserScreenshotArtifact(artifact)) return null;
	return { data: artifact.data, mediaType: artifact.mediaType };
}

function referenceArtifact(artifact: unknown, contentUrl: string): unknown {
	if (!isBrowserScreenshotArtifact(artifact)) return artifact;
	const { data: _data, ...metadata } = artifact;
	return { ...metadata, contentUrl, dataOmitted: true };
}

function omitInlineImageData(
	this: unknown,
	key: string,
	value: unknown,
): unknown {
	if (key !== 'data' || typeof value !== 'string') return value;
	const parent = asRecord(this);
	if (parent?.type === 'image-data' || parent?.kind === 'browser_screenshot') {
		return undefined;
	}
	return value;
}

/** Serializes diagnostics without retaining model-visible inline image bytes. */
export function stringifyWithoutInlineImageData(value: unknown): string {
	return JSON.stringify(value, omitInlineImageData);
}

export function sanitizeInlineImageDataJson<T extends string | null>(
	value: T,
): T {
	if (!value || !value.includes('"data"')) return value;
	try {
		return stringifyWithoutInlineImageData(JSON.parse(value)) as T;
	} catch {
		return value;
	}
}

/** Replaces inline browser screenshot bytes with an authenticated asset URL. */
export function referenceBrowserScreenshot<T extends object>(
	content: T,
	sessionId: string,
	callId: string,
): T {
	const record = content as JsonRecord;
	const result = asRecord(record.result);
	const hasResultArtifact = isBrowserScreenshotArtifact(result?.artifact);
	const hasRootArtifact = isBrowserScreenshotArtifact(record.artifact);
	if (!hasResultArtifact && !hasRootArtifact) return content;

	const contentUrl = browserScreenshotContentUrl(sessionId, callId);
	const referenced: JsonRecord = { ...record };
	if (result && hasResultArtifact) {
		referenced.result = {
			...result,
			artifact: referenceArtifact(result.artifact, contentUrl),
		};
	}
	if (hasRootArtifact) {
		referenced.artifact = referenceArtifact(record.artifact, contentUrl);
	}
	return referenced as T;
}
