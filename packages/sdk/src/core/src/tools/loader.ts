import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import { buildFsTools } from './builtin/fs/index.ts';
import { buildGitTools } from './builtin/git.ts';
import { progressUpdateTool } from './builtin/progress.ts';
import { buildShellTool } from './builtin/shell.ts';
import { buildGlobTool } from './builtin/glob.ts';
import { buildApplyPatchTool } from './builtin/patch.ts';
import { updateTodosTool } from './builtin/todos.ts';
import { buildWebSearchTool } from './builtin/websearch.ts';
import { buildTerminalTool } from './builtin/terminal.ts';
import type { TerminalManager } from '../terminals/index.ts';
import {
	initializeSkills,
	buildSkillTool,
	setSkillSettings,
} from '../../../skills/index.ts';
import { getMCPManager } from '../mcp/index.ts';
import {
	getMCPToolBriefs,
	buildLoadMCPToolsTool,
	getMCPToolsRecord,
	type MCPToolBrief,
} from '../mcp/lazy-tools.ts';
import {
	buildLazyToolsRecord,
	buildLoadFirstPartyToolsTool,
} from './lazy/index.ts';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promises as fs } from 'node:fs';
import { spawn as nodeSpawn } from 'node:child_process';
import { discoverPluginFiles } from './plugin-discovery.ts';

export type DiscoveredTool = { name: string; tool: Tool };

export type DiscoverResult = {
	tools: DiscoveredTool[];
	lazyToolsRecord: Record<string, Tool>;
	mcpToolsRecord: Record<string, Tool>;
};

type PluginParameter = {
	type: 'string' | 'number' | 'boolean';
	description?: string;
	default?: string | number | boolean;
	enum?: string[];
	optional?: boolean;
};

type PluginDescriptor = {
	name?: string;
	description?: string;
	parameters?: Record<string, PluginParameter>;
	execute?: PluginExecutor;
	run?: PluginExecutor;
	handler?: PluginExecutor;
	setup?: (context: PluginContext) => unknown | Promise<unknown>;
	onInit?: (context: PluginContext) => unknown | Promise<unknown>;
};

type PluginExecutor = (args: PluginExecuteArgs) => unknown | Promise<unknown>;

type PluginExecuteArgs = {
	input: Record<string, unknown>;
	project: string;
	projectRoot: string;
	directory: string;
	worktree: string;
	exec: ExecFn;
	run: ExecFn;
	$: TemplateExecFn;
	fs: FsHelpers;
	env: Record<string, string>;
	context: PluginContext;
};

type PluginContext = {
	project: string;
	projectRoot: string;
	directory: string;
	worktree: string;
	toolDir: string;
};

type ExecFn = (
	command: string,
	args?: string[] | ExecOptions,
	options?: ExecOptions,
) => Promise<ExecResult>;

type TemplateExecFn = (
	strings: TemplateStringsArray,
	...values: unknown[]
) => Promise<ExecResult>;

type ExecOptions = {
	cwd?: string;
	env?: Record<string, string>;
	allowNonZeroExit?: boolean;
};

type ExecResult = { exitCode: number; stdout: string; stderr: string };

type FsHelpers = {
	readFile: (path: string, encoding?: BufferEncoding) => Promise<string>;
	writeFile: (path: string, content: string) => Promise<void>;
	exists: (path: string) => Promise<boolean>;
};

const legacyTerminalManagerKey = 'legacy';
const terminalManagersByProject = new Map<string, TerminalManager>();
const staticToolDiscoveryCache = new Map<string, Promise<DiscoveredTool[]>>();

function getTerminalManagerKey(projectRoot?: string): string {
	return projectRoot || legacyTerminalManagerKey;
}

export function setTerminalManager(
	manager: TerminalManager,
	projectRoot?: string,
): void {
	terminalManagersByProject.set(getTerminalManagerKey(projectRoot), manager);
}

export function unsetTerminalManager(projectRoot?: string): void {
	terminalManagersByProject.delete(getTerminalManagerKey(projectRoot));
}

export function getTerminalManager(
	projectRoot?: string,
): TerminalManager | null {
	return (
		terminalManagersByProject.get(getTerminalManagerKey(projectRoot)) ?? null
	);
}

function getStaticToolDiscoveryCacheKey(
	projectRoot: string,
	globalConfigDir?: string,
	readOnlyRoots: string[] = [],
): string {
	return `${projectRoot}::${globalConfigDir ?? ''}::${[...readOnlyRoots].sort().join('\0')}`;
}

async function discoverStaticProjectTools(
	projectRoot: string,
	globalConfigDir?: string,
	skillSettings?: {
		enabled?: boolean;
		items?: Record<string, { enabled?: boolean }>;
	},
	readOnlyRoots: string[] = [],
): Promise<DiscoveredTool[]> {
	setSkillSettings(skillSettings);
	const cacheKey = getStaticToolDiscoveryCacheKey(
		projectRoot,
		globalConfigDir,
		readOnlyRoots,
	);
	const cached = staticToolDiscoveryCache.get(cacheKey);
	if (cached) return cached;

	const discoveryPromise = (async () => {
		const tools = new Map<string, Tool>();
		const fsTools = buildFsTools(projectRoot);
		for (const { name, tool } of fsTools.filter(({ name }) => name === 'read'))
			tools.set(name, tool);
		// Put apply_patch before exact replacement tools so models see it as the
		// default editing path after reading files.
		const ap = buildApplyPatchTool(projectRoot);
		tools.set(ap.name, ap.tool);
		for (const { name, tool } of fsTools.filter(({ name }) => name !== 'read'))
			tools.set(name, tool);
		for (const { name, tool } of buildGitTools(projectRoot))
			tools.set(name, tool);
		// Built-ins
		tools.set('progress_update', progressUpdateTool);
		const shell = buildShellTool(projectRoot, readOnlyRoots);
		tools.set(shell.name, shell.tool);
		// Search
		const { buildSearchTool } = await import('./builtin/search.ts');
		const search = buildSearchTool(projectRoot);
		tools.set(search.name, search.tool);
		const glob = buildGlobTool(projectRoot);
		tools.set(glob.name, glob.tool);
		// Todo tracking
		tools.set('update_todos', updateTodosTool);
		// Web search
		const ws = buildWebSearchTool();
		tools.set(ws.name, ws.tool);
		// Skills
		await initializeSkills(projectRoot);
		const skillTool = buildSkillTool();
		tools.set(skillTool.name, skillTool.tool);

		async function loadFromBase(base: string | null | undefined) {
			for (const { absPath, folder } of await discoverPluginFiles(base)) {
				try {
					const plugin = await loadPlugin(absPath, folder, projectRoot);
					if (plugin) tools.set(plugin.name, plugin.tool);
				} catch {}
			}
		}

		await loadFromBase(globalConfigDir);
		await loadFromBase(join(projectRoot, '.otto'));
		return Array.from(tools.entries()).map(([name, tool]) => ({ name, tool }));
	})();

	staticToolDiscoveryCache.set(cacheKey, discoveryPromise);
	try {
		return await discoveryPromise;
	} catch (error) {
		staticToolDiscoveryCache.delete(cacheKey);
		throw error;
	}
}

export async function discoverProjectTools(
	projectRoot: string,
	globalConfigDir?: string,
	skillSettings?: {
		enabled?: boolean;
		items?: Record<string, { enabled?: boolean }>;
	},
	readOnlyRoots: string[] = [],
): Promise<DiscoverResult> {
	setSkillSettings(skillSettings);
	const staticTools = await discoverStaticProjectTools(
		projectRoot,
		globalConfigDir,
		skillSettings,
		readOnlyRoots,
	);
	const tools = new Map<string, Tool>(
		staticTools.map(({ name, tool }) => [name, tool]),
	);

	const terminalManager =
		getTerminalManager(projectRoot) ?? getTerminalManager();
	if (terminalManager) {
		const term = buildTerminalTool(projectRoot, terminalManager);
		tools.set(term.name, term.tool);
	}

	const lazyToolsRecord = buildLazyToolsRecord(projectRoot);
	const loadFirstPartyTools = buildLoadFirstPartyToolsTool();
	tools.set(loadFirstPartyTools.name, loadFirstPartyTools.tool);

	const mcpManager = getMCPManager(projectRoot);
	let mcpToolsRecord: Record<string, Tool> = {};
	let mcpBriefs: MCPToolBrief[] = [];
	if (mcpManager?.started) {
		mcpBriefs = getMCPToolBriefs(mcpManager);
		if (mcpBriefs.length > 0) {
			mcpToolsRecord = getMCPToolsRecord(mcpManager);
			const loadTool = buildLoadMCPToolsTool(mcpBriefs);
			tools.set(loadTool.name, loadTool.tool);
		}
	}

	return {
		tools: Array.from(tools.entries()).map(([name, tool]) => ({ name, tool })),
		lazyToolsRecord,
		mcpToolsRecord,
	};
}

async function loadPlugin(
	absPath: string,
	folder: string,
	projectRoot: string,
): Promise<DiscoveredTool | null> {
	const mod = await import(`${pathToFileURL(absPath).href}?t=${Date.now()}`);
	const candidate = resolveExport(mod);
	if (!candidate) throw new Error('No plugin export found');

	const context: PluginContext = {
		project: projectRoot,
		projectRoot,
		directory: projectRoot,
		worktree: projectRoot,
		toolDir: absPath.slice(0, absPath.lastIndexOf('/')),
	};

	let descriptor: PluginDescriptor | null | undefined;
	if (typeof candidate === 'function') descriptor = await candidate(context);
	else descriptor = candidate;
	if (!descriptor || typeof descriptor !== 'object')
		throw new Error('Plugin must return an object descriptor');

	if (typeof descriptor.setup === 'function') await descriptor.setup(context);
	if (typeof descriptor.onInit === 'function') await descriptor.onInit(context);

	const name = sanitizeName(descriptor.name ?? folder);
	const description = descriptor.description ?? `Custom tool ${name}`;
	const parameters = descriptor.parameters ?? {};
	const inputSchema = createInputSchema(parameters);
	const executor = resolveExecutor(descriptor);

	const helpersFactory = createHelpers(projectRoot, context.toolDir);

	const wrapped = tool({
		description,
		inputSchema,
		async execute(input) {
			const helpers = helpersFactory();
			const result = await executor({
				input: input as Record<string, unknown>,
				project: helpers.context.project,
				projectRoot: helpers.context.projectRoot,
				directory: helpers.context.directory,
				worktree: helpers.context.worktree,
				exec: helpers.exec,
				run: helpers.exec,
				$: helpers.templateExec,
				fs: helpers.fs,
				env: helpers.env,
				context: helpers.context,
			});
			return result ?? { ok: true };
		},
	});

	return { name, tool: wrapped };
}

function resolveExport(mod: Record<string, unknown>) {
	if (mod.default) return mod.default;
	if (mod.tool) return mod.tool;
	if (mod.plugin) return mod.plugin;
	if (mod.Tool) return mod.Tool;
	const values = Object.values(mod);
	return values.find(
		(value) => typeof value === 'function' || typeof value === 'object',
	);
}

function resolveExecutor(descriptor: PluginDescriptor): PluginExecutor {
	const fn = descriptor.execute ?? descriptor.run ?? descriptor.handler;
	if (typeof fn !== 'function')
		throw new Error('Plugin must provide an execute/run/handler function');
	return fn;
}

function sanitizeName(name: string) {
	const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
	return cleaned || 'tool';
}

function createInputSchema(parameters: Record<string, PluginParameter>) {
	const shape: Record<string, z.ZodTypeAny> = {};
	for (const [key, def] of Object.entries(parameters)) {
		let schema: z.ZodTypeAny;
		if (def.type === 'string') {
			const values = def.enum;
			schema = values?.length
				? z.enum(values as [string, ...string[]])
				: z.string();
		} else if (def.type === 'number') schema = z.number();
		else schema = z.boolean();
		if (def.description) schema = schema.describe(def.description);
		if (def.default !== undefined)
			schema = schema.default(def.default as never);
		else if (def.optional) schema = schema.optional();
		shape[key] = schema;
	}
	return Object.keys(shape).length ? z.object(shape).strict() : z.object({});
}

function createHelpers(projectRoot: string, toolDir: string) {
	return () => {
		const exec = createExec(projectRoot);
		const fsHelpers = createFsHelpers(projectRoot);
		const context: PluginContext = {
			project: projectRoot,
			projectRoot,
			directory: projectRoot,
			worktree: projectRoot,
			toolDir,
		};
		const env: Record<string, string> = {};
		for (const [key, value] of Object.entries(process.env))
			if (typeof value === 'string') env[key] = value;
		const templateExec: TemplateExecFn = (strings, ...values) => {
			const commandLine = strings.reduce((acc, part, index) => {
				const value = index < values.length ? String(values[index]) : '';
				return acc + part + value;
			}, '');
			const pieces = commandLine.trim().split(/\s+/).filter(Boolean);
			if (pieces.length === 0)
				throw new Error('Empty command passed to template executor');
			const firstPiece = pieces[0];
			if (!firstPiece)
				throw new Error('Empty command passed to template executor');
			return exec(firstPiece, pieces.slice(1));
		};
		return {
			exec,
			fs: fsHelpers,
			env,
			templateExec,
			context,
		};
	};
}

function createExec(projectRoot: string): ExecFn {
	return async (
		command: string,
		argsOrOptions?: string[] | ExecOptions,
		maybeOptions?: ExecOptions,
	) => {
		let args: string[] = [];
		let options: ExecOptions = {};
		if (Array.isArray(argsOrOptions)) {
			args = argsOrOptions;
			options = maybeOptions ?? {};
		} else if (argsOrOptions) options = argsOrOptions;

		const cwd = options.cwd
			? resolveWithinProject(projectRoot, options.cwd)
			: projectRoot;
		const env: Record<string, string> = {};
		for (const [key, value] of Object.entries(process.env))
			if (typeof value === 'string') env[key] = value;
		if (options.env)
			for (const [key, value] of Object.entries(options.env)) env[key] = value;

		const proc = nodeSpawn(command, args, {
			cwd,
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];

		proc.stdout?.on('data', (chunk) => stdoutChunks.push(chunk));
		proc.stderr?.on('data', (chunk) => stderrChunks.push(chunk));

		const exitCode = await new Promise<number>((resolve, reject) => {
			proc.on('exit', (code) => resolve(code ?? 0));
			proc.on('error', reject);
		});

		const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
		const stderr = Buffer.concat(stderrChunks).toString('utf-8');
		if (exitCode !== 0 && !options.allowNonZeroExit) {
			const message = stderr.trim() || stdout.trim() || `${command} failed`;
			throw new Error(`${command} exited with code ${exitCode}: ${message}`);
		}
		return { exitCode, stdout, stderr };
	};
}

function createFsHelpers(projectRoot: string): FsHelpers {
	return {
		async readFile(path: string, encoding: BufferEncoding = 'utf-8') {
			const abs = resolveWithinProject(projectRoot, path);
			return fs.readFile(abs, { encoding });
		},
		async writeFile(path: string, content: string) {
			const abs = resolveWithinProject(projectRoot, path);
			await fs.mkdir(dirname(abs), { recursive: true });
			await fs.writeFile(abs, content, 'utf-8');
		},
		async exists(path: string) {
			const abs = resolveWithinProject(projectRoot, path);
			try {
				await fs.access(abs);
				return true;
			} catch {
				return false;
			}
		},
	};
}

function resolveWithinProject(projectRoot: string, target: string) {
	if (!target) return projectRoot;
	if (target.startsWith('~/')) {
		const home = process.env.HOME || process.env.USERPROFILE || '';
		return join(home, target.slice(2));
	}
	if (isAbsolute(target)) return target;
	return join(projectRoot, target);
}
