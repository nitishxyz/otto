import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const logDir = await mkdtemp(join(tmpdir(), 'otto-suite-'));
const files = [
	...new Bun.Glob('tests/**/*.test.{ts,tsx}').scanSync({ cwd: root }),
	...new Bun.Glob('packages/*/tests/**/*.test.{ts,tsx}').scanSync({
		cwd: root,
	}),
	...new Bun.Glob('apps/desktop/tests/**/*.test.{ts,tsx}').scanSync({
		cwd: root,
	}),
].sort();
const results: Array<{
	file: string;
	exitCode: number;
	timedOut: boolean;
	pass: number;
	fail: number;
	skip: number;
}> = [];
let next = 0;

console.log(`Running ${files.length} isolated files; logs: ${logDir}`);
async function worker() {
	while (next < files.length) {
		const file = files[next++];
		const desktop = file.startsWith('apps/desktop/');
		const log = Bun.file(join(logDir, file.replaceAll('/', '_')));
		const child = Bun.spawn({
			cmd: [
				process.execPath,
				'test',
				desktop ? `./${file.slice(13)}` : `./${file}`,
			],
			cwd: desktop ? join(root, 'apps/desktop') : root,
			stdout: log,
			stderr: log,
		});
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGKILL');
		}, 60_000);
		const exitCode = await child.exited;
		clearTimeout(timer);
		const output = await log.text();
		const count = (kind: string) =>
			Number(output.match(new RegExp(`^\\s*(\\d+) ${kind}$`, 'm'))?.[1] ?? 0);
		results.push({
			file,
			exitCode,
			timedOut,
			pass: count('pass'),
			fail: count('fail'),
			skip: count('skip'),
		});
		if (exitCode !== 0 || timedOut)
			console.log(`FAILED ${file} (${exitCode}, timeout=${timedOut})`);
	}
}
await Promise.all([worker(), worker()]);
const totals = results.reduce(
	(sum, result) => ({
		pass: sum.pass + result.pass,
		fail: sum.fail + result.fail,
		skip: sum.skip + result.skip,
	}),
	{ pass: 0, fail: 0, skip: 0 },
);
const failures = results.filter(
	(result) => result.exitCode !== 0 || result.timedOut,
);
await Bun.write(
	join(logDir, 'results.json'),
	JSON.stringify({ totals, results }, null, 2),
);
console.log(
	JSON.stringify({ files: files.length, totals, failures, logDir }, null, 2),
);
process.exitCode = failures.length ? 1 : 0;
