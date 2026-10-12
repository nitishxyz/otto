import assert from 'node:assert/strict';
import { spawn } from '../packages/sdk/src/core/src/terminals/bun-pty.ts';

const output: string[] = [];
const pty = spawn('/bin/sh', ['-c', 'printf compiled-pty-ok'], {
	cwd: '/tmp',
	env: { HOME: '/tmp', PATH: '/usr/bin:/bin' },
});
pty.onData((data) => output.push(data));
const exitCode = await new Promise<number>((resolve) => {
	pty.onExit((event) => resolve(event.exitCode));
});
assert.equal(exitCode, 0);
assert.equal(output.join(''), 'compiled-pty-ok');
console.log('compiled-product-pty-ok');
