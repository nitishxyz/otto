import { resolve as resolvePath } from 'node:path';

export type GuardAction =
	| { type: 'block'; reason: string }
	| { type: 'approve'; reason: string }
	| { type: 'allow' };

export type GuardContext = {
	projectRoot?: string;
	readOnlyRoots?: string[];
};

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
				String(a.cwd ?? ''),
			);
		case 'terminal':
			return guardTerminal(a, context);
		case 'read':
		case 'ls':
		case 'tree':
		case 'search':
			return guardReadPath(
				String(a.path ?? ''),
				context.projectRoot,
				context.readOnlyRoots,
			);
		case 'write':
		case 'edit':
		case 'multiedit':
			return guardWritePath(a, context.readOnlyRoots);
		case 'copy_into':
			return guardCopyIntoPath(a, context.projectRoot, context.readOnlyRoots);
		default:
			return { type: 'allow' };
	}
}

function guardShellCommand(
	cmd: string,
	context: GuardContext = {},
	cwd = '',
): GuardAction {
	const n = cmd.trim();
	if (!n) return { type: 'allow' };
	if (
		(referencesReadOnlyRoot(n, context.readOnlyRoots) ||
			isPathInAnyRoot(cwd, context.readOnlyRoots)) &&
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
	return /\s\/(\s*$|\s*\*|\s*;|\s*&|\s*\|)/.test(cmd);
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
	return (readOnlyRoots ?? []).some((root) => {
		const normalizedRoot = normalizeForComparison(resolvePath(root)).replace(
			/[\\/]+$/,
			'',
		);
		const index = normalizedCommand.indexOf(normalizedRoot);
		if (index === -1) return false;
		const next = normalizedCommand[index + normalizedRoot.length];
		return next === undefined || /[\s/'"\\]/.test(next);
	});
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
	if (op === 'start' && typeof args.command === 'string') {
		return guardShellCommand(
			args.command,
			context,
			typeof args.cwd === 'string' ? args.cwd : '',
		);
	}
	return { type: 'allow' };
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

function expandTilde(path: string): string {
	const home = process.env.HOME || process.env.USERPROFILE || '';
	if (!home) return path;
	if (path === '~') return home;
	if (path.startsWith('~/')) return `${home}/${path.slice(2)}`;
	return path;
}

function isAbsoluteLike(path: string): boolean {
	return (
		path.startsWith('/') || path.startsWith('~') || /^[A-Za-z]:[\\/]/.test(path)
	);
}

function isPathInRoot(path: string, rootPath?: string): boolean {
	if (!rootPath || !isAbsoluteLike(path)) return false;
	const root = resolvePath(rootPath);
	const target = resolvePath(expandTilde(path));
	const rootNorm = (() => {
		const normalized = normalizeForComparison(root);
		if (normalized === '/') return '/';
		return normalized.replace(/[\\/]+$/, '');
	})();
	const targetNorm = normalizeForComparison(target);
	const rootWithSlash = rootNorm === '/' ? '/' : `${rootNorm}/`;
	return targetNorm === rootNorm || targetNorm.startsWith(rootWithSlash);
}

function isPathInAnyRoot(path: string, roots: string[] | undefined): boolean {
	return (
		Boolean(path) && (roots ?? []).some((root) => isPathInRoot(path, root))
	);
}

function guardReadPath(
	path: string,
	projectRoot?: string,
	readOnlyRoots?: string[],
): GuardAction {
	if (!path) return { type: 'allow' };
	const p = path.trim();

	for (const { pattern, reason } of BLOCKED_READ_PATHS) {
		if (pattern.test(p)) return { type: 'block', reason };
	}
	for (const { pattern, reason } of SENSITIVE_READ_PATHS) {
		if (pattern.test(p)) return { type: 'approve', reason };
	}
	if (isPathInRoot(p, projectRoot) || isPathInAnyRoot(p, readOnlyRoots)) {
		return { type: 'allow' };
	}
	if (isAbsoluteLike(p)) {
		return { type: 'approve', reason: 'Reading path outside project root' };
	}
	return { type: 'allow' };
}

const SENSITIVE_WRITE_PATHS: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /(^|\/)\.env($|\.)/, reason: 'Writing to environment file' },
	{ pattern: /(^|\/)\.git\/hooks\//, reason: 'Writing to git hooks' },
];

function guardWritePath(
	args: Record<string, unknown>,
	readOnlyRoots?: string[],
): GuardAction {
	const path =
		typeof args.path === 'string'
			? args.path
			: typeof args.targetPath === 'string'
				? args.targetPath
				: typeof args.filePath === 'string'
					? args.filePath
					: '';
	if (!path) return { type: 'allow' };
	const p = path.trim();
	if (isPathInAnyRoot(p, readOnlyRoots)) {
		return { type: 'block', reason: 'Reference directories are read-only' };
	}

	for (const { pattern, reason } of SENSITIVE_WRITE_PATHS) {
		if (pattern.test(p)) return { type: 'approve', reason };
	}
	return { type: 'allow' };
}

function guardCopyIntoPath(
	args: Record<string, unknown>,
	projectRoot?: string,
	readOnlyRoots?: string[],
): GuardAction {
	const writeGuard = guardWritePath(args, readOnlyRoots);
	if (writeGuard.type === 'block') return writeGuard;

	const sourcePath = typeof args.sourcePath === 'string' ? args.sourcePath : '';
	const readGuard = guardReadPath(sourcePath, projectRoot, readOnlyRoots);
	if (readGuard.type === 'block') return readGuard;
	if (writeGuard.type === 'approve') return writeGuard;
	if (readGuard.type === 'approve') return readGuard;
	return { type: 'allow' };
}
