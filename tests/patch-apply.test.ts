import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyPatchOperations } from '../packages/sdk/src/core/src/tools/builtin/patch/apply.ts';
import { parseEnvelopedPatch } from '../packages/sdk/src/core/src/tools/builtin/patch/parse-enveloped.ts';

let projectRoot: string;

beforeEach(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'patch-test-'));
});

afterEach(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

async function writeTestFile(name: string, content: string) {
	await writeFile(join(projectRoot, name), content, 'utf-8');
}

async function readTestFile(name: string) {
	return readFile(join(projectRoot, name), 'utf-8');
}

async function applyPatch(
	patch: string,
	opts?: { useFuzzy?: boolean; allowRejects?: boolean },
) {
	const operations = parseEnvelopedPatch(patch);
	return applyPatchOperations(projectRoot, operations, {
		useFuzzy: opts?.useFuzzy ?? true,
		allowRejects: opts?.allowRejects ?? false,
	});
}

describe('patch apply — line-number mode', () => {
	it('deletes an inclusive line range without requiring removed text', async () => {
		await writeTestFile(
			'lines.txt',
			['one', 'two', 'three', 'four', 'five'].join('\n'),
		);

		const result = await applyPatch(
			[
				'*** Begin Patch',
				'*** Delete Lines in: lines.txt',
				'*** Lines: 2-4',
				'*** End Patch',
			].join('\n'),
		);

		expect(await readTestFile('lines.txt')).toBe('one\nfive\n');
		expect(result.summary).toMatchObject({
			files: 1,
			additions: 0,
			deletions: 3,
		});
		expect(result.normalizedPatch).toContain('-two');
		expect(result.normalizedPatch).toContain('-four');
	});

	it('replaces a line range through eof with new content', async () => {
		await writeTestFile(
			'replace.txt',
			['alpha', 'beta', 'gamma', 'delta'].join('\n'),
		);

		const result = await applyPatch(
			[
				'*** Begin Patch',
				'*** Replace Lines in: replace.txt',
				'*** Lines: 3-eof',
				'*** With:',
				'GAMMA',
				'DELTA',
				'*** End Patch',
			].join('\n'),
		);

		expect(await readTestFile('replace.txt')).toBe(
			'alpha\nbeta\nGAMMA\nDELTA\n',
		);
		expect(result.summary).toMatchObject({
			files: 1,
			additions: 2,
			deletions: 2,
		});
	});

	it('inserts content before and after explicit line numbers', async () => {
		await writeTestFile('before.txt', ['a', 'b', 'c'].join('\n'));
		await writeTestFile('after.txt', ['a', 'b', 'c'].join('\n'));

		await applyPatch(
			[
				'*** Begin Patch',
				'*** Insert Before in: before.txt',
				'*** Line: 2',
				'*** With:',
				'x',
				'*** Insert After in: after.txt',
				'*** Line: 2',
				'*** With:',
				'y',
				'*** End Patch',
			].join('\n'),
		);

		expect(await readTestFile('before.txt')).toBe('a\nx\nb\nc\n');
		expect(await readTestFile('after.txt')).toBe('a\nb\ny\nc\n');
	});
});

describe('patch apply — stale context rejection', () => {
	it('rejects patch when context line has extra content (the || bug)', async () => {
		await writeTestFile(
			'test.ts',
			[
				'if (',
				'\texistsSync("a.txt") ||',
				'\texistsSync("b.txt")',
				') {',
				'\tresult = "found";',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: test.ts',
			'@@ add more checks',
			' if (',
			' \texistsSync("a.txt") ||',
			' \texistsSync("b.txt") ||',
			'+\texistsSync("c.txt") ||',
			'+\texistsSync("d.txt")',
			' ) {',
			' \tresult = "found";',
			'*** End Patch',
		].join('\n');

		expect(() => applyPatch(patch)).toThrow('Failed to apply patch hunk');
	});

	it('rejects patch when context line content differs (not just whitespace)', async () => {
		await writeTestFile(
			'app.ts',
			[
				'function greet(name: string) {',
				'  return "Hello, " + name;',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: app.ts',
			' function greet(name: string) {',
			'-  return "Hello, " + name;',
			// biome-ignore lint/suspicious/noTemplateCurlyInString: intentional template literal in patch content
			'+  return `Hello, ${name}!`;',
			'-}',
			'+}',
			'*** End Patch',
		].join('\n');

		const _result = await applyPatch(patch);
		const content = await readTestFile('app.ts');
		// biome-ignore lint/suspicious/noTemplateCurlyInString: checking template literal in file content
		expect(content).toContain('`Hello, ${name}!`');
	});

	it('applies patch correctly when context matches exactly', async () => {
		await writeTestFile(
			'test.ts',
			[
				'if (',
				'\texistsSync("a.txt") ||',
				'\texistsSync("b.txt")',
				') {',
				'\tresult = "found";',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: test.ts',
			'@@ add more checks',
			' if (',
			' \texistsSync("a.txt") ||',
			' \texistsSync("b.txt")',
			'+\texistsSync("c.txt")',
			' ) {',
			' \tresult = "found";',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('test.ts');
		expect(content).toContain('existsSync("c.txt")');
		expect(content).toContain('result = "found"');
	});

	it('does not blindly insert additions at wrong location', async () => {
		await writeTestFile(
			'config.ts',
			[
				'const config = {',
				'  host: "localhost",',
				'  port: 3000,',
				'};',
				'',
				'export default config;',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: config.ts',
			' const config = {',
			' \thost: "localhost",',
			' \tport: 3000,',
			' \ttimeout: 5000,',
			'+\tretries: 3,',
			' };',
			'*** End Patch',
		].join('\n');

		expect(() => applyPatch(patch)).toThrow('Failed to apply patch hunk');
	});

	it('allows rejects mode to skip bad hunks without breaking file', async () => {
		await writeTestFile(
			'test.ts',
			[
				'if (',
				'\texistsSync("a.txt") ||',
				'\texistsSync("b.txt")',
				') {',
				'\tresult = "found";',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: test.ts',
			'@@ wrong context',
			' if (',
			' \texistsSync("a.txt") ||',
			' \texistsSync("b.txt") ||',
			'+\texistsSync("c.txt")',
			' ) {',
			'*** End Patch',
		].join('\n');

		const result = await applyPatch(patch, { allowRejects: true });
		expect(result.rejected.length).toBe(1);
		const content = await readTestFile('test.ts');
		expect(content).not.toContain('existsSync("c.txt")');
		expect(content).toContain('existsSync("b.txt")');
	});

	it('still applies pure addition hunks without context', async () => {
		await writeTestFile('hello.ts', 'const x = 1;\n');

		const patch = [
			'*** Begin Patch',
			'*** Update File: hello.ts',
			'+const y = 2;',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('hello.ts');
		expect(content).toContain('const y = 2;');
	});

	it('detects already-applied additions and skips without error', async () => {
		await writeTestFile(
			'test.ts',
			[
				'if (',
				'\texistsSync("a.txt") ||',
				'\texistsSync("b.txt") ||',
				'\texistsSync("c.txt")',
				') {',
				'\tresult = "found";',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: test.ts',
			' if (',
			' \texistsSync("a.txt") ||',
			' \texistsSync("b.txt") ||',
			'+\texistsSync("c.txt")',
			' ) {',
			'*** End Patch',
		].join('\n');

		const _result = await applyPatch(patch);
		const content = await readTestFile('test.ts');
		expect(content).toContain('existsSync("c.txt")');
	});
});

describe('patch apply — indentation correction', () => {
	it('corrects indentation when model uses wrong whitespace (YAML case)', async () => {
		await writeTestFile(
			'ci.yml',
			[
				'jobs:',
				'  build:',
				'    runs-on: ubuntu-latest',
				'    strategy:',
				'      matrix:',
				'        include:',
				'          - platform: macos-latest',
				'            target: arm64',
				'          - platform: ubuntu-latest',
				'            target: x64',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: ci.yml',
			' - platform: ubuntu-latest',
			'-  target: x64',
			'+  target: x86_64',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('ci.yml');
		expect(content).toContain('            target: x86_64');
	});

	it('preserves correct indentation when model context matches exactly', async () => {
		await writeTestFile(
			'app.ts',
			[
				'function main() {',
				'    const port = 3000;',
				'    return port;',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: app.ts',
			' function main() {',
			'-    const port = 3000;',
			'+    const port = 8080;',
			'     return port;',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('app.ts');
		expect(content).toContain('    const port = 8080;');
	});

	it('corrects add-line indentation based on nearest context line delta', async () => {
		await writeTestFile(
			'config.yml',
			[
				'services:',
				'  web:',
				'    image: nginx',
				'    ports:',
				'      - "80:80"',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: config.yml',
			' ports:',
			'   - "80:80"',
			'+  - "443:443"',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('config.yml');
		expect(content).toContain('      - "443:443"');
	});

	it('handles context lines with tab vs space mismatch', async () => {
		await writeTestFile(
			'script.ts',
			['function test() {', '  const a = 1;', '  const b = 2;', '}'].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: script.ts',
			' function test() {',
			'-  const a = 1;',
			'+  const a = 10;',
			'   const b = 2;',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('script.ts');
		expect(content).toContain('  const a = 10;');
	});
});

describe('patch apply — simple Replace format', () => {
	it('applies a basic find and replace', async () => {
		await writeTestFile(
			'config.ts',
			['const config = {', '  host: "localhost",', '  port: 3000,', '};'].join(
				'\n',
			),
		);

		const patch = [
			'*** Begin Patch',
			'*** Replace in: config.ts',
			'*** Find:',
			'  port: 3000,',
			'*** With:',
			'  port: 8080,',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('config.ts');
		expect(content).toContain('port: 8080');
		expect(content).not.toContain('port: 3000');
	});

	it('applies multiple find/replace pairs in one file', async () => {
		await writeTestFile(
			'app.ts',
			[
				'const HOST = "localhost";',
				'const PORT = 3000;',
				'const DEBUG = false;',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Replace in: app.ts',
			'*** Find:',
			'const PORT = 3000;',
			'*** With:',
			'const PORT = 8080;',
			'*** Find:',
			'const DEBUG = false;',
			'*** With:',
			'const DEBUG = true;',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('app.ts');
		expect(content).toContain('const PORT = 8080;');
		expect(content).toContain('const DEBUG = true;');
	});

	it('handles multi-line find and replace', async () => {
		await writeTestFile(
			'styles.css',
			['.header {', '  color: red;', '  font-size: 14px;', '}'].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Replace in: styles.css',
			'*** Find:',
			'  color: red;',
			'  font-size: 14px;',
			'*** With:',
			'  color: blue;',
			'  font-size: 16px;',
			'  font-weight: bold;',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('styles.css');
		expect(content).toContain('color: blue');
		expect(content).toContain('font-size: 16px');
		expect(content).toContain('font-weight: bold');
		expect(content).not.toContain('color: red');
	});

	it('handles find/replace with no replacement (deletion)', async () => {
		await writeTestFile(
			'app.ts',
			['const a = 1;', 'const b = 2;', 'const c = 3;'].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Replace in: app.ts',
			'*** Find:',
			'const b = 2;',
			'*** With:',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('app.ts');
		expect(content).not.toContain('const b = 2;');
		expect(content).toContain('const a = 1;');
		expect(content).toContain('const c = 3;');
	});

	it('errors when Find block is empty', async () => {
		const patch = [
			'*** Begin Patch',
			'*** Replace in: foo.ts',
			'*** Find:',
			'*** With:',
			'something',
			'*** End Patch',
		].join('\n');

		expect(() => parseEnvelopedPatch(patch)).toThrow('*** With: must follow');
	});

	it('errors when With comes before Find', async () => {
		const patch = [
			'*** Begin Patch',
			'*** Replace in: foo.ts',
			'*** With:',
			'something',
			'*** End Patch',
		].join('\n');

		expect(() => parseEnvelopedPatch(patch)).toThrow('*** With: must follow');
	});

	it('applies replace with fuzzy indentation correction', async () => {
		await writeTestFile(
			'ci.yml',
			[
				'matrix:',
				'  include:',
				'    - platform: ubuntu-latest',
				'      target: x64',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Replace in: ci.yml',
			'*** Find:',
			'    - platform: ubuntu-latest',
			'      target: x64',
			'*** With:',
			'    - platform: ubuntu-22.04',
			'      target: x64',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('ci.yml');
		expect(content).toContain('ubuntu-22.04');
		expect(content).not.toContain('ubuntu-latest');
	});
});

describe('patch apply — real LLM regression tests', () => {
	it('YAML: no extra leading space on inserted lines (release.yml bug)', async () => {
		await writeTestFile(
			'release.yml',
			[
				'jobs:',
				'  build-desktop:',
				// biome-ignore lint/suspicious/noTemplateCurlyInString: test data - GitHub Actions syntax
				'    runs-on: ${{ matrix.platform }}',
				'    strategy:',
				'      fail-fast: false',
				'      matrix:',
				'        include:',
				'          - platform: macos-latest',
				'            target: aarch64-apple-darwin',
				'            name: macOS-arm64',
				'          - platform: macos-latest',
				'            target: x86_64-apple-darwin',
				'            name: macOS-x64',
				'          - platform: ubuntu-latest',
				'            target: x86_64-unknown-linux-gnu',
				'            name: Linux-x64',
				'    steps:',
				'      - uses: actions/checkout@v4',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: release.yml',
			'@@ matrix linux entry',
			'           - platform: macos-latest',
			'             target: x86_64-apple-darwin',
			'             name: macOS-x64',
			'-          - platform: ubuntu-latest',
			'+          - platform: ubuntu-22.04',
			'             target: x86_64-unknown-linux-gnu',
			'             name: Linux-x64',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('release.yml');
		expect(content).toContain('          - platform: ubuntu-22.04');
		expect(content).toContain('            target: x86_64-unknown-linux-gnu');
		expect(content).toContain('            name: Linux-x64');
		expect(content).not.toContain('ubuntu-latest');
		const lines = content.split('\n');
		const ubuntuLine = lines.find((l: string) => l.includes('ubuntu-22.04'));
		expect(ubuntuLine).toBe('          - platform: ubuntu-22.04');
	});

	it('YAML: model uses fewer spaces in context but file has deep nesting', async () => {
		await writeTestFile(
			'workflow.yml',
			[
				'jobs:',
				'  deploy:',
				'    steps:',
				'      - name: Build',
				'        run: npm run build',
				'      - name: Test',
				'        run: npm test',
				'      - name: Deploy',
				'        run: npm run deploy',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: workflow.yml',
			' - name: Test',
			'-  run: npm test',
			'+  run: npm run test:ci',
			' - name: Deploy',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('workflow.yml');
		expect(content).toContain('        run: npm run test:ci');
		expect(content).not.toContain('npm test');
		const lines = content.split('\n');
		const testLine = lines.find((l: string) => l.includes('test:ci'));
		expect(testLine).toBe('        run: npm run test:ci');
	});

	it('YAML: inserted add line gets correct indentation from delta', async () => {
		await writeTestFile(
			'docker-compose.yml',
			[
				'services:',
				'  app:',
				'    environment:',
				'      - NODE_ENV=production',
				'      - PORT=3000',
				'    volumes:',
				'      - ./data:/data',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: docker-compose.yml',
			' - NODE_ENV=production',
			' - PORT=3000',
			'+- DEBUG=false',
			' volumes:',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('docker-compose.yml');
		expect(content).toContain('      - DEBUG=false');
		const lines = content.split('\n');
		const debugLine = lines.find((l: string) => l.includes('DEBUG'));
		expect(debugLine).toBe('      - DEBUG=false');
	});

	it('Markdown: bullet lines starting with - do not conflict with remove prefix', async () => {
		await writeTestFile(
			'README.md',
			[
				'# Features',
				'',
				'- Fast compilation',
				'- Hot reload',
				'- Type safety',
				'',
				'## Getting Started',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: README.md',
			' - Fast compilation',
			' - Hot reload',
			'-- Type safety',
			'+- Type safety with strict mode',
			'+- Plugin system',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('README.md');
		expect(content).toContain('- Type safety with strict mode');
		expect(content).toContain('- Plugin system');
		expect(content).not.toContain('- Type safety\n');
	});

	it('Markdown: Replace format avoids bullet conflict entirely', async () => {
		await writeTestFile(
			'README.md',
			[
				'# Features',
				'',
				'- Fast compilation',
				'- Hot reload',
				'- Type safety',
				'',
				'## Getting Started',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Replace in: README.md',
			'*** Find:',
			'- Type safety',
			'*** With:',
			'- Type safety with strict mode',
			'- Plugin system',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('README.md');
		expect(content).toContain('- Type safety with strict mode');
		expect(content).toContain('- Plugin system');
		expect(content).toContain('- Hot reload');
	});

	it('TypeScript with tabs: preserves tab indentation', async () => {
		await writeTestFile(
			'capture.ts',
			[
				'export function capture() {',
				'\tconst data = {};',
				'\tif (condition) {',
				'\t\tdata.value = 1;',
				'\t\tdata.name = "test";',
				'\t}',
				'\treturn data;',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: capture.ts',
			' \tif (condition) {',
			'-\t\tdata.value = 1;',
			'+\t\tdata.value = 42;',
			'+\t\tdata.extra = true;',
			' \t\tdata.name = "test";',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('capture.ts');
		expect(content).toContain('\t\tdata.value = 42;');
		expect(content).toContain('\t\tdata.extra = true;');
		expect(content).toContain('\t\tdata.name = "test";');
	});

	it('Multi-file patch: all files get correct indentation independently', async () => {
		await writeTestFile(
			'a.yml',
			['config:', '  port: 3000', '  host: localhost'].join('\n'),
		);
		await writeTestFile(
			'b.ts',
			['function init() {', '  return true;', '}'].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: a.yml',
			' config:',
			'-  port: 3000',
			'+  port: 8080',
			'*** Update File: b.ts',
			' function init() {',
			'-  return true;',
			'+  return false;',
			' }',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const yamlContent = await readTestFile('a.yml');
		const tsContent = await readTestFile('b.ts');
		expect(yamlContent).toContain('  port: 8080');
		expect(tsContent).toContain('  return false;');
	});
});

describe('patch apply — +1 extra space regression (research bug)', () => {
	it('does NOT add extra space when model context is off by 1 but add line is correct', async () => {
		await writeTestFile(
			'release.yml',
			[
				'      matrix:',
				'        include:',
				'          - platform: macos-latest',
				'            target: aarch64-apple-darwin',
				'          - platform: ubuntu-latest',
				'            target: x86_64-unknown-linux-gnu',
				'            name: Linux-x64',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: release.yml',
			'@@ matrix linux entry',
			'         - platform: macos-latest',
			'           target: aarch64-apple-darwin',
			'-         - platform: ubuntu-latest',
			'+          - platform: ubuntu-22.04',
			'           target: x86_64-unknown-linux-gnu',
			'           name: Linux-x64',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('release.yml');
		const lines = content.split('\n');
		const ubuntuLine = lines.find((l: string) => l.includes('ubuntu-22.04'));
		expect(ubuntuLine).toBe('          - platform: ubuntu-22.04');
	});

	it('does NOT add extra space when model context has 1 fewer space', async () => {
		await writeTestFile(
			'workflow.yml',
			[
				'jobs:',
				'  build:',
				'    steps:',
				'      - name: Test',
				'        run: npm test',
				'      - name: Deploy',
				'        run: deploy.sh',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: workflow.yml',
			'     - name: Test',
			'-       run: npm test',
			'+        run: npm run test:ci',
			'     - name: Deploy',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('workflow.yml');
		const lines = content.split('\n');
		const testLine = lines.find((l: string) => l.includes('test:ci'));
		expect(testLine).toBe('        run: npm run test:ci');
	});

	it('DOES adjust when model is consistently very wrong (off by 8+)', async () => {
		await writeTestFile(
			'deep.yml',
			[
				'      matrix:',
				'        include:',
				'          - platform: ubuntu-latest',
				'            target: x64',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: deep.yml',
			' include:',
			'-  - platform: ubuntu-latest',
			'+  - platform: ubuntu-22.04',
			'   target: x64',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('deep.yml');
		const lines = content.split('\n');
		const ubuntuLine = lines.find((l: string) => l.includes('ubuntu-22.04'));
		expect(ubuntuLine).toBe('          - platform: ubuntu-22.04');
	});

	it('Tab file with spaces in patch: converts added lines to tabs', async () => {
		await writeTestFile(
			'tabfile.ts',
			[
				'export function process() {',
				'\tconst items = [];',
				'\tfor (const item of data) {',
				'\t\titems.push(item);',
				'\t}',
				'\treturn items;',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: tabfile.ts',
			'  for (const item of data) {',
			'-    items.push(item);',
			'+    items.push(item);',
			'+    items.push(item.clone());',
			'  }',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('tabfile.ts');
		expect(content).toContain('\t\titems.push(item);');
		expect(content).toContain('\t\titems.push(item.clone());');
		expect(content).not.toContain('    items.push');
	});

	it('Tab file with spaces in patch: preserves tabs for replaced lines', async () => {
		await writeTestFile(
			'capture2.ts',
			[
				'const READ_ONLY = new Set([',
				"\t'read',",
				"\t'ls',",
				"\t'tree',",
				']);',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: capture2.ts',
			' const READ_ONLY = new Set([',
			"   'read',",
			"-  'ls',",
			"+  'ls',",
			"+  'glob',",
			"   'tree',",
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('capture2.ts');
		expect(content).toContain("\t'ls',");
		expect(content).toContain("\t'glob',");
		expect(content).not.toMatch(/ {2}'glob'/);
	});

	it('Scenario 1: File has spaces, LLM brings tabs', async () => {
		await writeTestFile(
			'spaces-file.ts',
			[
				'function greet() {',
				'  const name = "world";',
				'  console.log(name);',
				'  return name;',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: spaces-file.ts',
			'\tconsole.log(name);',
			'-\treturn name;',
			// biome-ignore lint/suspicious/noTemplateCurlyInString: test data - template literal in patch
			'+\treturn `Hello ${name}`;',
			'+\treturn name.toUpperCase();',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('spaces-file.ts');
		// biome-ignore lint/suspicious/noTemplateCurlyInString: test assertion - template literal content
		expect(content).toContain('  return `Hello ${name}`;');
		expect(content).toContain('  return name.toUpperCase();');
		expect(content).not.toContain('\treturn');
	});

	it('Scenario 2: File has tabs, LLM brings spaces', async () => {
		await writeTestFile(
			'tabs-file.ts',
			[
				'function greet() {',
				'\tconst name = "world";',
				'\tconsole.log(name);',
				'\treturn name;',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: tabs-file.ts',
			'  console.log(name);',
			'-  return name;',
			// biome-ignore lint/suspicious/noTemplateCurlyInString: test data - template literal in patch
			'+  return `Hello ${name}`;',
			'+  return name.toUpperCase();',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('tabs-file.ts');
		// biome-ignore lint/suspicious/noTemplateCurlyInString: test assertion - template literal content
		expect(content).toContain('\treturn `Hello ${name}`;');
		expect(content).toContain('\treturn name.toUpperCase();');
		expect(content).not.toContain('  return');
	});

	it('Scenario 3: File uses 2-space indent, LLM brings 4-space', async () => {
		await writeTestFile(
			'two-space.ts',
			[
				'function process() {',
				'  if (true) {',
				'    doStuff();',
				'    cleanup();',
				'  }',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: two-space.ts',
			'    if (true) {',
			'-        doStuff();',
			'+        doStuff();',
			'+        doMore();',
			'        cleanup();',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('two-space.ts');
		expect(content).toContain('    doStuff();');
		expect(content).toContain('    doMore();');
		expect(content).toContain('    cleanup();');
		expect(content).not.toContain('        doMore');
	});

	it('Scenario 4: File uses 4-space indent, LLM brings 2-space', async () => {
		await writeTestFile(
			'four-space.ts',
			[
				'function process() {',
				'    if (true) {',
				'        doStuff();',
				'        cleanup();',
				'    }',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: four-space.ts',
			'  if (true) {',
			'-    doStuff();',
			'+    doStuff();',
			'+    doMore();',
			'    cleanup();',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('four-space.ts');
		expect(content).toContain('        doStuff();');
		expect(content).toContain('        doMore();');
		expect(content).toContain('        cleanup();');
		expect(content).not.toMatch(/^ {4}doMore/m);
	});

	it('Scenario 5: File uses tab-size-2 (1 tab per level), LLM uses 4-space tabs', async () => {
		await writeTestFile(
			'tab2.ts',
			[
				'function process() {',
				'\tif (true) {',
				'\t\tdoStuff();',
				'\t\tcleanup();',
				'\t}',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: tab2.ts',
			'    if (true) {',
			'-        doStuff();',
			'+        doStuff();',
			'+        doMore();',
			'        cleanup();',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('tab2.ts');
		expect(content).toContain('\t\tdoStuff();');
		expect(content).toContain('\t\tdoMore();');
		expect(content).toContain('\t\tcleanup();');
		expect(content).not.toContain('        doMore');
	});

	it('Scenario 6: File uses 4-space tabs, LLM uses tab-size-2 tabs', async () => {
		await writeTestFile(
			'space4.ts',
			[
				'function process() {',
				'    if (true) {',
				'        doStuff();',
				'        cleanup();',
				'    }',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: space4.ts',
			'\tif (true) {',
			'-\t\tdoStuff();',
			'+\t\tdoStuff();',
			'+\t\tdoMore();',
			'\t\tcleanup();',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('space4.ts');
		expect(content).toContain('        doStuff();');
		expect(content).toContain('        doMore();');
		expect(content).toContain('        cleanup();');
		expect(content).not.toContain('\t\tdoMore');
	});

	it('Edge 1: Mixed indentation file — majority style wins', async () => {
		await writeTestFile(
			'mixed.ts',
			[
				'class App {',
				'\tconstructor() {',
				'\t\tthis.name = "app";',
				'\t\tthis.version = 1;',
				'\t}',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: mixed.ts',
			'  constructor() {',
			'    this.name = "app";',
			'-    this.version = 1;',
			'+    this.version = 2;',
			'+    this.ready = true;',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('mixed.ts');
		expect(content).toContain('\t\tthis.version = 2;');
		expect(content).toContain('\t\tthis.ready = true;');
	});

	it('Edge 2: No indented context lines (all at column 0)', async () => {
		await writeTestFile(
			'toplevel.ts',
			[
				'import { foo } from "./foo";',
				'import { bar } from "./bar";',
				'',
				'export const config = {};',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: toplevel.ts',
			' import { bar } from "./bar";',
			'+import { baz } from "./baz";',
			' ',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('toplevel.ts');
		expect(content).toContain('import { baz } from "./baz";');
		expect(content).not.toContain('\timport');
	});

	it('Edge 3: Added lines deeper than context', async () => {
		await writeTestFile(
			'deep-add.ts',
			['function run() {', '\tif (ready) {', '\t\texecute();', '\t}', '}'].join(
				'\n',
			),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: deep-add.ts',
			'  if (ready) {',
			'    execute();',
			'+    if (validate()) {',
			'+      log("validated");',
			'+    }',
			'  }',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('deep-add.ts');
		expect(content).toContain('\t\tif (validate()) {');
		expect(content).toContain('\t\t\tlog("validated");');
		expect(content).toContain('\t\t}');
	});

	it('Edge 4: Blank lines in additions are not indented', async () => {
		await writeTestFile(
			'blanks.ts',
			['function setup() {', '\tconst a = 1;', '\treturn a;', '}'].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: blanks.ts',
			'  const a = 1;',
			'+  const b = 2;',
			'+',
			'+  const c = 3;',
			'  return a;',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('blanks.ts');
		const lines = content.split('\n');
		expect(content).toContain('\tconst b = 2;');
		expect(content).toContain('\tconst c = 3;');
		const blankIdx = lines.findIndex(
			(l: string, i: number) =>
				l === '' && i > 0 && lines[i - 1].includes('const b'),
		);
		expect(blankIdx).toBeGreaterThan(-1);
		expect(lines[blankIdx]).toBe('');
	});

	it('Edge 5: Pure addition with no context lines', async () => {
		await writeTestFile(
			'nocontext.ts',
			['const x = 1;', 'const y = 2;'].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: nocontext.ts',
			'@@ after line 2',
			'+const z = 3;',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('nocontext.ts');
		expect(content).toContain('const z = 3;');
	});

	it('Edge 6: Go-style tab-size-4 file with 4-space LLM patch', async () => {
		await writeTestFile(
			'main.go',
			[
				'func main() {',
				'\tfmt.Println("hello")',
				'\tfmt.Println("world")',
				'\treturn',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: main.go',
			'    fmt.Println("hello")',
			'-    fmt.Println("world")',
			'+    fmt.Println("universe")',
			'+    fmt.Println("galaxy")',
			'    return',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('main.go');
		expect(content).toContain('\tfmt.Println("universe")');
		expect(content).toContain('\tfmt.Println("galaxy")');
		expect(content).not.toContain('    fmt.Println("galaxy")');
	});

	it('TabSize inference: Go tabSize=4, file has tabs, LLM sends 4-space-per-tab', async () => {
		await writeTestFile(
			'handler.go',
			[
				'func handler(w http.ResponseWriter, r *http.Request) {',
				'\tif r.Method == "GET" {',
				'\t\tfmt.Fprintln(w, "hello")',
				'\t\tfmt.Fprintln(w, "world")',
				'\t}',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: handler.go',
			'    if r.Method == "GET" {',
			'        fmt.Fprintln(w, "hello")',
			'-        fmt.Fprintln(w, "world")',
			'+        fmt.Fprintln(w, "universe")',
			'+        fmt.Fprintln(w, "galaxy")',
			'    }',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('handler.go');
		expect(content).toContain('\t\tfmt.Fprintln(w, "universe")');
		expect(content).toContain('\t\tfmt.Fprintln(w, "galaxy")');
		expect(content).not.toContain('        fmt.Fprintln');
	});

	it('TabSize inference: tabSize=8, file has tabs, LLM sends 8-space-per-tab', async () => {
		await writeTestFile(
			'makefile-like.txt',
			['all:', '\techo "building"', '\techo "testing"', '\techo "done"'].join(
				'\n',
			),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: makefile-like.txt',
			'        echo "building"',
			'-        echo "testing"',
			'+        echo "linting"',
			'+        echo "testing"',
			'        echo "done"',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('makefile-like.txt');
		expect(content).toContain('\techo "linting"');
		expect(content).toContain('\techo "testing"');
		expect(content).not.toContain('        echo "linting"');
	});

	it('TabSize inference: Go nested tabSize=4, deep nesting preserved', async () => {
		await writeTestFile(
			'nested.go',
			[
				'func process() {',
				'\tfor _, item := range items {',
				'\t\tif item.Valid {',
				'\t\t\tfmt.Println(item.Name)',
				'\t\t}',
				'\t}',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: nested.go',
			'        if item.Valid {',
			'-            fmt.Println(item.Name)',
			'+            fmt.Println(item.Name)',
			'+            item.Process()',
			'        }',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('nested.go');
		expect(content).toContain('\t\t\tfmt.Println(item.Name)');
		expect(content).toContain('\t\t\titem.Process()');
		expect(content).not.toContain('            item.Process');
	});

	it('TabSize inference: 4-space file, LLM sends 2-space, infers correctly', async () => {
		await writeTestFile(
			'java-style.ts',
			[
				'class App {',
				'    constructor() {',
				'        this.name = "app";',
				'        this.port = 3000;',
				'    }',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: java-style.ts',
			'  constructor() {',
			'    this.name = "app";',
			'-    this.port = 3000;',
			'+    this.port = 8080;',
			'+    this.host = "0.0.0.0";',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('java-style.ts');
		expect(content).toContain('        this.port = 8080;');
		expect(content).toContain('        this.host = "0.0.0.0";');
	});
});

describe('patch apply — markdown horizontal rules (---)', () => {
	it('treats bare --- as context line, not a remove of --', async () => {
		await writeTestFile(
			'doc.md',
			[
				'# Section 1',
				'',
				'Content here.',
				'',
				'---',
				'',
				'# Section 2',
				'',
				'More content.',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: doc.md',
			' Content here.',
			' ',
			' ---',
			' ',
			'-# Section 2',
			'+# Section 2 (Updated)',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('doc.md');
		expect(content).toContain('---');
		expect(content).toContain('# Section 2 (Updated)');
		expect(content).not.toContain('# Section 2\n');
	});

	it('preserves --- horizontal rules when used as context without space prefix', async () => {
		await writeTestFile(
			'readme.md',
			['# Title', '', '---', '', '## Subtitle'].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: readme.md',
			' # Title',
			' ',
			'---',
			' ',
			'-## Subtitle',
			'+## New Subtitle',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('readme.md');
		expect(content).toContain('---');
		expect(content).toContain('## New Subtitle');
	});
});

describe('patch apply — deeply nested YAML +1 space bug', () => {
	it('does not add +1 space when inserting new YAML entries in deep nesting', async () => {
		await writeTestFile(
			'release.yml',
			[
				'jobs:',
				'  build-desktop:',
				'    strategy:',
				'      matrix:',
				'        include:',
				'          - platform: macos-latest',
				'            target: aarch64-apple-darwin',
				'            name: macOS-arm64',
				'          - platform: ubuntu-22.04',
				'            target: x86_64-unknown-linux-gnu',
				'            name: Linux-x64',
				'    steps:',
				'      - uses: actions/checkout@v4',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: release.yml',
			'@@ matrix - add windows',
			'           - platform: ubuntu-22.04',
			'             target: x86_64-unknown-linux-gnu',
			'             name: Linux-x64',
			'+          - platform: windows-latest',
			'+            target: x86_64-pc-windows-msvc',
			'+            name: Windows-x64',
			'     steps:',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('release.yml');
		const lines = content.split('\n');

		const winLine = lines.find((l: string) => l.includes('windows-latest'));
		expect(winLine).toBe('          - platform: windows-latest');

		const targetLine = lines.find((l: string) => l.includes('windows-msvc'));
		expect(targetLine).toBe('            target: x86_64-pc-windows-msvc');

		const nameLine = lines.find((l: string) => l.includes('Windows-x64'));
		expect(nameLine).toBe('            name: Windows-x64');
	});
});

describe('patch apply — markdown bullet removal (-- collision)', () => {
	it('correctly removes and replaces bullet lines', async () => {
		await writeTestFile(
			'README.md',
			[
				'# Tech Stack',
				'',
				'- [Tauri v2](https://tauri.app) (Rust backend)',
				'- React 19, Vite, Tailwind CSS (frontend)',
				'- `@ottocode/web-sdk` for UI components',
				'',
				'## Development',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: README.md',
			' # Tech Stack',
			' ',
			'-- [Tauri v2](https://tauri.app) (Rust backend)',
			'-- React 19, Vite, Tailwind CSS (frontend)',
			'+- [Tauri v2](https://tauri.app) (Rust backend + IPC)',
			'+- React 19, Vite, Tailwind CSS (frontend UI)',
			' - `@ottocode/web-sdk` for UI components',
			'+- Native platform APIs via Tauri plugins',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('README.md');
		expect(content).toContain(
			'- [Tauri v2](https://tauri.app) (Rust backend + IPC)',
		);
		expect(content).toContain('- React 19, Vite, Tailwind CSS (frontend UI)');
		expect(content).toContain('- `@ottocode/web-sdk` for UI components');
		expect(content).toContain('- Native platform APIs via Tauri plugins');
		expect(content).not.toContain('(Rust backend)\n');
		expect(content).not.toContain('CSS (frontend)\n');

		const bulletLines = content
			.split('\n')
			.filter((l: string) => l.startsWith('- '));
		expect(bulletLines.length).toBe(4);
	});
});

describe('patch apply — allowRejects hunk-level safety', () => {
	it('applies valid hunks and skips invalid ones without corruption', async () => {
		await writeTestFile(
			'test.ts',
			[
				'function test() {',
				'  const a = 1;',
				'  const b = 2;',
				'  const c = 3;',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: test.ts',
			'@@ first hunk - valid',
			' function test() {',
			'-  const a = 1;',
			'+  const a = 100;',
			'   const b = 2;',
			'@@ second hunk - invalid context',
			' function nonexistent() {',
			'-  const x = 1;',
			'+  const x = 999;',
			' }',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch, { allowRejects: true });
		const content = await readTestFile('test.ts');
		expect(content).toContain('const a = 100;');
		expect(content).toContain('const b = 2;');
		expect(content).toContain('const c = 3;');
		expect(content).not.toContain('const x = 999;');
		expect(content).not.toContain('nonexistent');
	});

	it('rejects entire operation when all hunks fail', async () => {
		await writeTestFile(
			'test.ts',
			['function test() {', '  const a = 1;', '}'].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: test.ts',
			' function wrong() {',
			'-  const z = 99;',
			'+  const z = 100;',
			'*** End Patch',
		].join('\n');

		const result = await applyPatch(patch, { allowRejects: true });
		expect(result.rejected.length).toBe(1);
		const content = await readTestFile('test.ts');
		expect(content).toContain('const a = 1;');
		expect(content).not.toContain('const z');
	});
});

describe('patch apply — pure addition indentation correction', () => {
	it('converts pure addition from spaces to tabs when file uses tabs', async () => {
		await writeTestFile(
			'capture.ts',
			[
				'const READ_ONLY_TOOLS = new Set([',
				"\t'read',",
				"\t'ls',",
				"\t'tree',",
				"\t'git_status',",
				']);',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: capture.ts',
			" \t'git_status',",
			"+  'websearch',",
			' ]);',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('capture.ts');
		const wsLine = content
			.split('\n')
			.find((l: string) => l.includes('websearch'));
		expect(wsLine).toStartWith('\t');
		expect(wsLine).not.toMatch(/^ {2}/);
	});
});

describe('patch apply — fuzzy match false positive prevention', () => {
	it('rejects patch when context line content is completely different', async () => {
		await writeTestFile(
			'error-test.ts',
			['function correctName() {', '  const a = 1;', '  return a;', '}'].join(
				'\n',
			),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: error-test.ts',
			' function wrongName() {',
			'-  const a = 1;',
			'+  const a = 999;',
			'   return a;',
			'*** End Patch',
		].join('\n');

		expect(() => applyPatch(patch)).toThrow('Failed to apply patch hunk');
	});

	it('still applies when removal lines are missing but context matches', async () => {
		await writeTestFile(
			'partial.ts',
			['function process() {', '  const b = 2;', '  return b;', '}'].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: partial.ts',
			' function process() {',
			'-  const a = 1;',
			'-  const b = 2;',
			'+  const b = 20;',
			'   return b;',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('partial.ts');
		expect(content.trim()).toBe(
			['function process() {', '  const b = 20;', '  return b;', '}'].join(
				'\n',
			),
		);
	});

	it('rejects ambiguous fallback when all removal lines are already absent', async () => {
		await writeTestFile(
			'ambiguous.txt',
			[
				'start',
				'foo',
				'bar',
				'keep1',
				'middle',
				'foo',
				'bar',
				'keep2',
				'end',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: ambiguous.txt',
			' foo',
			'-old-value',
			'+new-value',
			' bar',
			'*** End Patch',
		].join('\n');

		let errorMessage = '';
		try {
			await applyPatch(patch);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		}

		expect(errorMessage).toContain('All removal lines already absent');

		const content = await readTestFile('ambiguous.txt');
		expect(content).not.toContain('new-value');
		expect(content).toContain('keep1');
	});

	it('rejects when context line has wrong identifier despite same structure', async () => {
		await writeTestFile(
			'ident.ts',
			[
				'class UserService {',
				'  async getUser(id: string) {',
				'    return db.find(id);',
				'  }',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: ident.ts',
			' class OrderService {',
			'   async getUser(id: string) {',
			'-    return db.find(id);',
			'+    return db.findOne(id);',
			'   }',
			'*** End Patch',
		].join('\n');

		expect(() => applyPatch(patch)).toThrow('Failed to apply patch hunk');
	});
});

describe('patch apply — deeply nested YAML with Update File format', () => {
	it('handles 12-space nested YAML insertion without +1 bug', async () => {
		await writeTestFile(
			'deep-workflow.yml',
			[
				'jobs:',
				'  build:',
				'    strategy:',
				'      matrix:',
				'        include:',
				'          - os: ubuntu-22.04',
				'            arch: x64',
				'            runner: ubuntu-latest',
				'          - os: macos-14',
				'            arch: arm64',
				'            runner: macos-latest',
				'    steps:',
				'      - uses: actions/checkout@v4',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: deep-workflow.yml',
			'@@ add windows to matrix',
			'           - os: macos-14',
			'             arch: arm64',
			'             runner: macos-latest',
			'+          - os: windows-latest',
			'+            arch: x64',
			'+            runner: windows-latest',
			'     steps:',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('deep-workflow.yml');
		const lines = content.split('\n');

		const winLine = lines.find(
			(l: string) => l.includes('windows-latest') && l.includes('os:'),
		);
		expect(winLine).toBe('          - os: windows-latest');

		const winIdx = lines.indexOf(winLine as string);
		const archLine = lines[winIdx + 1];
		expect(archLine).toBe('            arch: x64');

		const runnerLine = lines[winIdx + 2];
		expect(runnerLine).toBe('            runner: windows-latest');
	});

	it('handles deeply nested YAML replacement without extra space', async () => {
		await writeTestFile(
			'deep-ci.yml',
			[
				'on:',
				'  workflow_dispatch:',
				'    inputs:',
				'      environment:',
				'        type: choice',
				'        options:',
				'          - staging',
				'          - production',
				'        default: staging',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: deep-ci.yml',
			'           - staging',
			'-          - production',
			'+          - production',
			'+          - canary',
			'         default: staging',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('deep-ci.yml');
		const canaryLine = content
			.split('\n')
			.find((l: string) => l.includes('canary'));
		expect(canaryLine).toBe('          - canary');
	});
});

describe('patch apply — markdown bullets with - prefix in remove lines', () => {
	it('handles removing bullet starting with link syntax', async () => {
		await writeTestFile(
			'features.md',
			[
				'## Features',
				'',
				'- [React](https://react.dev) for UI',
				'- [Vite](https://vitejs.dev) for bundling',
				'- [Tailwind](https://tailwindcss.com) for styling',
				'',
				'## Setup',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: features.md',
			' ## Features',
			' ',
			'-- [React](https://react.dev) for UI',
			'+- [React 19](https://react.dev) for UI',
			' - [Vite](https://vitejs.dev) for bundling',
			'-- [Tailwind](https://tailwindcss.com) for styling',
			'+- [Tailwind v4](https://tailwindcss.com) for styling',
			'+- [Biome](https://biomejs.dev) for linting',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('features.md');
		expect(content).toContain('- [React 19](https://react.dev) for UI');
		expect(content).toContain('- [Vite](https://vitejs.dev) for bundling');
		expect(content).toContain(
			'- [Tailwind v4](https://tailwindcss.com) for styling',
		);
		expect(content).toContain('- [Biome](https://biomejs.dev) for linting');
		expect(content).not.toContain('- [React](https://react.dev) for UI');
		expect(content).not.toContain(
			'- [Tailwind](https://tailwindcss.com) for styling',
		);

		const bullets = content
			.split('\n')
			.filter((l: string) => l.startsWith('- '));
		expect(bullets.length).toBe(4);
	});

	it('handles nested bullet list removal and addition', async () => {
		await writeTestFile(
			'nested-bullets.md',
			[
				'# Guide',
				'',
				'- Step 1: Install',
				'  - Run `npm install`',
				'  - Run `npm build`',
				'- Step 2: Configure',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: nested-bullets.md',
			' - Step 1: Install',
			'-  - Run `npm install`',
			'-  - Run `npm build`',
			'+  - Run `bun install`',
			'+  - Run `bun build`',
			' - Step 2: Configure',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('nested-bullets.md');
		expect(content).toContain('  - Run `bun install`');
		expect(content).toContain('  - Run `bun build`');
		expect(content).not.toContain('npm install');
	});
});

describe('patch apply — allowRejects content leakage prevention', () => {
	it('does not leak rejected hunk content into applied file', async () => {
		await writeTestFile(
			'multi-hunk.ts',
			[
				'function alpha() {',
				'  const x = 1;',
				'  return x;',
				'}',
				'',
				'function beta() {',
				'  const y = 2;',
				'  return y;',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: multi-hunk.ts',
			'@@ hunk 1 - valid change to alpha',
			' function alpha() {',
			'-  const x = 1;',
			'+  const x = 100;',
			'   return x;',
			'@@ hunk 2 - invalid context (gamma doesnt exist)',
			' function gamma() {',
			'-  const z = 3;',
			'+  const z = 300;',
			'   return z;',
			' }',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch, { allowRejects: true });
		const content = await readTestFile('multi-hunk.ts');

		expect(content).toContain('const x = 100;');
		expect(content).toContain('const y = 2;');
		expect(content).not.toContain('const z = 300;');
		expect(content).not.toContain('gamma');
		expect(content).not.toContain('const z');

		const lines = content.split('\n');
		expect(lines.length).toBe(10);
	});

	it('preserves original file when all hunks rejected', async () => {
		await writeTestFile(
			'pristine.ts',
			['const version = 1;', 'const name = "otto";'].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: pristine.ts',
			' const nonexistent = true;',
			'-const also_nonexistent = false;',
			'+const replaced = true;',
			'*** End Patch',
		].join('\n');

		const result = await applyPatch(patch, { allowRejects: true });
		expect(result.rejected.length).toBe(1);
		const content = await readTestFile('pristine.ts');
		expect(content).toContain('const version = 1;');
		expect(content).toContain('const name = "otto";');
		expect(content).not.toContain('replaced');
	});
});

describe('patch apply — already-applied detection with content at different positions', () => {
	it('does not duplicate content when same addition applied twice', async () => {
		await writeTestFile(
			'dedup.ts',
			[
				'import { foo } from "./foo";',
				'import { bar } from "./bar";',
				'import { baz } from "./baz";',
				'',
				'export const config = {};',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: dedup.ts',
			' import { bar } from "./bar";',
			'+import { qux } from "./qux";',
			' import { baz } from "./baz";',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		let content = await readTestFile('dedup.ts');
		expect(content).toContain('import { qux } from "./qux";');

		await applyPatch(patch);
		content = await readTestFile('dedup.ts');
		const quxCount = content
			.split('\n')
			.filter((l: string) => l.includes('qux')).length;
		expect(quxCount).toBe(1);
	});

	it('does not duplicate YAML entries when applied twice', async () => {
		await writeTestFile(
			'dedup.yml',
			['items:', '  - item1', '  - item2'].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Update File: dedup.yml',
			'   - item2',
			'+  - item3',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		let content = await readTestFile('dedup.yml');
		expect(content).toContain('  - item3');

		await applyPatch(patch);
		content = await readTestFile('dedup.yml');
		const item3Count = content
			.split('\n')
			.filter((l: string) => l.trim() === '- item3').length;
		expect(item3Count).toBe(1);
	});
});

describe('patch apply — tab file with zero-indent context lines', () => {
	it('converts space-indented additions to tabs when context lines have no indentation', async () => {
		const file = [
			'const READ_ONLY = new Set([',
			"\t'read',",
			"\t'ls',",
			']);',
			'',
			"const MUTATING = new Set(['write', 'edit']);",
			'',
			'export function run() {',
			"\tconsole.log('hello');",
			'}',
		].join('\n');
		await writeTestFile('capture.ts', file);

		const patch = [
			'*** Begin Patch',
			'*** Update File: capture.ts',
			'@@ after MUTATING',
			" const MUTATING = new Set(['write', 'edit']);",
			' ',
			'+const MONITORING = new Set([',
			"+  'bash',",
			"+  'http',",
			'+]);',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('capture.ts');
		const lines = content.split('\n');
		const monitoringIdx = lines.findIndex((l: string) =>
			l.includes('MONITORING'),
		);
		expect(monitoringIdx).toBeGreaterThan(-1);
		expect(lines[monitoringIdx + 1]).toBe("\t'bash',");
		expect(lines[monitoringIdx + 2]).toBe("\t'http',");
	});

	it('preserves space indentation when file uses spaces', async () => {
		const file = [
			'const READ_ONLY = new Set([',
			"  'read',",
			"  'ls',",
			']);',
			'',
			"const MUTATING = new Set(['write', 'edit']);",
			'',
			'export function run() {',
			"  console.log('hello');",
			'}',
		].join('\n');
		await writeTestFile('capture-spaces.ts', file);

		const patch = [
			'*** Begin Patch',
			'*** Update File: capture-spaces.ts',
			'@@ after MUTATING',
			" const MUTATING = new Set(['write', 'edit']);",
			' ',
			'+const MONITORING = new Set([',
			"+  'bash',",
			"+  'http',",
			'+]);',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('capture-spaces.ts');
		const lines = content.split('\n');
		const monitoringIdx = lines.findIndex((l: string) =>
			l.includes('MONITORING'),
		);
		expect(monitoringIdx).toBeGreaterThan(-1);
		expect(lines[monitoringIdx + 1]).toBe("  'bash',");
		expect(lines[monitoringIdx + 2]).toBe("  'http',");
	});
});

describe('patch apply — Replace mode robustness', () => {
	it('applies Replace when Find has tab/space mismatch with file', async () => {
		await writeTestFile(
			'tabs.ts',
			[
				'function main() {',
				'\tconst port = 3000;',
				'\tconst host = "localhost";',
				'\treturn port;',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Replace in: tabs.ts',
			'*** Find:',
			'  const port = 3000;',
			'  const host = "localhost";',
			'*** With:',
			'  const port = 8080;',
			'  const host = "0.0.0.0";',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('tabs.ts');
		expect(content).toContain('\tconst port = 8080;');
		expect(content).toContain('\tconst host = "0.0.0.0";');
		expect(content).not.toContain('  const port');
	});

	it('applies Replace when Find has stale middle line (anchored range fallback)', async () => {
		await writeTestFile(
			'stale.ts',
			[
				'const port = 3000;',
				'const host = "0.0.0.0";',
				'const debug = false;',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Replace in: stale.ts',
			'*** Find:',
			'const port = 3000;',
			'const host = "localhost";',
			'const debug = false;',
			'*** With:',
			'const port = 8080;',
			'const host = "0.0.0.0";',
			'const debug = true;',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('stale.ts');
		expect(content).toContain('const port = 8080;');
		expect(content).toContain('const debug = true;');
	});

	it('rejects Replace when too few Find lines match (<50%)', async () => {
		await writeTestFile(
			'reject.ts',
			['const alpha = 1;', 'const beta = 2;', 'const gamma = 3;'].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Replace in: reject.ts',
			'*** Find:',
			'const alpha = 1;',
			'const x = 2;',
			'const y = 3;',
			'*** With:',
			'const a = 10;',
			'const b = 20;',
			'const c = 30;',
			'*** End Patch',
		].join('\n');

		expect(() => applyPatch(patch)).toThrow('Failed to apply patch hunk');
	});

	it('handles Replace idempotency (applying same patch twice)', async () => {
		await writeTestFile('idem.ts', ['const x = 1;', 'const y = 2;'].join('\n'));

		const patch = [
			'*** Begin Patch',
			'*** Replace in: idem.ts',
			'*** Find:',
			'const x = 1;',
			'*** With:',
			'const x = 99;',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		let content = await readTestFile('idem.ts');
		expect(content).toContain('const x = 99;');

		await applyPatch(patch);
		content = await readTestFile('idem.ts');
		expect(content).toContain('const x = 99;');
		expect(content).not.toContain('const x = 1;');
	});

	it('handles Replace with trailing whitespace mismatch', async () => {
		await writeTestFile('ws.ts', 'const x = 1;  \nconst y = 2;\n');

		const patch = [
			'*** Begin Patch',
			'*** Replace in: ws.ts',
			'*** Find:',
			'const x = 1;',
			'*** With:',
			'const x = 99;',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('ws.ts');
		expect(content).toContain('const x = 99;');
	});

	it('handles Replace with blank lines in Find/With blocks', async () => {
		await writeTestFile(
			'blank.ts',
			[
				'function a() {',
				'  return 1;',
				'}',
				'',
				'function b() {',
				'  return 2;',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Replace in: blank.ts',
			'*** Find:',
			'function a() {',
			'  return 1;',
			'}',
			'',
			'function b() {',
			'*** With:',
			'function a() {',
			'  return 10;',
			'}',
			'',
			'function b() {',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('blank.ts');
		expect(content).toContain('return 10');
	});

	it('handles Replace YAML with deep indentation correction', async () => {
		await writeTestFile(
			'deep.yml',
			[
				'jobs:',
				'  build:',
				'    strategy:',
				'      matrix:',
				'        include:',
				'          - platform: ubuntu-latest',
				'            target: x64',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Replace in: deep.yml',
			'*** Find:',
			'  - platform: ubuntu-latest',
			'    target: x64',
			'*** With:',
			'  - platform: ubuntu-22.04',
			'    target: x64',
			'    runner: ubuntu-latest',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('deep.yml');
		expect(content).toContain('          - platform: ubuntu-22.04');
		expect(content).toContain('            runner: ubuntu-latest');
	});

	it('handles Replace with ambiguous match (picks first occurrence)', async () => {
		await writeTestFile(
			'ambig.ts',
			[
				'function a() {',
				'  return 1;',
				'}',
				'',
				'function b() {',
				'  return 1;',
				'}',
			].join('\n'),
		);

		const patch = [
			'*** Begin Patch',
			'*** Replace in: ambig.ts',
			'*** Find:',
			'function b() {',
			'  return 1;',
			'}',
			'*** With:',
			'function b() {',
			'  return 2;',
			'}',
			'*** End Patch',
		].join('\n');

		await applyPatch(patch);
		const content = await readTestFile('ambig.ts');
		const returnLines = content
			.split('\n')
			.filter((l: string) => l.includes('return'));
		expect(returnLines).toEqual(['  return 1;', '  return 2;']);
	});
});
