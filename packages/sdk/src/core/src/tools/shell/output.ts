export type OutputMode = 'auto' | 'full' | 'tail';

export function retainUtf8Tail(value: string, limit: number): string {
	if (limit <= 0) return value;
	const bytes = Buffer.from(value);
	if (bytes.length <= limit) return value;
	let start = bytes.length - limit;
	while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
	return bytes.subarray(start).toString();
}

/** Auto and tail retain the last lines; all modes obey a per-stream byte cap (0 = uncapped). */
export class ShellOutputCollector {
	private text = '';
	private originalBytes = 0;
	get value(): string {
		return this.text;
	}
	constructor(
		private readonly mode: OutputMode,
		private readonly lines: number,
		private readonly maxBytes: number,
	) {}
	append(chunk: string): string {
		this.originalBytes += Buffer.byteLength(chunk);
		let text = this.text + chunk;
		if (this.mode !== 'full') {
			const lines = text.split('\n');
			const count = Math.max(1, this.lines) + (text.endsWith('\n') ? 1 : 0);
			if (lines.length > count) text = lines.slice(-count).join('\n');
		}
		this.text = retainUtf8Tail(text, this.maxBytes);
		return this.text;
	}
	metadata(prefix: 'stdout' | 'stderr'): Record<string, number | boolean> {
		const shown = Buffer.byteLength(this.text);
		return {
			[`${prefix}Truncated`]: shown < this.originalBytes,
			[`${prefix}OriginalBytes`]: this.originalBytes,
			[`${prefix}ShownBytes`]: shown,
		};
	}
}
