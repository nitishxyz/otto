import { resolve, join } from 'node:path';

const root = resolve(import.meta.dir, '..');
const groups = [
	{
		name: 'repository',
		cwd: root,
		files: [
			...new Bun.Glob('tests/**/*.test.{ts,tsx}').scanSync({ cwd: root }),
			...new Bun.Glob('packages/*/tests/**/*.test.{ts,tsx}').scanSync({
				cwd: root,
			}),
		],
	},
	{
		name: 'desktop',
		cwd: join(root, 'apps/desktop'),
		files: [
			...new Bun.Glob('tests/**/*.test.{ts,tsx}').scanSync({
				cwd: join(root, 'apps/desktop'),
			}),
		],
	},
];

let failed = false;
for (const group of groups) {
	console.log(`\n${group.name}: ${group.files.length} files (shared process)`);
	const child = Bun.spawn({
		cmd: [
			process.execPath,
			'test',
			...group.files.sort().map((file) => `./${file}`),
		],
		cwd: group.cwd,
		stdout: 'inherit',
		stderr: 'inherit',
	});
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill('SIGKILL');
	}, 180_000);
	const exitCode = await child.exited;
	clearTimeout(timer);
	if (timedOut) console.error(`${group.name} exceeded its 180-second deadline`);
	if (exitCode !== 0 || timedOut) failed = true;
}
process.exitCode = failed ? 1 : 0;
