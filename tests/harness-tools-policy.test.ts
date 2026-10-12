import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	REDACTED_INPUT_VALUE,
	redactSensitiveInput,
	resolvePolicyPath,
	toExecutionPath,
} from '../packages/sdk/src/core/src/tools/policy/index.ts';
import { resolveSafePath } from '../packages/sdk/src/core/src/tools/builtin/fs/util.ts';
import {
	isToolError,
	normalizeToolOutcome,
} from '../packages/sdk/src/core/src/tools/error.ts';
import { guardToolCall } from '../packages/server/src/runtime/tools/guards.ts';
import {
	DANGEROUS_TOOLS,
	createApprovalRequest,
	getPendingApproval,
	requiresApproval,
} from '../packages/server/src/runtime/tools/approval.ts';
import {
	buildRegistrationNames,
	CANONICAL_TO_PASCAL,
	PASCAL_TO_CANONICAL,
} from '../packages/server/src/runtime/tools/mapping.ts';
import {
	boundModelOutput,
	MODEL_OUTPUT_MAX_BYTES,
	stripToolResultArtifactsForModel,
} from '../packages/server/src/tools/adapter/result-compaction.ts';
import { resolveToolExecutionArgs } from '../packages/server/src/tools/adapter/prepare.ts';

const tempDirs: string[] = [];
afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

async function makeProject() {
	const root = await mkdtemp(join(tmpdir(), 'harness-tools-policy-'));
	tempDirs.push(root);
	const project = join(root, 'project');
	const outside = join(root, 'outside');
	await mkdir(join(project, 'src'), { recursive: true });
	await mkdir(outside, { recursive: true });
	await writeFile(join(outside, 'secret.txt'), 'secret');
	await symlink(outside, join(project, 'escape'));
	return { root, project, outside };
}

describe('canonical path policy', () => {
	it('resolves symlinks of existing targets and of the nearest existing parent', async () => {
		const { project } = await makeProject();
		const existing = resolvePolicyPath('escape/secret.txt', {
			projectRoot: project,
		});
		expect(existing.exists).toBe(true);
		expect(existing.scope).toBe('outside');

		const missing = resolvePolicyPath('escape/new/file.txt', {
			projectRoot: project,
		});
		expect(missing.exists).toBe(false);
		expect(missing.scope).toBe('outside');

		const inside = resolvePolicyPath('src/new.ts', { projectRoot: project });
		expect(inside.scope).toBe('project');
		expect(toExecutionPath(inside)).toBe('src/new.ts');
	});

	it('anchors session-relative paths to the session cwd', async () => {
		const { project } = await makeProject();
		const resolved = resolvePolicyPath(
			'a.ts',
			{ projectRoot: project, cwd: 'src' },
			{ base: 'session' },
		);
		expect(resolved.projectRelative).toBe('src/a.ts');
		const projectBased = resolvePolicyPath(
			'a.ts',
			{ projectRoot: project, cwd: 'src' },
			{ base: 'project' },
		);
		expect(projectBased.projectRelative).toBe('a.ts');
	});

	it('classifies canonical read-only roots and keeps their configured form', async () => {
		const { project, outside } = await makeProject();
		const resolved = resolvePolicyPath(join(outside, 'secret.txt'), {
			projectRoot: project,
			readOnlyRoots: [outside],
		});
		expect(resolved.scope).toBe('read-only');
		expect(toExecutionPath(resolved)).toBe(join(outside, 'secret.txt'));
	});

	it('fails closed on dangling symlinks instead of treating them as new files', async () => {
		const { project, outside } = await makeProject();
		await symlink(join(outside, 'missing.txt'), join(project, 'dangling'));
		expect(() => resolveSafePath(project, 'dangling')).toThrow(
			/dangling symlink/,
		);
	});

	it('rejects fs tool paths that escape the project through a symlink', async () => {
		const { project } = await makeProject();
		expect(() => resolveSafePath(project, 'escape/secret.txt')).toThrow(
			/symlink/,
		);
		expect(() => resolveSafePath(project, '../outside')).toThrow(/escapes/);
		expect(resolveSafePath(project, 'src/a.ts')).toBe(
			join(project, 'src', 'a.ts'),
		);
	});

	it('defaults shell cwd to the session cwd but keeps explicit cwd project-relative', async () => {
		const { project } = await makeProject();
		await mkdir(join(project, 'src', 'lib'), { recursive: true });
		const context = { projectRoot: project, cwd: 'src' };
		expect(
			resolveToolExecutionArgs('shell', { cmd: 'ls', cwd: '.' }, context),
		).toEqual({ args: { cmd: 'ls', cwd: 'src' } });
		expect(resolveToolExecutionArgs('shell', { cmd: 'ls' }, context)).toEqual({
			args: { cmd: 'ls', cwd: 'src' },
		});
		expect(
			resolveToolExecutionArgs('shell', { cmd: 'ls', cwd: 'src/lib' }, context),
		).toEqual({ args: { cmd: 'ls', cwd: 'src/lib' } });
	});
});

describe('guards on canonical targets', () => {
	it('evaluates the symlink target rather than the raw relative path', async () => {
		const { project } = await makeProject();
		expect(
			guardToolCall(
				'read',
				{ path: 'escape/secret.txt' },
				{ projectRoot: project },
			).type,
		).toBe('approve');
		expect(
			guardToolCall('read', { path: 'src/a.ts' }, { projectRoot: project })
				.type,
		).toBe('allow');
	});

	it('guards read_image and absolute home sensitive paths', () => {
		const home = process.env.HOME || homedir();
		expect(
			guardToolCall('read_image', { path: join(home, '.ssh', 'id_rsa') }).type,
		).toBe('block');
		expect(
			guardToolCall('read', { path: join(home, '.aws', 'credentials') }).type,
		).toBe('approve');
	});

	it('blocks writes whose canonical target is inside a read-only root', async () => {
		const { project, outside } = await makeProject();
		expect(
			guardToolCall(
				'write',
				{ path: 'escape/secret.txt' },
				{ projectRoot: project, readOnlyRoots: [outside] },
			).type,
		).toBe('block');
	});
});

describe('terminal guard', () => {
	it('guards the assembled start command including args', () => {
		expect(
			guardToolCall('terminal', {
				operation: 'start',
				command: 'rm',
				args: ['-rf', '/'],
			}).type,
		).toBe('block');
		expect(
			guardToolCall('terminal', {
				operation: 'start',
				command: 'bash',
				args: ['-c', 'sudo reboot'],
			}).type,
		).toBe('approve');
	});

	it('guards executable write input and ignores control keystrokes', () => {
		expect(
			guardToolCall('terminal', {
				operation: 'write',
				terminalId: 't',
				input: 'rm -rf /\n',
			}).type,
		).toBe('block');
		expect(
			guardToolCall('terminal', {
				operation: 'write',
				terminalId: 't',
				input: '\u0003',
			}).type,
		).toBe('allow');
		expect(
			guardToolCall('terminal', {
				operation: 'write',
				terminalId: 't',
				input: '\u001b[A\r',
			}).type,
		).toBe('allow');
	});
});

describe('sensitive input redaction', () => {
	it('redacts direct and wildcard fields without mutating input', () => {
		const input = {
			apiKey: 'sk-1',
			env: { A: '1', B: '2' },
			headers: { Authorization: 'Bearer x' },
			name: 'keep',
		};
		const redacted = redactSensitiveInput(input, [
			{ path: 'apiKey' },
			{ path: 'env.*' },
			{ path: 'headers.*' },
		]);
		expect(redacted).toEqual({
			apiKey: REDACTED_INPUT_VALUE,
			env: { A: REDACTED_INPUT_VALUE, B: REDACTED_INPUT_VALUE },
			headers: { Authorization: REDACTED_INPUT_VALUE },
			name: 'keep',
		});
		expect(input.apiKey).toBe('sk-1');
	});
});

describe('typed tool outcomes', () => {
	it('does not treat ok:true with an error field as failure', () => {
		expect(isToolError({ ok: true, error: 'warning' })).toBe(false);
		expect(isToolError({ error: undefined })).toBe(false);
		expect(isToolError({ ok: false, error: 'x' })).toBe(true);
		expect(isToolError({ error: 'boom' })).toBe(true);
	});

	it('normalizes results into discriminated outcomes', () => {
		expect(normalizeToolOutcome({ ok: true }).status).toBe('success');
		expect(
			normalizeToolOutcome({
				ok: false,
				error: 'Blocked: x',
				details: { reason: 'safety_guard' },
			}).status,
		).toBe('blocked');
		expect(
			normalizeToolOutcome({
				ok: false,
				error: 'no',
				details: { reason: 'user_rejected' },
			}).status,
		).toBe('rejected');
		expect(
			normalizeToolOutcome({ ok: false, error: 'stop', errorType: 'abort' })
				.status,
		).toBe('aborted');
		expect(normalizeToolOutcome({ ok: false, error: 'bad' }).status).toBe(
			'error',
		);
	});
});

describe('approval policy and handles', () => {
	it('requires approval for destructive server tools', () => {
		expect(DANGEROUS_TOOLS.has('forget_memory')).toBe(true);
		expect(requiresApproval('forget_memory', 'dangerous')).toBe(true);
		expect(requiresApproval('recall_memory', 'dangerous')).toBe(false);
	});

	it('abort clears the pending approval and resolves false', async () => {
		const handle = createApprovalRequest({
			sessionId: 'harness-tools-approval',
			messageId: 'm',
			callId: 'approval-abort',
			toolName: 'shell',
			args: {},
			projectRoot: '/tmp/harness-tools-approval',
			timeoutMs: 60_000,
		});
		expect(
			getPendingApproval('approval-abort', '/tmp/harness-tools-approval'),
		).toBeDefined();
		handle.abort();
		expect(await handle.promise).toBe(false);
		expect(
			getPendingApproval('approval-abort', '/tmp/harness-tools-approval'),
		).toBeUndefined();
	});
});

describe('registration naming', () => {
	it('derives Claude Code names from the registry and rejects collisions', () => {
		expect(CANONICAL_TO_PASCAL.read).toBe('Read');
		expect(PASCAL_TO_CANONICAL.Grep).toBe('search');
		expect(PASCAL_TO_CANONICAL.Bash).toBe('shell');
		const { names, collisions } = buildRegistrationNames(
			['mcp__list', 'mcp_list', 'read'],
			true,
		);
		expect(names.get('mcp__list')).toBe('McpList');
		expect(names.has('mcp_list')).toBe(false);
		expect(names.get('read')).toBe('Read');
		expect(collisions).toEqual([
			{ registration: 'McpList', kept: 'mcp__list', rejected: 'mcp_list' },
		]);
	});
});

describe('result compaction', () => {
	it('bounds custom model outputs', () => {
		const big = 'x'.repeat(MODEL_OUTPUT_MAX_BYTES * 2);
		const text = boundModelOutput({ type: 'text', value: big });
		expect(text.type).toBe('text');
		expect(
			Buffer.byteLength((text as { value: string }).value),
		).toBeLessThanOrEqual(MODEL_OUTPUT_MAX_BYTES);
		const json = boundModelOutput({ type: 'json', value: { big } });
		expect(json.type).toBe('text');
	});

	it('caps terminal rawOutput', () => {
		const raw = ['y'.repeat(100_000)];
		const compacted = stripToolResultArtifactsForModel(
			{ ok: true, output: ['short'], rawOutput: raw },
			{ toolName: 'terminal' },
		) as { rawOutput: string[]; rawOutputTruncated?: boolean };
		expect(compacted.rawOutputTruncated).toBe(true);
		expect(compacted.rawOutput[0]?.length).toBeLessThan(30_000);
	});
});
