import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'bun:test';
import { isSupportedGitReferenceUrl, loadConfig } from '@ottocode/sdk';
import { subscribeClientEvents } from '../packages/server/src/events/bus';
import type { ReferencePreparationEvent } from '../packages/server/src/events/types';
import {
	deleteReferenceClone,
	getReferenceStatuses,
	prepareReferences,
	resolveReferences,
	retryReferencePreparation,
} from '../packages/server/src/runtime/context/references';

const roots: string[] = [];
const servers: Bun.Server<unknown>[] = [];

afterEach(async () => {
	for (const server of servers.splice(0)) server.stop(true);
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe('references', () => {
	it('only accepts HTTP(S) and SSH Git reference URLs', () => {
		expect(isSupportedGitReferenceUrl('https://github.com/otto/otto.git')).toBe(
			true,
		);
		expect(isSupportedGitReferenceUrl('http://git.example.com/otto.git')).toBe(
			true,
		);
		expect(isSupportedGitReferenceUrl('ssh://git@example.com/otto.git')).toBe(
			true,
		);
		expect(isSupportedGitReferenceUrl('git@example.com:otto/otto.git')).toBe(
			true,
		);
		expect(isSupportedGitReferenceUrl('/tmp/otto.git')).toBe(false);
		expect(isSupportedGitReferenceUrl('../otto.git')).toBe(false);
		expect(isSupportedGitReferenceUrl('file:///tmp/otto.git')).toBe(false);
		expect(isSupportedGitReferenceUrl('git://example.com/otto.git')).toBe(
			false,
		);
	});

	it('resolves project-relative local directories and skips disabled entries', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-references-'));
		roots.push(projectRoot);
		const referencePath = join(projectRoot, 'docs-source');
		await mkdir(referencePath);
		const cfg = await loadConfig(projectRoot);
		cfg.references = {
			docs: {
				description: 'Use for documentation conventions',
				source: { type: 'local', path: './docs-source' },
			},
			disabled: {
				description: 'Do not expose this',
				enabled: false,
				source: { type: 'local', path: './docs-source' },
			},
		};

		const references = await resolveReferences(cfg);

		expect(references).toEqual([
			{
				name: 'docs',
				description: 'Use for documentation conventions',
				path: referencePath,
				status: 'available',
			},
		]);
		await deleteReferenceClone('docs', cfg.references.docs, {
			...cfg,
			references: {},
		});
		expect(await isDirectory(referencePath)).toBe(true);
	});

	it('omits unavailable references from agent context', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-references-'));
		roots.push(projectRoot);
		const cfg = await loadConfig(projectRoot);
		cfg.references = {
			missing: {
				description: 'Optional external source',
				source: { type: 'local', path: './missing' },
			},
		};

		const references = await resolveReferences(cfg);

		expect(references).toEqual([]);
		const statuses = await getReferenceStatuses(cfg);
		expect(statuses.missing?.status).toBe('error');
		expect(statuses.missing?.error).toBeTruthy();
	});

	it('clones Git references in the background instead of during resolution', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-references-'));
		roots.push(projectRoot);
		const sourcePath = join(projectRoot, 'source');
		const cacheDir = join(projectRoot, 'cache');
		await mkdir(sourcePath);
		await writeFile(join(sourcePath, 'README.md'), '# Reference');
		runGit(sourcePath, ['init']);
		runGit(sourcePath, ['add', 'README.md']);
		runGit(sourcePath, [
			'-c',
			'user.name=Otto Tests',
			'-c',
			'user.email=otto@example.com',
			'commit',
			'-m',
			'Initial commit',
		]);
		runGit(sourcePath, ['update-server-info']);
		const sourceUrl = serveDirectory(projectRoot, '/source/.git');
		const cfg = await loadConfig(projectRoot);
		cfg.references = {
			docs: {
				description: 'Use for documentation conventions',
				source: { type: 'git', url: sourceUrl },
			},
		};
		const testConfig = { ...cfg, paths: { ...cfg.paths, cacheDir } };

		const beforePreparation = await resolveReferences(testConfig);

		expect(beforePreparation).toEqual([]);
		const preparationEvents: ReferencePreparationEvent[] = [];
		const unsubscribe = subscribeClientEvents((event) => {
			if (event.type === 'reference.preparation') {
				preparationEvents.push(event.payload);
			}
		});
		prepareReferences(testConfig);
		let status = (await getReferenceStatuses(testConfig)).docs;
		expect(status?.status).toBe('cloning');
		expect(status?.output).toContain('Starting Git preparation...');
		for (
			let attempt = 0;
			status?.status === 'cloning' && attempt < 100;
			attempt++
		) {
			await Bun.sleep(10);
			status = (await getReferenceStatuses(testConfig)).docs;
		}
		unsubscribe();
		expect(status).toEqual({ status: 'available' });
		expect(preparationEvents[0]?.status).toBe('cloning');
		expect(
			preparationEvents.some((event) =>
				event.output?.includes('Cloning repository...'),
			),
		).toBe(true);
		expect(preparationEvents.at(-1)?.status).toBe('available');
		const [resolvedReference] = await resolveReferences(testConfig);
		expect(resolvedReference?.status).toBe('available');
		expect(resolvedReference?.path).toContain(cacheDir);
		const cachedPath = resolvedReference?.path;
		if (!cachedPath) throw new Error('Reference clone path was not resolved');

		await deleteReferenceClone('docs', testConfig.references.docs, testConfig);
		expect(await isDirectory(cachedPath)).toBe(true);

		await deleteReferenceClone('docs', testConfig.references.docs, {
			...testConfig,
			references: {},
		});
		expect(await isDirectory(cachedPath)).toBe(false);
	});

	it('keeps failed clones idle until explicitly retried', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-references-'));
		roots.push(projectRoot);
		const sourcePath = join(projectRoot, 'source');
		const sourceUrl = serveDirectory(projectRoot, '/source/.git');
		const cacheDir = join(projectRoot, 'cache');
		const cfg = await loadConfig(projectRoot);
		const reference = {
			description: 'Use for documentation conventions',
			source: { type: 'git' as const, url: sourceUrl },
		};
		cfg.references = { docs: reference };
		const testConfig = { ...cfg, paths: { ...cfg.paths, cacheDir } };

		prepareReferences(testConfig);
		const failedStatus = await waitForStatus(testConfig, 'error');
		expect(failedStatus.error).toBeTruthy();
		expect(failedStatus.output?.some((line) => line.includes('fatal:'))).toBe(
			true,
		);
		await createGitRepository(sourcePath);

		prepareReferences(testConfig);
		await Bun.sleep(20);
		expect((await getReferenceStatuses(testConfig)).docs?.status).toBe('error');

		retryReferencePreparation('docs', reference, testConfig);
		expect(await waitForStatus(testConfig, 'available')).toEqual({
			status: 'available',
		});
	});
});

async function createGitRepository(path: string): Promise<void> {
	await mkdir(path);
	await writeFile(join(path, 'README.md'), '# Reference');
	runGit(path, ['init']);
	runGit(path, ['add', 'README.md']);
	runGit(path, [
		'-c',
		'user.name=Otto Tests',
		'-c',
		'user.email=otto@example.com',
		'commit',
		'-m',
		'Initial commit',
	]);
	runGit(path, ['update-server-info']);
}

function serveDirectory(root: string, repositoryPath: string): string {
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const body = new Uint8Array(await request.arrayBuffer());
			const process = Bun.spawn(['git', 'http-backend'], {
				stdin: 'pipe',
				stdout: 'pipe',
				stderr: 'pipe',
				env: {
					...Bun.env,
					GIT_PROJECT_ROOT: root,
					GIT_HTTP_EXPORT_ALL: '1',
					PATH_INFO: decodeURIComponent(url.pathname),
					QUERY_STRING: url.search.slice(1),
					REQUEST_METHOD: request.method,
					CONTENT_TYPE: request.headers.get('content-type') ?? '',
					CONTENT_LENGTH: String(body.byteLength),
				},
			});
			if (body.byteLength > 0) process.stdin.write(body);
			process.stdin.end();
			const [exitCode, output, stderr] = await Promise.all([
				process.exited,
				new Response(process.stdout)
					.arrayBuffer()
					.then((buffer) => new Uint8Array(buffer)),
				new Response(process.stderr).text(),
			]);
			if (exitCode !== 0) {
				return new Response(stderr || 'Git HTTP backend failed', {
					status: 500,
				});
			}
			const separator = findHeaderSeparator(output);
			if (!separator) {
				return new Response('Invalid CGI response', { status: 500 });
			}
			const headerText = new TextDecoder().decode(
				output.subarray(0, separator.index),
			);
			const headers = new Headers();
			let status = 200;
			for (const line of headerText.split(/\r?\n/)) {
				const colon = line.indexOf(':');
				if (colon === -1) continue;
				const name = line.slice(0, colon);
				const value = line.slice(colon + 1).trim();
				if (name.toLowerCase() === 'status') {
					status = Number.parseInt(value, 10);
				} else {
					headers.append(name, value);
				}
			}
			return new Response(output.subarray(separator.index + separator.length), {
				status,
				headers,
			});
		},
	});
	servers.push(server);
	return `http://${server.hostname}:${server.port}${repositoryPath}`;
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

function findHeaderSeparator(
	output: Uint8Array,
): { index: number; length: number } | undefined {
	for (let index = 0; index < output.length - 1; index++) {
		if (output[index] === 10 && output[index + 1] === 10) {
			return { index, length: 2 };
		}
		if (
			output[index] === 13 &&
			output[index + 1] === 10 &&
			output[index + 2] === 13 &&
			output[index + 3] === 10
		) {
			return { index, length: 4 };
		}
	}
	return undefined;
}

async function waitForStatus(
	cfg: Awaited<ReturnType<typeof loadConfig>>,
	expected: 'available' | 'error',
) {
	for (let attempt = 0; attempt < 100; attempt++) {
		const status = (await getReferenceStatuses(cfg)).docs;
		if (status?.status === expected) return status;
		await Bun.sleep(10);
	}
	throw new Error(`Timed out waiting for reference status ${expected}`);
}

function runGit(cwd: string, args: string[]): void {
	const result = Bun.spawnSync(['git', ...args], { cwd, stderr: 'pipe' });
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.toString());
	}
}
