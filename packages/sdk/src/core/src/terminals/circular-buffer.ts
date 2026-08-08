import { Buffer } from 'node:buffer';

export class CircularBuffer {
	private buffer: string[] = [];
	private byteLengths: number[] = [];
	private startIndex = 0;
	private totalBytes = 0;

	constructor(
		private readonly maxSize = 500,
		private readonly maxBytes = Number.POSITIVE_INFINITY,
	) {}

	push(line: string): void {
		const byteLength = Buffer.byteLength(line, 'utf8');
		this.buffer.push(line);
		this.byteLengths.push(byteLength);
		this.totalBytes += byteLength;
		while (
			this.length > this.maxSize ||
			(this.totalBytes > this.maxBytes && this.length > 1)
		) {
			this.totalBytes -= this.byteLengths[this.startIndex] ?? 0;
			this.buffer[this.startIndex] = '';
			this.byteLengths[this.startIndex] = 0;
			this.startIndex += 1;
		}
		if (this.startIndex >= 1024 && this.startIndex * 2 >= this.buffer.length) {
			this.buffer = this.buffer.slice(this.startIndex);
			this.byteLengths = this.byteLengths.slice(this.startIndex);
			this.startIndex = 0;
		}
	}

	read(lines?: number): string[] {
		if (lines === undefined) {
			return this.buffer.slice(this.startIndex);
		}
		return this.buffer.slice(
			Math.max(this.startIndex, this.buffer.length - lines),
		);
	}

	clear(): void {
		this.buffer = [];
		this.byteLengths = [];
		this.startIndex = 0;
		this.totalBytes = 0;
	}

	get length(): number {
		return this.buffer.length - this.startIndex;
	}
}
