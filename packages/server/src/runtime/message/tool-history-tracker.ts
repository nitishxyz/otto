type ToolResultPart = {
	type: string;
	state?: string;
	toolCallId?: string;
	input?: unknown;
	output?: unknown;
	[key: string]: unknown;
};

type ToolResultInfo = {
	toolName: string;
	callId: string;
	args: unknown;
	result: unknown;
};

type TargetDescriptor = {
	keys: string[];
	summary: string;
};

type TrackedPart = {
	part: ToolResultPart;
	summary: string;
	summarized: boolean;
};

export class ToolHistoryTracker {
	private readonly targets = new Map<string, TrackedPart>();

	register(part: ToolResultPart, info: ToolResultInfo) {
		const descriptor = describeToolResult(info);
		if (!descriptor) return;

		const entry: TrackedPart = {
			part,
			summary: descriptor.summary,
			summarized: false,
		};

		for (const key of descriptor.keys) {
			const previous = this.targets.get(key);
			if (previous && previous.part !== part) {
				this.applySummary(previous);
			}
			this.targets.set(key, entry);
		}
	}

	private applySummary(entry: TrackedPart) {
		if (entry.summarized) return;
		// Keep this entry as a tool result so the history still produces tool_result blocks.
		entry.part.state = 'output-available';
		entry.part.output = entry.summary;
		(entry.part as { summaryText?: string }).summaryText = entry.summary;
		delete (entry.part as { errorText?: unknown }).errorText;
		delete (entry.part as { rawInput?: unknown }).rawInput;
		delete (entry.part as { callProviderMetadata?: unknown })
			.callProviderMetadata;
		delete (entry.part as { providerMetadata?: unknown }).providerMetadata;
		entry.summarized = true;
	}
}

function describeToolResult(info: ToolResultInfo): TargetDescriptor | null {
	const { toolName } = info;
	switch (toolName) {
		case 'read':
			return describeRead(info);
		case 'glob':
			return describePatternTool(info, toolName);
		case 'write':
			return describeWrite(info);
		case 'apply_patch':
			return describePatch(info);
		case 'simulator':
			return describeSimulatorTool(info);
		default:
			if (toolName.includes('__')) {
				return describeMcpTool(info);
			}
			return null;
	}
}

function describeRead(info: ToolResultInfo): TargetDescriptor | null {
	const args = getRecord(info.args);
	if (!args) return null;
	const path = getString(args.path);
	if (!path) return null;
	const startLine = getNumber(args.startLine);
	const endLine = getNumber(args.endLine);

	let rangeLabel = 'entire file';
	let rangeKey = 'all';
	if (startLine !== undefined || endLine !== undefined) {
		const start = startLine ?? 1;
		const end = endLine ?? 'end';
		rangeLabel = `lines ${start}–${end}`;
		rangeKey = `${start}-${end}`;
	}

	const key = `read:${normalizePath(path)}:${rangeKey}`;
	const summary = `[previous read] ${normalizePath(path)} (${rangeLabel})`;
	return { keys: [key], summary };
}

function describePatternTool(
	info: ToolResultInfo,
	toolName: string,
): TargetDescriptor | null {
	const args = getRecord(info.args);
	if (!args) return null;
	const pattern =
		getString(args.pattern) ??
		getString(args.filePattern) ??
		getString(args.path);
	if (!pattern) return null;
	const key = `${toolName}:${pattern}`;
	const summary = `[previous ${toolName}] ${pattern}`;
	return { keys: [key], summary };
}

function describeWrite(info: ToolResultInfo): TargetDescriptor | null {
	const result = getRecord(info.result);
	if (!result) return null;
	const path = getString(result.path);
	if (!path) return null;
	const bytes = getNumber(result.bytes);
	const sizeLabel =
		typeof bytes === 'number' && Number.isFinite(bytes)
			? `${bytes} bytes`
			: 'unknown size';
	const key = `write:${normalizePath(path)}`;
	const summary = `[previous write] ${normalizePath(path)} (${sizeLabel})`;
	return { keys: [key], summary };
}

function describePatch(info: ToolResultInfo): TargetDescriptor | null {
	const result = getRecord(info.result);
	if (!result) return null;

	const files = new Set<string>();

	const changes = getArray(result.changes);
	if (changes) {
		for (const change of changes) {
			const changeObj = getRecord(change);
			const filePath = changeObj && getString(changeObj.filePath);
			if (filePath) files.add(normalizePath(filePath));
		}
	}

	const artifact = getRecord(result.artifact);
	if (artifact) {
		const summary = getRecord(artifact.summary);
		const summaryFiles = getArray(summary?.files);
		if (summaryFiles) {
			for (const item of summaryFiles) {
				if (typeof item === 'string') files.add(normalizePath(item));
				else {
					const record = getRecord(item);
					const value = record && getString(record.path);
					if (value) files.add(normalizePath(value));
				}
			}
		}
	}

	const fileList = Array.from(files);
	const keys = fileList.length
		? fileList.map((file) => `apply_patch:${file}`)
		: [`apply_patch:${info.callId}`];

	const summary =
		fileList.length > 0
			? `[previous patch] ${fileList.join(', ')}`
			: '[previous patch] (unknown files)';

	return { keys, summary };
}

function getRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function getArray(value: unknown): unknown[] | null {
	return Array.isArray(value) ? value : null;
}

function getString(value: unknown): string | null {
	if (typeof value === 'string') return value;
	return null;
}

function getNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	return undefined;
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, '/');
}

function describeSimulatorTool(info: ToolResultInfo): TargetDescriptor | null {
	const result = getRecord(info.result);
	const args = getRecord(info.args);
	if (!result || !Array.isArray(result.images) || result.images.length === 0) {
		return null;
	}

	const operation = getString(args?.operation) ?? 'unknown';
	const estimatedSize = estimateBase64Size(
		result.images as Array<{ data: string }>,
	);
	const path = getString(result.screenshotPath);
	const summary = `[previous simulator ${operation}] ${
		path ? normalizePath(path) : 'screenshot'
	} → ${result.images.length} image(s), ~${Math.round(estimatedSize / 1024)}KB`;

	return { keys: ['simulator:screenshot'], summary };
}

function describeMcpTool(info: ToolResultInfo): TargetDescriptor | null {
	const { toolName } = info;
	const result = getRecord(info.result);
	const args = getRecord(info.args);

	const hasImages =
		result && Array.isArray(result.images) && result.images.length > 0;
	const resultStr =
		result && typeof result.result === 'string' ? result.result : null;
	const estimatedSize = hasImages
		? estimateBase64Size(result.images as Array<{ data: string }>)
		: resultStr
			? resultStr.length
			: 0;

	if (estimatedSize < 2000 && !hasImages) return null;

	const argsHint = args
		? Object.entries(args)
				.slice(0, 3)
				.map(([k, v]) => {
					const val =
						typeof v === 'string'
							? v.length > 30
								? `${v.slice(0, 27)}…`
								: v
							: JSON.stringify(v);
					return `${k}=${val}`;
				})
				.join(' ')
		: '';

	const sizeLabel = hasImages
		? `${(result.images as unknown[]).length} image(s), ~${Math.round(estimatedSize / 1024)}KB`
		: `~${Math.round(estimatedSize / 1024)}KB`;

	const key = `mcp:${toolName}`;
	const summary = `[previous MCP call] ${toolName}${argsHint ? ` (${argsHint})` : ''} → ${sizeLabel}`;
	return { keys: [key], summary };
}

function estimateBase64Size(images: Array<{ data: string }>): number {
	let total = 0;
	for (const img of images) {
		if (typeof img.data === 'string') {
			total += Math.floor(img.data.length * 0.75);
		}
	}
	return total;
}
