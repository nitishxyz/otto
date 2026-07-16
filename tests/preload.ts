import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const testRoot = mkdtempSync(join(tmpdir(), 'otto-test-suite-'));

process.env.OTTO_HOME = join(testRoot, 'state');
process.env.XDG_CONFIG_HOME = join(testRoot, 'config');

process.once('exit', () => {
	rmSync(testRoot, { recursive: true, force: true });
});
