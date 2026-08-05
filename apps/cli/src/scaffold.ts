import {
	intro,
	outro,
	select,
	multiselect,
	text,
	isCancel,
	cancel,
	log,
	confirm,
} from '@clack/prompts';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline';
import {
	defaultToolConfigForAgent,
	flattenAgentToolConfig,
	type AgentToolConfig,
} from '@ottocode/server/runtime/agent-registry';
import { discoverProjectTools } from '@ottocode/sdk';
import { getGlobalConfigDir, getHomeDir } from '@ottocode/sdk';

type ScaffoldOptions = { project?: string; local?: boolean };

const LOADABLE_TOOLS = new Set([
	'read_image',
	'copy_attachment_to_project',
	'simulator',
]);

function toolConfigFromNames(names: string[]): Required<AgentToolConfig> {
	const firstClass = new Set<string>();
	const loadable = new Set<string>();
	for (const name of names) {
		if (LOADABLE_TOOLS.has(name)) loadable.add(name);
		else firstClass.add(name);
	}
	return {
		firstClass: Array.from(firstClass),
		loadable: Array.from(loadable),
	};
}

function toolNamesFromConfig(config: AgentToolConfig | undefined): string[] {
	return flattenAgentToolConfig(config ?? {});
}

export async function runScaffold(opts: ScaffoldOptions = {}) {
	const projectRoot = (opts.project ?? process.cwd()).replace(/\\/g, '/');
	const baseDir = opts.local ? `${projectRoot}/.otto` : getGlobalConfigDir();
	const scopeLabel = opts.local ? 'local' : 'global';
	intro(`Scaffold (${scopeLabel})`);
	const homeForLabel = getHomeDir();
	const baseLabel = opts.local
		? '.otto'
		: baseDir.startsWith(homeForLabel)
			? baseDir.replace(homeForLabel, '~')
			: baseDir;
	const kind = await select({
		message: 'What do you want to scaffold?',
		options: [
			{ value: 'agent', label: 'Agent' },
			{ value: 'tool', label: 'Tool' },
			{
				value: 'command',
				label: `Command (manifest under ${baseLabel}/commands/)`,
			},
		],
	});
	if (isCancel(kind)) return cancel('Cancelled');
	if (kind === 'agent') return await scaffoldAgent(projectRoot, baseDir);
	if (kind === 'tool') return await scaffoldTool(projectRoot, baseDir);
	if (kind === 'command')
		return await scaffoldCommand(projectRoot, baseDir, !!opts.local);
	outro('Done');
}

async function scaffoldAgent(
	projectRoot: string,
	baseDir: string,
): Promise<boolean> {
	const scope = isGlobalBase(baseDir, projectRoot) ? 'global' : 'local';
	const name = await text({
		message: 'Agent name (slug)',
		placeholder: 'e.g. git, reviewer, testgen',
		validate: (v) =>
			/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(String(v))
				? undefined
				: 'Use letters, numbers, - or _',
	});
	if (isCancel(name)) {
		cancel('Cancelled');
		return false;
	}
	const tools = await multiselect({
		message: 'Select tools to allow for this agent',
		// built-ins + tools contributed by installed plugins
		options: (await listAvailableTools(projectRoot, scope)).map((t) => ({
			value: t,
			label: t,
		})),
	});
	if (isCancel(tools)) {
		cancel('Cancelled');
		return false;
	}

	let createPrompt = false;
	if (!['general', 'build', 'plan'].includes(String(name))) {
		const home = getHomeDir();
		const displayBase = baseDir.startsWith(home)
			? baseDir.replace(home, '~')
			: baseDir;
		const wantPrompt = await confirm({
			message: `Create prompt file (${displayBase}/agents/${String(name)}.md)?`,
		});
		if (isCancel(wantPrompt)) {
			cancel('Cancelled');
			return false;
		}
		createPrompt = Boolean(wantPrompt);
	}
	const agentsPath = `${baseDir}/agents.json`;
	const current = (await readJson(agentsPath).catch(
		() => ({}) as Record<string, unknown>,
	)) as Record<string, unknown>;
	let promptRel: string | undefined;
	if (createPrompt) {
		const rel = `agents/${String(name)}.md`;
		promptRel = baseDir.endsWith('/.otto') ? `.otto/${rel}` : rel; // if global, store just relative path preferred? we'll write absolute
		const promptAbs = `${baseDir}/${rel}`;
		await ensureDir(promptAbs.substring(0, promptAbs.lastIndexOf('/')));
		const template = defaultAgentPromptTemplate(String(name));
		await Bun.write(promptAbs, template);
	}
	const toolList = Array.from(new Set([...(tools as string[])]));
	current[String(name)] = {
		...(current[String(name)] ?? {}),
		tools: toolConfigFromNames(toolList),
		...(promptRel ? { prompt: promptRel } : {}),
	};
	await ensureDir(agentsPath.substring(0, agentsPath.lastIndexOf('/')));
	await Bun.write(agentsPath, JSON.stringify(current, null, 2));
	log.success(`Agent ${name} added to ${scope} agents.json`);
	if (promptRel) log.info(`Prompt: ${promptRel}`);
	outro('Done');
	return true;
}

async function scaffoldTool(projectRoot: string, baseDir: string) {
	const id = await text({
		message: 'Tool id (slug)',
		placeholder: 'e.g. git_tag, search',
		validate: (v) =>
			/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(String(v))
				? undefined
				: 'Use letters, numbers, - or _',
	});
	if (isCancel(id)) return cancel('Cancelled');
	const desc = await text({
		message: 'Description',
		placeholder: 'What does this tool do?',
	});
	if (isCancel(desc)) return cancel('Cancelled');
	const dir = `${baseDir}/plugins/${String(id)}`;
	const toolsDir = `${dir}/tools`;
	await ensureDir(toolsDir);
	const file = `${toolsDir}/${String(id)}.ts`;
	const content = toolTemplate();
	await Bun.write(file, content);
	await Bun.write(
		`${dir}/otto.plugin.json`,
		`${JSON.stringify(
			{
				name: String(id),
				version: '0.1.0',
				description: String(desc),
				tools: [
					{
						name: String(id),
						entry: `tools/${String(id)}.ts`,
						description: String(desc),
						inputSchema: {
							type: 'object',
							properties: {
								text: { type: 'string', description: 'Text to echo' },
							},
							required: ['text'],
							additionalProperties: false,
						},
						effects: [],
					},
				],
			},
			null,
			2,
		)}\n`,
	);
	const scope = isGlobalBase(baseDir, projectRoot) ? 'global' : 'local';
	const home = getHomeDir();
	const displayBase = baseDir.startsWith(home)
		? baseDir.replace(home, '~')
		: baseDir;
	const display = `${displayBase}/plugins/${String(id)}`;
	log.success(`Native plugin tool created (${scope}): ${display}`);
	log.info(
		`Edit ${display}/otto.plugin.json and ${display}/tools/${String(id)}.ts.`,
	);
	const agentsFile = baseDir.startsWith(home)
		? `${baseDir.replace(home, '~')}/agents.json`
		: `${baseDir}/agents.json`;
	log.info(
		`Remember to allow ${String(id)}__${String(id)} in your agent via ${agentsFile}.`,
	);
	outro('Done');
}

export async function editAgentsConfig(
	projectRoot: string,
	baseDir: string,
	scopeLabel: string,
) {
	const agentsPath = `${baseDir}/agents.json`;
	log.message(`Editing ${scopeLabel} agents config`);
	const current = (await readJson(agentsPath).catch(() => ({}))) as Record<
		string,
		{ tools?: AgentToolConfig; appendTools?: AgentToolConfig; prompt?: string }
	>;
	const builtInList = ['general', 'build', 'plan'];
	const names = Object.keys(current);
	const selectable = Array.from(new Set([...builtInList, ...names])).sort();
	let agentName = await select({
		message: 'Select agent to edit',
		options: [
			{ value: '__new__', label: '(new agent)' },
			...selectable.map((n) => ({
				value: n,
				label:
					builtInList.includes(n) && !names.includes(n) ? `${n} (default)` : n,
			})),
		],
	});
	if (isCancel(agentName)) {
		cancel('Cancelled');
		return;
	}
	if (agentName === '__new__') {
		const nn = await text({
			message: 'New agent name',
			validate: (v) =>
				/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(String(v))
					? undefined
					: 'Use letters, numbers, - or _',
		});
		if (isCancel(nn)) {
			cancel('Cancelled');
			return;
		}
		agentName = String(nn);
	}
	const key = String(agentName);
	const entry = current[key] ?? {};
	const scope = isGlobalBase(baseDir, projectRoot) ? 'global' : 'local';
	const builtInAgents = new Set(['general', 'build', 'plan']);
	const defaults = flattenAgentToolConfig(
		defaultToolConfigForAgent(key),
	).filter((t) => t !== 'finish');
	const hasOverride = Boolean(entry.tools);
	const existingAppend = toolNamesFromConfig(entry.appendTools).filter(
		(t) => t !== 'finish',
	);
	let mode: 'append' | 'override';
	if (hasOverride) mode = 'override';
	else if (existingAppend.length) mode = 'append';
	else if (builtInAgents.has(key)) mode = 'append';
	else mode = 'override';

	if (!hasOverride && builtInAgents.has(key) && existingAppend.length === 0) {
		const choice = await confirm({
			message:
				mode === 'append'
					? `Append extra tools to ${key}'s defaults? (defaults: ${
							defaults.length ? defaults.join(', ') : 'none'
						})`
					: `Override ${key}'s default tools?`,
		});
		if (isCancel(choice)) {
			cancel('Cancelled');
			return;
		}
		mode = choice ? 'append' : 'override';
	}

	const preselect =
		mode === 'append'
			? existingAppend
			: toolNamesFromConfig(entry.tools).filter((t) => t !== 'finish');
	const optionValues = await listAvailableTools(projectRoot, scope);
	const baseDefaults = new Set(defaults);
	const filteredOptions = optionValues.filter((tool) => {
		if (mode === 'append') {
			if (baseDefaults.has(tool) && !existingAppend.includes(tool))
				return false;
		}
		return true;
	});
	const options = filteredOptions.map((t) => ({ value: t, label: t }));
	const allowed = new Set(filteredOptions);
	let initialValues = (preselect as string[]).filter((t) => allowed.has(t));
	if (
		mode === 'override' &&
		initialValues.length === 0 &&
		builtInAgents.has(key)
	) {
		initialValues = defaults.filter((t) => allowed.has(t));
	}
	const toolsSel = await multiselect({
		message:
			mode === 'append'
				? `Extra tools to append for ${key} (defaults: ${
						defaults.length ? defaults.join(', ') : 'none'
					})`
				: `Tools for ${key}`,
		options,
		initialValues,
	});
	if (isCancel(toolsSel)) {
		cancel('Cancelled');
		return;
	}
	const relPrompt = `agents/${String(agentName)}.md`;
	const pth = current[String(agentName)]?.prompt;
	const shouldOfferPrompt = !builtInAgents.has(key) || Boolean(pth);
	let ensurePrompt = false;
	if (shouldOfferPrompt) {
		const resp = await confirm({
			message: `Ensure prompt file exists at ${pth ?? relPrompt}?`,
		});
		if (isCancel(resp)) {
			cancel('Cancelled');
			return;
		}
		ensurePrompt = Boolean(resp);
	}
	if (ensurePrompt) {
		const location =
			pth ??
			(isGlobalBase(baseDir, projectRoot) ? `.otto/${relPrompt}` : relPrompt);
		let abs: string;
		if (location.startsWith('.otto/')) {
			if (isGlobalBase(baseDir, projectRoot)) {
				const relFromAgi = location.slice('.otto/'.length);
				abs = `${baseDir}/${relFromAgi}`;
			} else {
				abs = `${projectRoot}/${location}`;
			}
		} else if (location.startsWith('~/')) {
			const home = getHomeDir();
			abs = `${home}/${location.slice(2)}`;
		} else if (location.startsWith('/')) {
			abs = location;
		} else {
			abs = `${baseDir}/${location}`;
		}
		await ensureDir(abs.substring(0, abs.lastIndexOf('/')));
		const f = Bun.file(abs);
		if (!(await f.exists()))
			await Bun.write(abs, defaultAgentPromptTemplate(String(agentName)));
	}
	const selection = Array.from(new Set((toolsSel as string[]) || []));
	const nextEntry: {
		tools?: AgentToolConfig;
		appendTools?: AgentToolConfig;
		prompt?: string;
	} = { ...(current[key] ?? {}) };
	if (ensurePrompt)
		nextEntry.prompt =
			pth ??
			(isGlobalBase(baseDir, projectRoot) ? `.otto/${relPrompt}` : relPrompt);
	else delete nextEntry.prompt;
	if (mode === 'append') {
		const extras = selection.filter((t) => t !== 'finish');
		if (extras.length) nextEntry.appendTools = toolConfigFromNames(extras);
		else delete nextEntry.appendTools;
		delete nextEntry.tools;
	} else {
		const finalTools = Array.from(new Set(selection));
		nextEntry.tools = toolConfigFromNames(finalTools);
		delete nextEntry.appendTools;
	}
	current[key] = nextEntry;
	await ensureDir(agentsPath.substring(0, agentsPath.lastIndexOf('/')));
	await Bun.write(agentsPath, JSON.stringify(current, null, 2));
	const home2 = getHomeDir();
	const agentsDisplay = baseDir.startsWith(home2)
		? `${baseDir.replace(home2, '~')}/agents.json`
		: `${baseDir}/agents.json`;
	log.success(`Updated ${agentsDisplay} for ${key} (${mode})`);
	outro('Done');
}

async function scaffoldCommand(
	projectRoot: string,
	baseDir: string,
	scopeIsLocal: boolean,
) {
	const name = await text({
		message: 'Command name',
		placeholder: 'e.g. review, release',
		validate: (v) =>
			/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(String(v))
				? undefined
				: 'Use letters, numbers, - or _',
	});
	if (isCancel(name)) {
		cancel('Cancelled');
		return;
	}
	// Pick agent interactively (existing or new)
	const scope = scopeIsLocal ? 'local' : 'global';
	const agentPick = await select({
		message: 'Agent to use',
		options: [
			{ value: '__new__', label: '(new agent)' },
			...(await listAgents(projectRoot, scope)).map((a) => ({
				value: a,
				label: a,
			})),
		],
	});
	if (isCancel(agentPick)) {
		cancel('Cancelled');
		return;
	}
	let agentName = String(agentPick);
	if (agentName === '__new__') {
		const created = await scaffoldAgent(projectRoot, baseDir);
		if (!created) return; // cancelled; stop flow
		// Ask again after creation to select the agent just added
		const sel = await select({
			message: 'Select agent',
			options: (await listAgents(projectRoot, scope)).map((a) => ({
				value: a,
				label: a,
			})),
		});
		if (isCancel(sel)) {
			cancel('Cancelled');
			return;
		}
		agentName = String(sel);
	}
	const description = await text({
		message: 'Description (optional)',
		placeholder: 'What does this command do?',
	});
	if (isCancel(description)) {
		cancel('Cancelled');
		return;
	}
	const promptResult = await promptMultiline({
		message:
			'Prompt instructions (optional). Type .done on a blank line to finish, .cancel to abort.',
		placeholder: 'e.g. Review the changes and summarize.\n{input}',
	});
	if (promptResult.cancelled) {
		cancel('Cancelled');
		return;
	}
	const dir = `${baseDir}/commands`;
	await ensureDir(dir);
	const file = `${dir}/${String(name)}.json`;
	const promptFileName = `${String(name)}.md`;
	const promptFilePath = `${dir}/${promptFileName}`;
	const rawPrompt = promptResult.value.replace(/\r/g, '');
	const instructions = rawPrompt.trimEnd();
	const manifest: Record<string, unknown> = {
		name: String(name),
		description: String(description || ''),
		agent: agentName,
		defaults: { agent: agentName },
	};
	manifest.promptPath = promptFileName;
	await Bun.write(file, JSON.stringify(manifest, null, 2));
	const promptBody = instructions.length
		? `${instructions}${instructions.endsWith('\n') ? '' : '\n'}`
		: defaultCommandPromptTemplate(String(name));
	await Bun.write(promptFilePath, promptBody);
	const scopeLabel = isGlobalBase(baseDir, projectRoot) ? 'global' : 'local';
	const home3 = getHomeDir();
	const displayBase2 = baseDir.startsWith(home3)
		? baseDir.replace(home3, '~')
		: baseDir;
	const display = `${displayBase2}/commands/${String(name)}.json`;
	log.success(`Command created (${scopeLabel}): ${display}`);
	log.info(`Prompt: ${displayBase2}/commands/${promptFileName}`);
	outro('Done');
}

export async function listAvailableTools(
	_projectRoot: string,
	_scope: 'local' | 'global',
): Promise<string[]> {
	const discovered = await discoverProjectTools(_projectRoot).catch(() => ({
		tools: [] as { name: string }[],
		lazyToolsRecord: {} as Record<string, unknown>,
		mcpToolsRecord: {},
	}));
	const names = new Set<string>();
	const curatedBuiltIns = [
		'read',
		'write',
		'ls',
		'tree',
		'search',
		'apply_patch',
		'update_todos',
		'git_status',
		'git_diff',
		'git_commit',
	];
	for (const builtin of curatedBuiltIns) names.add(builtin);
	for (const name of [
		...discovered.tools.map(({ name }) => name),
		...Object.keys(discovered.lazyToolsRecord),
	]) {
		// Hide internal helpers
		if (name === 'pwd' || name === 'cd' || name === 'progress_update') continue;
		names.add(name);
	}
	return Array.from(names).sort();
}

async function listAgents(
	projectRoot: string,
	scope: 'local' | 'global',
): Promise<string[]> {
	// Only show core built-ins that always exist + configured agents.
	// Do not include optional built-ins like 'git' unless explicitly configured.
	const defaults = ['general', 'build', 'plan'];
	const names = new Set(defaults);
	const _home = process.env.HOME || process.env.USERPROFILE || '';
	try {
		const { getGlobalAgentsJsonPath } = await import('@ottocode/sdk');
		const globalAgents = (await Bun.file(getGlobalAgentsJsonPath())
			.json()
			.catch(() => ({}))) as Record<string, unknown>;
		if (scope === 'local' || scope === 'global')
			for (const key of Object.keys(globalAgents)) names.add(key);
	} catch {}
	if (scope === 'local') {
		try {
			const localAgents = (await Bun.file(`${projectRoot}/.otto/agents.json`)
				.json()
				.catch(() => ({}))) as Record<string, unknown>;
			for (const key of Object.keys(localAgents)) names.add(key);
		} catch {}
	}
	return Array.from(names).sort();
}

async function readJson(path: string) {
	const f = Bun.file(path);
	if (!(await f.exists())) throw new Error('missing');
	const text = await f.text();
	if (!text.trim()) return {};
	try {
		return JSON.parse(text) as unknown;
	} catch {
		const sanitized = text.replace(/,\s*(\}|\])/g, '$1');
		return JSON.parse(sanitized) as unknown;
	}
}

async function ensureDir(dir: string) {
	try {
		const { promises: fs } = await import('node:fs');
		await fs.mkdir(dir, { recursive: true });
	} catch {}
}

type MultilinePromptResult =
	| { cancelled: true; value: string }
	| { cancelled: false; value: string };

async function promptMultiline({
	message,
	placeholder,
}: {
	message: string;
	placeholder?: string;
}): Promise<MultilinePromptResult> {
	log.message(message);
	if (placeholder) log.message(`Example:\n${placeholder}`);
	log.message('Finish with .done on its own line or .cancel to abort.');
	const rl = createInterface({ input, output });
	const lines: string[] = [];
	let settled = false;
	function finish(result: MultilinePromptResult) {
		if (settled) return result;
		settled = true;
		rl.removeAllListeners();
		// close() triggers the 'close' event, so guard against recursion
		if (result.cancelled) {
			try {
				rl.close();
			} catch {}
			return result;
		}
		try {
			rl.close();
		} catch {}
		return result;
	}
	return await new Promise<MultilinePromptResult>((resolve) => {
		function done(result: MultilinePromptResult) {
			const final = finish(result);
			resolve(final);
		}
		rl.on('line', (line) => {
			const trimmed = line.trim();
			if (trimmed === '.cancel') return done({ cancelled: true, value: '' });
			if (trimmed === '.done')
				return done({ cancelled: false, value: lines.join('\n') });
			lines.push(line);
			rl.setPrompt('… ');
			rl.prompt();
		});
		rl.on('SIGINT', () => done({ cancelled: true, value: '' }));
		rl.on('close', () => {
			if (settled) return;
			settled = true;
			resolve({ cancelled: false, value: lines.join('\n') });
		});
		rl.setPrompt('> ');
		rl.prompt();
	});
}

function defaultAgentPromptTemplate(name: string): string {
	if (name.toLowerCase() === 'git') {
		return `You are a Git assistant. Review and commit guidance.\n\n- Use git_status and git_diff to inspect changes.\n- For reviews: summarize and suggest improvements.\n- For commits: draft a Conventional Commits message; only call git_commit if the user explicitly asks you to commit.\n- Stream your findings before finish.\n`;
	}
	return `You are the ${name} agent. Describe your responsibilities here.\n\n- What tools you can use.\n- What the expected output looks like.\n- Always call finish when done.\n`;
}

function defaultCommandPromptTemplate(name: string): string {
	return `# ${name} command\n\nDescribe what this command should do.\n\n- Outline the steps the agent should follow.\n- Mention any tools or context to gather first.\n- Include {input} where the user's input should be referenced.\n`;
}

function toolTemplate(): string {
	return `import type { NativeToolHandler } from '@ottocode/sdk/tool-extension';

export default (async (input, context) => {
	return {
		projectRoot: context.projectRoot,
		value: String(input.text),
	};
}) satisfies NativeToolHandler;
`;
}

function isGlobalBase(baseDir: string, projectRoot: string): boolean {
	const normalized = baseDir.replace(/\\/g, '/');
	const localBase = `${projectRoot.replace(/\\/g, '/')}/.otto`;
	return normalized !== localBase;
}
