import { createRequire } from 'node:module';

export type {
	IPty,
	IPtyForkOptions as PtyOptions,
	IExitEvent,
} from 'bun-pty';

type BunPty = typeof import('bun-pty');

const require = createRequire(import.meta.url);
let bunPty: BunPty | null = null;

function getBunPty(): BunPty {
	bunPty ??= require('bun-pty') as BunPty;
	return bunPty;
}

export const spawn: BunPty['spawn'] = (...args) => getBunPty().spawn(...args);
