#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

type Message = {
	id?: string;
	role?: string;
	parts?: Array<Record<string, unknown>>;
	createdAt?: number;
	inputTokens?: number | null;
	outputTokens?: number | null;
	totalTokens?: number | null;
	cachedInputTokens?: number | null;
};

type SizeRow = {
	bytes: number;
	messageIndex: number;
	partIndex?: number;
	role?: string;
	type: string;
	toolName?: string;
};

function jsonBytes(value: unknown): number {
	try {
		return Buffer.byteLength(JSON.stringify(value), 'utf8');
	} catch {
		return Buffer.byteLength(String(value), 'utf8');
	}
}

async function loadMessages(source: string): Promise<Message[]> {
	const text =
		source.startsWith('http://') || source.startsWith('https://')
			? await fetch(source).then((response) => {
					if (!response.ok) {
						throw new Error(
							`Request failed: ${response.status} ${response.statusText}`,
						);
					}
					return response.text();
				})
			: await readFile(source, 'utf8');
	const data = JSON.parse(text);
	if (!Array.isArray(data)) {
		throw new Error('Expected a JSON array of messages');
	}
	return data as Message[];
}

function toolNameFromPart(part: Record<string, unknown>): string | undefined {
	if (typeof part.toolName === 'string') return part.toolName;
	const contentJson = part.contentJson;
	if (
		contentJson &&
		typeof contentJson === 'object' &&
		!Array.isArray(contentJson)
	) {
		const name = (contentJson as Record<string, unknown>).name;
		if (typeof name === 'string') return name;
	}
	return undefined;
}

function collectRows(messages: Message[]): SizeRow[] {
	const rows: SizeRow[] = [];
	messages.forEach((message, messageIndex) => {
		rows.push({
			bytes: jsonBytes(message),
			messageIndex,
			role: message.role,
			type: 'message',
		});
		(message.parts ?? []).forEach((part, partIndex) => {
			rows.push({
				bytes: jsonBytes(part.contentJson ?? part),
				messageIndex,
				partIndex,
				role: message.role,
				type: String(part.type ?? 'unknown'),
				toolName: toolNameFromPart(part),
			});
		});
	});
	return rows;
}

function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
	if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${bytes} B`;
}

function printTable(rows: Array<Array<string | number>>): void {
	const widths = rows[0].map((_, column) =>
		Math.max(...rows.map((row) => String(row[column] ?? '').length)),
	);
	for (const row of rows) {
		console.log(
			row
				.map((cell, column) => String(cell ?? '').padEnd(widths[column]))
				.join('  '),
		);
	}
}

async function main() {
	const source = process.argv[2];
	if (!source) {
		console.error(
			'Usage: bun run scripts/analyze-session-context.ts <messages-json-file-or-url>',
		);
		process.exit(1);
	}

	const messages = await loadMessages(source);
	const rows = collectRows(messages);
	const totalBytes = jsonBytes(messages);

	const byType = new Map<string, { bytes: number; count: number }>();
	for (const row of rows.filter((item) => item.type !== 'message')) {
		const key = row.toolName ? `${row.type}:${row.toolName}` : row.type;
		const existing = byType.get(key) ?? { bytes: 0, count: 0 };
		existing.bytes += row.bytes;
		existing.count++;
		byType.set(key, existing);
	}

	console.log(`Messages: ${messages.length}`);
	console.log(`Serialized bytes: ${formatBytes(totalBytes)} (${totalBytes})`);
	console.log('\nBy part/tool type:');
	printTable([
		['type', 'count', 'bytes'],
		...Array.from(byType.entries())
			.sort((a, b) => b[1].bytes - a[1].bytes)
			.map(([type, value]) => [type, value.count, formatBytes(value.bytes)]),
	]);

	console.log('\nLargest messages:');
	printTable([
		['idx', 'role', 'bytes', 'tokens'],
		...rows
			.filter((row) => row.type === 'message')
			.sort((a, b) => b.bytes - a.bytes)
			.slice(0, 12)
			.map((row) => {
				const message = messages[row.messageIndex];
				return [
					row.messageIndex,
					message.role ?? '',
					formatBytes(row.bytes),
					message.totalTokens ?? '',
				];
			}),
	]);

	console.log('\nLargest parts:');
	printTable([
		['msg', 'part', 'role', 'type', 'tool', 'bytes'],
		...rows
			.filter((row) => row.type !== 'message')
			.sort((a, b) => b.bytes - a.bytes)
			.slice(0, 20)
			.map((row) => [
				row.messageIndex,
				row.partIndex ?? '',
				row.role ?? '',
				row.type,
				row.toolName ?? '',
				formatBytes(row.bytes),
			]),
	]);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
