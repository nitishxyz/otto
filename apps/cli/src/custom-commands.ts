import { intro, outro, text, isCancel, cancel } from '@clack/prompts';
import { isAbsolute, join } from 'node:path';
import { runAsk } from './ask.ts';
import { getGlobalCommandsDir } from '@ottocode/sdk';

export type CommandManifest = {
	name: string;
	description?: string;
	agent: string;
	prompt?: string; // inline prompt override
	promptPath?: string; // relative path to prompt text
	promptTemplate?: string; // e.g., "Draft a message: {input}"
	defaults?: {
		provider?:
			| 'openai'
			| 'anthropic'
			| 'google'
			| 'openrouter'
			| 'opencode'
			| 'ottorouter'
			| 'xai';
		model?: string;
		agent?: string;
	};
	confirm?: { required?: boolean; message?: string; token?: string };
	interactive?: boolean; // if true and no input, prompt user for {input}
	__dir?: string; // resolved directory for loading promptPath
};

export async function discoverCommands(
	projectRoot: string,
): Promise<Record<string, CommandManifest>> {
	const commands: Record<string, CommandManifest> = {};
	// Helper to read per-file manifests from a directory
	await scanDirInto(getGlobalCommandsDir(), commands);
	await scanDirInto(`${projectRoot}/.otto/commands`, commands);
	return commands;
}

async function scanDirInto(
	dir: string,
	commands: Record<string, CommandManifest>,
) {
	try {
		const { promises: fs } = await import('node:fs');
		const entries = await fs.readdir(dir).catch(() => [] as string[]);
		for (const file of entries) {
			if (!file.endsWith('.json')) continue;
			try {
				const name = file.replace(/\.json$/i, '');
				const f = Bun.file(`${dir}/${file}`);
				if (!(await f.exists())) continue;
				const manifest = JSON.parse(await f.text()) as CommandManifest;
				if (manifest && (manifest.name || name) && manifest.agent) {
					const resolved = {
						...manifest,
						name: manifest.name || name,
						__dir: dir,
					} as CommandManifest;
					if (
						!resolved.promptPath &&
						!resolved.prompt &&
						!resolved.promptTemplate
					) {
						const promptCandidate = await findPromptSibling(dir, name);
						if (promptCandidate) resolved.promptPath = promptCandidate;
					}
					commands[resolved.name] = resolved;
				}
			} catch {}
		}
	} catch {}
}

async function findPromptSibling(
	dir: string,
	name: string,
): Promise<string | null> {
	const extensions = ['.md', '.txt'];
	for (const ext of extensions) {
		const filename = `${name}${ext}`;
		try {
			const file = Bun.file(`${dir}/${filename}`);
			if (await file.exists()) return filename;
		} catch {}
	}
	return null;
}

export async function runDiscoveredCommand(
	name: string,
	argv: string[],
	projectRoot: string,
): Promise<boolean> {
	const cmds = await discoverCommands(projectRoot);
	const cmd = cmds[name];
	if (!cmd) return false;
	// Parse flags and build input text from remaining args (excluding flag values)
	const flagsWithValues = new Set([
		'--provider',
		'--model',
		'--agent',
		'--project',
		'--session',
	]);
	const inputTokens: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith('--')) {
			if (flagsWithValues.has(a)) i++;
			continue;
		}
		inputTokens.push(a);
	}
	let userInput = inputTokens.join(' ').trim();
	if (!userInput && cmd.interactive) {
		intro(cmd.name);
		const got = await text({
			message: cmd.description ? `${cmd.description}\nInput:` : 'Input:',
		});
		if (isCancel(got)) {
			cancel('Cancelled');
			return false;
		}
		userInput = String(got ?? '').trim();
		outro('');
	}
	const promptSegments: string[] = [];
	let userInputConsumed = false;
	const promptPathContent = await loadPromptFromPath(cmd, projectRoot);
	if (promptPathContent) {
		const hasPlaceholder = promptPathContent.includes('{input}');
		const segment = hasPlaceholder
			? promptPathContent.replaceAll('{input}', userInput)
			: promptPathContent;
		if (segment.trim()) promptSegments.push(segment);
		if (hasPlaceholder && userInput) userInputConsumed = true;
	}
	if (cmd.prompt) {
		const hasPlaceholder = cmd.prompt.includes('{input}');
		const segment = hasPlaceholder
			? cmd.prompt.replaceAll('{input}', userInput)
			: cmd.prompt;
		if (segment.trim()) promptSegments.push(segment);
		if (hasPlaceholder && userInput) userInputConsumed = true;
	}

	if (cmd.promptTemplate) {
		const templateHasPlaceholder = cmd.promptTemplate.includes('{input}');
		let replaced: string;
		if (templateHasPlaceholder) {
			replaced = cmd.promptTemplate.replaceAll('{input}', userInput);
			if (userInput) userInputConsumed = true;
		} else {
			const parts = [cmd.promptTemplate];
			if (userInput) {
				parts.push(userInput);
				userInputConsumed = true;
			}
			replaced = parts
				.filter((part) => part && part.trim().length > 0)
				.join('\n\n');
		}
		if (replaced.trim()) promptSegments.push(replaced);
	}

	if (!cmd.promptTemplate && userInput && !userInputConsumed) {
		promptSegments.push(userInput);
	}

	const rendered = promptSegments
		.filter((segment) => segment && segment.trim().length > 0)
		.join('\n\n');
	const prompt = rendered.trim().length > 0 ? rendered : userInput;

	// CLI overrides for provider/model/agent
	const agentFlagIdx = argv.indexOf('--agent');
	const providerFlagIdx = argv.indexOf('--provider');
	const modelFlagIdx = argv.indexOf('--model');
	const sessionFlagIdx = argv.indexOf('--session');
	const lastFlag = argv.includes('--last');
	const wildFlag = argv.includes('--wild');

	const agent =
		(agentFlagIdx >= 0 ? argv[agentFlagIdx + 1] : undefined) ||
		cmd.defaults?.agent ||
		cmd.agent;
	const provider =
		(providerFlagIdx >= 0
			? (argv[providerFlagIdx + 1] as
					| 'openai'
					| 'anthropic'
					| 'google'
					| 'openrouter'
					| 'opencode'
					| 'ottorouter'
					| 'xai')
			: undefined) || cmd.defaults?.provider;
	const model =
		(modelFlagIdx >= 0 ? argv[modelFlagIdx + 1] : undefined) ||
		cmd.defaults?.model;
	const sessionId = sessionFlagIdx >= 0 ? argv[sessionFlagIdx + 1] : undefined;

	await runAsk(prompt, {
		project: projectRoot,
		agent,
		provider,
		model,
		wild: wildFlag,
		last: lastFlag,
		sessionId,
	});
	return true;
}

async function loadPromptFromPath(
	cmd: CommandManifest,
	projectRoot: string,
): Promise<string | null> {
	if (!cmd.promptPath) return null;
	const paths: string[] = [];
	const home = process.env.HOME || process.env.USERPROFILE || '';
	const normalized = cmd.promptPath.startsWith('~/')
		? join(home, cmd.promptPath.slice(2))
		: cmd.promptPath;
	if (isAbsolute(normalized)) {
		paths.push(normalized);
	} else {
		if (cmd.__dir) paths.push(join(cmd.__dir, normalized));
		paths.push(join(projectRoot, normalized));
	}
	for (const candidate of paths) {
		try {
			const file = Bun.file(candidate);
			if (await file.exists())
				return (await file.text()).replace(/\r\n?/g, '\n');
		} catch {}
	}
	return null;
}
