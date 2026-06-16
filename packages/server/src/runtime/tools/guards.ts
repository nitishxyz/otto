import { resolve as resolvePath } from 'node:path';

export type GuardAction =
	| { type: 'block'; reason: string }
	| { type: 'approve'; reason: string }
	| { type: 'allow' };

export type GuardContext = {
	projectRoot?: string;
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
			return guardShellCommand(String(a.cmd ?? ''));
		case 'terminal':
			return guardTerminal(a);
		case 'read':
			return guardReadPath(String(a.path ?? ''), context.projectRoot);
		case 'write':
			return guardWritePath(toolName, a);
		case 'copy_into':
			return guardCopyIntoPath(a, context.projectRoot);
		default:
			return { type: 'allow' };
	}
}

function guardShellCommand(cmd: string): GuardAction {
	const n = cmd.trim();
	if (!n) return { type: 'allow' };

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

function guardTerminal(args: Record<string, unknown>): GuardAction {
	const op = String(args.operation ?? '');
	if (op === 'start' && typeof args.command === 'string') {
		return guardShellCommand(args.command);
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

function isPathInProject(path: string, projectRoot?: string): boolean {
	if (!projectRoot || !isAbsoluteLike(path)) return false;
	const root = resolvePath(projectRoot);
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

function guardReadPath(path: string, projectRoot?: string): GuardAction {
	if (!path) return { type: 'allow' };
	const p = path.trim();

	for (const { pattern, reason } of BLOCKED_READ_PATHS) {
		if (pattern.test(p)) return { type: 'block', reason };
	}
	for (const { pattern, reason } of SENSITIVE_READ_PATHS) {
		if (pattern.test(p)) return { type: 'approve', reason };
	}
	if (isPathInProject(p, projectRoot)) {
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
	_toolName: string,
	args: Record<string, unknown>,
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

	for (const { pattern, reason } of SENSITIVE_WRITE_PATHS) {
		if (pattern.test(p)) return { type: 'approve', reason };
	}
	return { type: 'allow' };
}

function guardCopyIntoPath(
	args: Record<string, unknown>,
	projectRoot?: string,
): GuardAction {
	const writeGuard = guardWritePath('copy_into', args);
	if (writeGuard.type === 'block') return writeGuard;

	const sourcePath = typeof args.sourcePath === 'string' ? args.sourcePath : '';
	const readGuard = guardReadPath(sourcePath, projectRoot);
	if (readGuard.type === 'block') return readGuard;
	if (writeGuard.type === 'approve') return writeGuard;
	if (readGuard.type === 'approve') return readGuard;
	return { type: 'allow' };
}
