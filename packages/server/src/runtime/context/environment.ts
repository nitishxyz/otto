import { getHomeDir } from '@ottocode/sdk';

async function detectProjectTooling(
	projectRoot: string,
): Promise<{ packageManager?: string; runtime?: string; language?: string }> {
	const { existsSync } = await import('node:fs');
	const { join } = await import('node:path');
	const result: {
		packageManager?: string;
		runtime?: string;
		language?: string;
	} = {};

	try {
		const pkgPath = join(projectRoot, 'package.json');
		if (existsSync(pkgPath)) {
			const pkg = await Bun.file(pkgPath).json();
			if (pkg.packageManager) {
				const match = String(pkg.packageManager).match(/^(bun|npm|yarn|pnpm)/);
				if (match) result.packageManager = match[1];
			}
		}
	} catch {}

	if (!result.packageManager) {
		if (
			existsSync(join(projectRoot, 'bun.lockb')) ||
			existsSync(join(projectRoot, 'bun.lock'))
		) {
			result.packageManager = 'bun';
		} else if (existsSync(join(projectRoot, 'yarn.lock'))) {
			result.packageManager = 'yarn';
		} else if (existsSync(join(projectRoot, 'pnpm-lock.yaml'))) {
			result.packageManager = 'pnpm';
		} else if (existsSync(join(projectRoot, 'package-lock.json'))) {
			result.packageManager = 'npm';
		}
	}

	if (existsSync(join(projectRoot, 'package.json'))) {
		result.runtime = result.packageManager === 'bun' ? 'bun' : 'node';
	} else if (existsSync(join(projectRoot, 'Cargo.toml'))) {
		result.language = 'rust';
	} else if (existsSync(join(projectRoot, 'go.mod'))) {
		result.language = 'go';
	} else if (
		existsSync(join(projectRoot, 'pyproject.toml')) ||
		existsSync(join(projectRoot, 'requirements.txt'))
	) {
		result.language = 'python';
	} else if (existsSync(join(projectRoot, 'Gemfile'))) {
		result.language = 'ruby';
	}

	return result;
}

export async function getEnvironmentContext(
	projectRoot: string,
): Promise<string> {
	const parts: string[] = [];

	parts.push(
		'Here is some useful information about the environment you are running in:',
	);
	parts.push('<env>');
	parts.push(`  Working directory: ${projectRoot}`);
	parts.push(
		'  This is the absolute project root. Operations default to it, so use project-relative paths and do not repeat the absolute path.',
	);

	try {
		const { existsSync } = await import('node:fs');
		const isGitRepo = existsSync(`${projectRoot}/.git`);
		parts.push(`  Is directory a git repo: ${isGitRepo ? 'yes' : 'no'}`);
	} catch {
		parts.push('  Is directory a git repo: unknown');
	}

	parts.push(`  Platform: ${process.platform}`);
	parts.push(`  Today's date: ${new Date().toDateString()}`);

	try {
		const tooling = await detectProjectTooling(projectRoot);
		if (tooling.packageManager) {
			parts.push(
				`  Package manager: ${tooling.packageManager} (ALWAYS use this for install/run/build commands)`,
			);
		}
		if (tooling.runtime) {
			parts.push(`  Runtime: ${tooling.runtime}`);
		}
		if (tooling.language) {
			parts.push(`  Primary language: ${tooling.language}`);
		}
	} catch {}

	parts.push('</env>');

	return parts.join('\n');
}

export async function getProjectTree(projectRoot: string): Promise<string> {
	try {
		const { promisify } = await import('node:util');
		const { exec } = await import('node:child_process');
		const execAsync = promisify(exec);

		const { stdout } = await execAsync(
			process.platform === 'win32'
				? 'git ls-files 2>NUL || dir /s /b /a:-d 2>NUL'
				: 'git ls-files 2>/dev/null || find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" 2>/dev/null | head -100',
			{ cwd: projectRoot, maxBuffer: 1024 * 1024 },
		);

		if (!stdout.trim()) return '';

		const files = stdout.trim().split('\n').slice(0, 100);
		return `<project>\n${files.join('\n')}\n</project>`;
	} catch {
		return '';
	}
}

export async function findInstructionFiles(
	projectRoot: string,
	options?: { guidedMode?: boolean },
): Promise<string[]> {
	const { existsSync } = await import('node:fs');
	const { join } = await import('node:path');
	const foundPaths: string[] = [];

	const localFiles = ['AGENTS.md', 'CLAUDE.md', 'CONTEXT.md'];
	if (options?.guidedMode) {
		localFiles.push('GUIDED.md');
	}
	for (const filename of localFiles) {
		let currentDir = projectRoot;
		for (let i = 0; i < 5; i++) {
			const filePath = join(currentDir, filename);
			if (existsSync(filePath)) {
				foundPaths.push(filePath);
				break;
			}
			const parentDir = join(currentDir, '..');
			if (parentDir === currentDir) break;
			currentDir = parentDir;
		}
	}

	const homeDir = getHomeDir();
	const globalFiles = [
		join(homeDir, '.config', 'otto', 'AGENTS.md'),
		join(homeDir, '.claude', 'CLAUDE.md'),
	];

	for (const filePath of globalFiles) {
		if (existsSync(filePath) && !foundPaths.includes(filePath)) {
			foundPaths.push(filePath);
		}
	}

	return foundPaths;
}

export async function loadInstructionFiles(
	projectRoot: string,
	options?: { guidedMode?: boolean },
): Promise<string> {
	const paths = await findInstructionFiles(projectRoot, options);
	if (paths.length === 0) return '';

	const contents: string[] = [];

	for (const path of paths) {
		try {
			const file = Bun.file(path);
			const content = await file.text();
			if (content.trim()) {
				contents.push(
					`\n--- Custom Instructions from ${path} ---\n${content.trim()}`,
				);
			}
		} catch {}
	}

	return contents.join('\n');
}

export async function composeEnvironmentAndInstructions(
	projectRoot: string,
	options?: { includeProjectTree?: boolean; guidedMode?: boolean },
): Promise<string> {
	const parts: string[] = [];

	const envContext = await getEnvironmentContext(projectRoot);
	parts.push(envContext);

	if (options?.includeProjectTree !== false) {
		const projectTree = await getProjectTree(projectRoot);
		if (projectTree) {
			parts.push(projectTree);
		}
	}

	const customInstructions = await loadInstructionFiles(projectRoot, {
		guidedMode: options?.guidedMode,
	});
	if (customInstructions) {
		parts.push(customInstructions);
	}

	return parts.filter(Boolean).join('\n\n');
}
