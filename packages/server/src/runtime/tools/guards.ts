import { resolve as resolvePath } from 'node:path';
import { getTerminalExecutableInput } from '@ottocode/sdk/tools/builtin/terminal';
import {
	canonicalRoot,
	isAbsolutePathLike,
	isPathWithin,
	resolvePolicyPath,
	type ResolvedPath,
} from '@ottocode/sdk/tools/builtin/fs';
import { getToolPathFields, type ToolPathField } from './definitions.ts';

export type GuardAction =
	| { type: 'block'; reason: string }
	| { type: 'approve'; reason: string }
	| { type: 'allow' };

export type GuardContext = {
	projectRoot?: string;
	readOnlyRoots?: string[];
	/** Session working directory used for session-relative path fields. */
	cwd?: string;
};

/**
 * Evaluates a tool call against safety policy. Path fields are resolved to
 * their canonical (symlink-resolved) targets before any check runs.
 */
export function guardToolCall(
	toolName: string,
	args: unknown,
	context: GuardContext = {},
): GuardAction {
	const a = (args ?? {}) as Record<string, unknown>;

	switch (toolName) {
		case 'shell':
		case 'bash':
			return guardShellCommand(
				String(a.cmd ?? ''),
				context,
				resolveGuardPath(toolName, a, 'cwd', context),
			);
		case 'terminal':
			return guardTerminal(a, context);
		case 'read':
		case 'read_image':
		case 'ls':
		case 'tree':
		case 'search':
		case 'cd':
			return guardReadPath(resolveGuardPath(toolName, a, 'path', context));
		case 'write':
		case 'edit':
		case 'multiedit':
			return guardWritePath(
				resolveGuardPath(toolName, a, 'path', context) ??
					resolveGuardPath(toolName, a, 'targetPath', context) ??
					resolveGuardPath(toolName, a, 'filePath', context),
				context.readOnlyRoots,
			);
		case 'copy_into':
			return guardCopyIntoPath(a, context);
		case 'copy_attachment_to_project':
			return guardWritePath(
				resolveGuardPath(toolName, a, 'targetPath', context),
				context.readOnlyRoots,
			);
		default:
			return { type: 'allow' };
	}
}

/** A path as seen by guards: raw text plus canonical facts when known. */
type GuardPath = {
	raw: string;
	resolved?: ResolvedPath;
};

function findPathField(
	toolName: string,
	args: Record<string, unknown>,
	field: string,
): ToolPathField {
	return (
		getToolPathFields(toolName, args).find(
			(entry) => entry.field === field,
		) ?? {
			field,
			access: 'read',
			base: 'project',
		}
	);
}

function resolveGuardPath(
	toolName: string,
	args: Record<string, unknown>,
	field: string,
	context: GuardContext,
): GuardPath | undefined {
	const value = args[field];
	const pathField = findPathField(toolName, args, field);
	const raw = typeof value === 'string' ? value.trim() : '';
	const useSession =
		pathField.base === 'session' ||
		(pathField.sessionDefault && (!raw || raw === '.'));
	if (!raw && !(useSession && context.cwd)) return undefined;
	const effective = !raw || (useSession && raw === '.') ? '.' : raw;
	if (!context.projectRoot) {
		// Without a project root only absolute targets can be canonicalized;
		// relative targets are project-relative by tool contract.
		if (!isAbsolutePathLike(effective)) return { raw: effective };
		const resolved = resolvePolicyPath(effective, { projectRoot: '/' });
		const readOnlyRoot = context.readOnlyRoots?.find((root) =>
			isPathWithin(resolved.canonical, canonicalRoot(root)),
		);
		return {
			raw: effective,
			resolved: {
				...resolved,
				scope: readOnlyRoot ? 'read-only' : 'outside',
				projectRelative: undefined,
				readOnlyRoot,
			},
		};
	}
	return {
		raw: effective,
		resolved: resolvePolicyPath(
			effective,
			{
				projectRoot: context.projectRoot,
				cwd: useSession ? context.cwd : undefined,
				readOnlyRoots: context.readOnlyRoots,
			},
			{ base: useSession ? 'session' : 'project' },
		),
	};
}

function guardShellCommand(
	cmd: string,
	context: GuardContext = {},
	cwd?: GuardPath,
): GuardAction {
	const n = cmd.trim();
	if (!n) return { type: 'allow' };
	if (
		(referencesReadOnlyRoot(n, context.readOnlyRoots) ||
			isGuardPathInReadOnlyRoot(cwd, context.readOnlyRoots)) &&
		!isReadOnlyProbe(n)
	) {
		return { type: 'block', reason: 'Reference directories are read-only' };
	}

	const blocked = checkBlockedCommand(n);
	if (blocked) return { type: 'block', reason: blocked };

	const approval = checkApprovalCommand(n);
	if (approval) return { type: 'approve', reason: approval };

	return { type: 'allow' };
}

function checkBlockedCommand(cmd: string): string | null {
	if (isRecursiveDeleteRoot(cmd)) return 'Recursive delete of root filesystem';
	if (isRecursiveDeleteHome(cmd)) return 'Recursive delete of home directory';
	if (isForkBomb(cmd)) return 'Fork bomb detected';
	if (isFilesystemFormat(cmd)) return 'Filesystem format command';
	if (isRawDiskWrite(cmd)) return 'Raw disk write operation';
	return null;
}

function isRecursiveDeleteRoot(cmd: string): boolean {
	if (!/\brm\b/.test(cmd)) return false;
	if (!hasRecursiveFlag(cmd)) return false;
	return /\s['"]?\/['"]?(\s*$|\s*\*|\s*;|\s*&|\s*\|)/.test(cmd);
}

function isRecursiveDeleteHome(cmd: string): boolean {
	if (!/\brm\b/.test(cmd)) return false;
	if (!hasRecursiveFlag(cmd)) return false;
	return /\s~\/?\s*($|\*|;|&|\|)/.test(cmd);
}

function hasRecursiveFlag(cmd: string): boolean {
	return /-\w*[rR]|--recursive/.test(cmd);
}

function isForkBomb(cmd: string): boolean {
	return /:\(\)\s*\{[^}]*:\s*\|\s*:/.test(cmd);
}

function isFilesystemFormat(cmd: string): boolean {
	return /\bmkfs(\.\w+)?\s/.test(cmd);
}

function isRawDiskWrite(cmd: string): boolean {
	if (/\bdd\b/.test(cmd) && /\bof=\/dev\//.test(cmd)) return true;
	if (/>\s*\/dev\/[sv]d/.test(cmd)) return true;
	return false;
}

function checkApprovalCommand(cmd: string): string | null {
	if (/\brm\b/.test(cmd) && hasRecursiveFlag(cmd)) {
		return 'Recursive delete command';
	}
	if (/\bsudo\b/.test(cmd)) {
		return 'Privilege escalation (sudo)';
	}
	if (/\b(chmod|chown)\b/.test(cmd) && /(-\w*R|--recursive)/.test(cmd)) {
		return 'Recursive permission/ownership change';
	}
	if (/\b(curl|wget)\b/.test(cmd) && /\|\s*(bash|sh|zsh)\b/.test(cmd)) {
		return 'Remote code execution via pipe to shell';
	}
	if (/\bgit\s+push\b.*--force/.test(cmd)) {
		return 'Force push to remote';
	}
	return null;
}

function referencesReadOnlyRoot(
	command: string,
	readOnlyRoots: string[] | undefined,
): boolean {
	const normalizedCommand = normalizeForComparison(command);
	return (readOnlyRoots ?? []).some((root) =>
		[resolvePath(root), canonicalRoot(root)].some((candidate) => {
			const normalizedRoot = normalizeForComparison(candidate).replace(
				/[\\/]+$/,
				'',
			);
			const index = normalizedCommand.indexOf(normalizedRoot);
			if (index === -1) return false;
			const next = normalizedCommand[index + normalizedRoot.length];
			return next === undefined || /[\s/'"\\]/.test(next);
		}),
	);
}

function isReadOnlyProbe(command: string): boolean {
	if (/(^|[^<])>(?!>)|>>|\btee\b/.test(command)) return false;
	const segments = command
		.split(/&&|\|\||(?<!\|)\|(?!\|)|;|\n/)
		.map((segment) => segment.trim())
		.filter(Boolean);
	return segments.every((segment) => {
		const executable = segment.match(
			/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(\S+)/,
		)?.[1];
		if (!executable) return false;
		const name = executable.split('/').pop();
		if (name === 'git') {
			return /\bgit\b(?:\s+-C\s+\S+)?\s+(status|log|show|diff|branch|rev-parse|ls-files)\b/.test(
				segment,
			);
		}
		return new Set([
			'ls',
			'pwd',
			'cat',
			'head',
			'tail',
			'grep',
			'rg',
			'tree',
			'file',
			'stat',
			'wc',
			'du',
			'jq',
		]).has(name ?? '');
	});
}

function guardTerminal(
	args: Record<string, unknown>,
	context: GuardContext,
): GuardAction {
	const op = String(args.operation ?? '');
	if (op === 'start') {
		const command = getTerminalExecutableInput({
			operation: op,
			command: typeof args.command === 'string' ? args.command : undefined,
			args: Array.isArray(args.args)
				? args.args.filter((part): part is string => typeof part === 'string')
				: undefined,
			shell: typeof args.shell === 'boolean' ? args.shell : undefined,
		});
		const cwd = resolveGuardPath('terminal', args, 'cwd', context);
		if (!command) {
			return isGuardPathInReadOnlyRoot(cwd, context.readOnlyRoots)
				? { type: 'block', reason: 'Reference directories are read-only' }
				: { type: 'allow' };
		}
		return guardShellCommand(command, context, cwd);
	}
	if (op === 'write' && typeof args.input === 'string') {
		const text = executableTerminalText(
			getTerminalExecutableInput({ operation: op, input: args.input }) ?? '',
		);
		if (!text) return { type: 'allow' };
		return guardShellCommand(text, context);
	}
	return { type: 'allow' };
}

// ANSI escape sequences (CSI, OSC, and two-byte escapes) and other C0
// control characters are keystrokes, not executable text.
const ANSI_ESCAPE_PATTERN =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal control input
	/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal control input
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/**
 * Printable text from terminal `write` input with escape sequences and
 * control characters removed; line breaks become command separators.
 */
function executableTerminalText(input: string): string {
	return input
		.replace(ANSI_ESCAPE_PATTERN, '')
		.replace(CONTROL_CHAR_PATTERN, '')
		.replace(/\r\n?/g, '\n')
		.trim();
}

const BLOCKED_READ_PATHS: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /^~?\/?\.ssh\/id_/, reason: 'SSH private key access' },
	{ pattern: /^\/etc\/shadow$/, reason: 'System password hashes' },
];

const SENSITIVE_READ_PATHS: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /^\/etc\/passwd$/, reason: 'System password file' },
	{ pattern: /^~?\/?\.ssh\//, reason: 'SSH directory access' },
	{ pattern: /^~?\/?\.aws\//, reason: 'AWS credentials' },
	{ pattern: /^~?\/?\.gnupg\//, reason: 'GPG keyring' },
	{ pattern: /^~?\/?\.config\/gh\//, reason: 'GitHub CLI tokens' },
	{ pattern: /^~?\/?\.npmrc$/, reason: 'npm auth tokens' },
	{ pattern: /^~?\/?\.netrc$/, reason: 'Network credentials' },
	{ pattern: /^~?\/?\.kube\//, reason: 'Kubernetes config' },
	{ pattern: /^~?\/?\.docker\/config\.json$/, reason: 'Docker credentials' },
];

function normalizeForComparison(value: string): string {
	const withForwardSlashes = value.replace(/\\/g, '/');
	return process.platform === 'win32'
		? withForwardSlashes.toLowerCase()
		: withForwardSlashes;
}

function isGuardPathInReadOnlyRoot(
	path: GuardPath | undefined,
	readOnlyRoots: string[] | undefined,
): boolean {
	if (!path || !readOnlyRoots?.length) return false;
	if (path.resolved) {
		if (path.resolved.scope === 'read-only') return true;
		if (path.resolved.scope === 'project') return false;
		return readOnlyRoots.some((root) =>
			isPathWithin(path.resolved?.canonical ?? '', canonicalRoot(root)),
		);
	}
	return false;
}

/**
 * Forms of a path that sensitive-path patterns are matched against: the
 * raw input, the canonical target's `~/` form, and the canonical path
 * (with macOS `/private` aliases folded back).
 */
function patternCandidates(path: GuardPath): string[] {
	const candidates = new Set<string>([path.raw]);
	const resolved = path.resolved;
	if (resolved) {
		if (resolved.homeRelative) candidates.add(resolved.homeRelative);
		const canonical = normalizeForComparison(resolved.canonical);
		candidates.add(canonical);
		if (canonical.startsWith('/private/')) {
			candidates.add(canonical.slice('/private'.length));
		}
	}
	return Array.from(candidates);
}

function matchPattern(
	path: GuardPath,
	patterns: Array<{ pattern: RegExp; reason: string }>,
): string | undefined {
	const candidates = patternCandidates(path);
	for (const { pattern, reason } of patterns) {
		if (candidates.some((candidate) => pattern.test(candidate))) return reason;
	}
	return undefined;
}

function guardReadPath(path: GuardPath | undefined): GuardAction {
	if (!path?.raw) return { type: 'allow' };

	const blocked = matchPattern(path, BLOCKED_READ_PATHS);
	if (blocked) return { type: 'block', reason: blocked };
	const sensitive = matchPattern(path, SENSITIVE_READ_PATHS);
	if (sensitive) return { type: 'approve', reason: sensitive };

	if (!path.resolved) return { type: 'allow' };
	if (path.resolved.scope !== 'outside') return { type: 'allow' };
	return { type: 'approve', reason: 'Reading path outside project root' };
}

const SENSITIVE_WRITE_PATHS: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /(^|\/)\.env($|\.)/, reason: 'Writing to environment file' },
	{ pattern: /(^|\/)\.git\/hooks\//, reason: 'Writing to git hooks' },
];

function guardWritePath(
	path: GuardPath | undefined,
	readOnlyRoots?: string[],
): GuardAction {
	if (!path?.raw) return { type: 'allow' };
	if (isGuardPathInReadOnlyRoot(path, readOnlyRoots)) {
		return { type: 'block', reason: 'Reference directories are read-only' };
	}

	const candidates = [path.raw];
	if (path.resolved?.projectRelative) {
		candidates.push(path.resolved.projectRelative);
	}
	if (path.resolved) {
		candidates.push(normalizeForComparison(path.resolved.canonical));
	}
	for (const { pattern, reason } of SENSITIVE_WRITE_PATHS) {
		if (candidates.some((candidate) => pattern.test(candidate))) {
			return { type: 'approve', reason };
		}
	}
	return { type: 'allow' };
}

function guardCopyIntoPath(
	args: Record<string, unknown>,
	context: GuardContext,
): GuardAction {
	const writeGuard = guardWritePath(
		resolveGuardPath('copy_into', args, 'targetPath', context),
		context.readOnlyRoots,
	);
	if (writeGuard.type === 'block') return writeGuard;

	const readGuard = guardReadPath(
		resolveGuardPath('copy_into', args, 'sourcePath', context),
	);
	if (readGuard.type === 'block') return readGuard;
	if (writeGuard.type === 'approve') return writeGuard;
	if (readGuard.type === 'approve') return readGuard;
	return { type: 'allow' };
}
