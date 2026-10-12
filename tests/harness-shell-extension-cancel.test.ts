import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	executeNativeExtension,
	disposeNativeExtensionHosts,
} from '../packages/sdk/src/core/src/tools/extensions/client.ts';

test('cancelling one call does not dispose a shared host or its other calls', async () => {
	const root = await mkdtemp(join(tmpdir(), 'harness-native-'));
	const previous = process.env.OTTO_NATIVE_EXTENSION_HOST_ENTRY;
	process.env.OTTO_NATIVE_EXTENSION_HOST_ENTRY = join(
		import.meta.dir,
		'../packages/sdk/src/core/src/tools/extensions/host-entry.ts',
	);
	try {
		await writeFile(
			join(root, 'tool.ts'),
			`export default async (input, context) => {
   context.progress('started');
   await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, input.delay);
    context.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
   });
   return { pid: process.pid };
  };`,
		);
		const base = {
			entryPath: 'tool.ts',
			pluginDir: root,
			projectRoot: root,
			storagePath: join(root, 'storage'),
			toolName: 'test',
			secrets: {},
			timeoutMs: 5000,
		};
		const abort = new AbortController();
		const first = executeNativeExtension({
			...base,
			input: { delay: 3000 },
			signal: abort.signal,
		})[Symbol.asyncIterator]();
		await first.next();
		const other = executeNativeExtension({ ...base, input: { delay: 100 } });
		abort.abort();
		await expect(first.next()).rejects.toThrow('aborted');
		let result: unknown;
		for await (const frame of other)
			if ('result' in frame) result = frame.result;
		expect(result).toHaveProperty('pid');
		const timed = executeNativeExtension({
			...base,
			timeoutMs: 50,
			input: { delay: 3000 },
		})[Symbol.asyncIterator]();
		await timed.next();
		await expect(timed.next()).rejects.toThrow('timed out');
		let next: unknown;
		for await (const frame of executeNativeExtension({
			...base,
			input: { delay: 10 },
		}))
			if ('result' in frame) next = frame.result;
		expect(next).toEqual(result);
	} finally {
		disposeNativeExtensionHosts(root);
		if (previous === undefined)
			delete process.env.OTTO_NATIVE_EXTENSION_HOST_ENTRY;
		else process.env.OTTO_NATIVE_EXTENSION_HOST_ENTRY = previous;
		await rm(root, { recursive: true, force: true });
	}
});
