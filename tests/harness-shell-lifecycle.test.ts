import { expect, test } from 'bun:test';
import { buildShellTool } from '../packages/sdk/src/core/src/tools/builtin/shell.ts';
import { createSecureShellExecutor } from '../packages/server/src/tools/adapter/secure-shell.ts';
import type { ToolAdapterContext } from '../packages/server/src/runtime/tools/context.ts';

const input = {
	cmd: 'kill -TERM $$',
	cwd: process.cwd(),
	envMode: 'minimal' as const,
	outputMode: 'full' as const,
	tailLines: 100,
	maxOutputBytes: 1024,
	timeout: 5000,
	detached: false,
	allowNonZeroExit: true,
};
const ctx: ToolAdapterContext = {
	sessionId: crypto.randomUUID(),
	messageId: crypto.randomUUID(),
	assistantPartId: crypto.randomUUID(),
	db: {} as ToolAdapterContext['db'],
	agent: 'build',
	provider: 'test',
	model: 'test',
	projectRoot: process.cwd(),
	nextIndex: () => 0,
};
const sdk = buildShellTool(process.cwd()).tool.execute as unknown as (
	input: typeof input,
) => AsyncIterable<unknown>;
async function final(stream: AsyncIterable<unknown>): Promise<unknown> {
	let result: unknown;
	for await (const chunk of stream) {
		if (chunk && typeof chunk === 'object' && 'result' in chunk)
			result = chunk.result;
	}
	return result;
}
for (const [name, execute] of [
	['sdk', sdk],
	['server', createSecureShellExecutor({ ctx })],
] as const) {
	test(`${name}: signal close is failure even with allowNonZeroExit`, async () => {
		const result = await final(execute(input) as AsyncIterable<unknown>);
		expect(result).toMatchObject({ ok: false });
		expect(JSON.stringify(result)).toContain('SIGTERM');
	});
	test(`${name}: byte cap and metadata agree`, async () => {
		const result = await final(
			execute({
				...input,
				cmd: `"${process.execPath}" -e "process.stdout.write('x'.repeat(5000))"`,
			}) as AsyncIterable<unknown>,
		);
		expect(result).toMatchObject({
			ok: true,
			stdoutOriginalBytes: 5000,
			stdoutShownBytes: 1024,
			stdoutTruncated: true,
			maxOutputBytes: 1024,
		});
	});
	test(`${name}: zero disables the byte cap`, async () => {
		const result = await final(
			execute({
				...input,
				maxOutputBytes: 0,
				cmd: `"${process.execPath}" -e "process.stdout.write('x'.repeat(1500000))"`,
			}) as AsyncIterable<unknown>,
		);
		expect(result).toMatchObject({
			ok: true,
			stdoutOriginalBytes: 1500000,
			stdoutShownBytes: 1500000,
			stdoutTruncated: false,
		});
	});
	test(`${name}: iterator return kills the process tree`, async () => {
		const iterator = (
			execute({
				...input,
				cmd: `"${process.execPath}" -e "console.log(process.pid);setInterval(()=>{},1000)"`,
			}) as AsyncIterable<unknown>
		)[Symbol.asyncIterator]();
		const first = await iterator.next();
		const chunk = first.value as { delta: string };
		const pid = Number(chunk.delta.trim());
		expect(pid).toBeGreaterThan(0);
		await iterator.return?.();
		await Bun.sleep(100);
		expect(() => process.kill(pid, 0)).toThrow();
	});
	test(`${name}: timeout escalates a SIGTERM-ignoring process`, async () => {
		const start = Date.now();
		const result = await final(
			execute({
				...input,
				cmd: "trap '' TERM; printf '%s\\n' $$; while :; do sleep 1; done",
				timeout: 100,
			}) as AsyncIterable<unknown>,
		);
		expect(result).toMatchObject({ ok: false, errorType: 'timeout' });
		expect(Date.now() - start).toBeLessThan(3000);
		const pid = Number(
			(result as { details: { stdout: string } }).details.stdout.trim(),
		);
		expect(pid).toBeGreaterThan(0);
		expect(() => process.kill(pid, 0)).toThrow();
	});
}
