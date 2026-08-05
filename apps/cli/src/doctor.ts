import { box, colors } from './ui.ts';
import { runDoctor } from '@ottocode/api';

type DoctorResult = {
	providers: Array<{
		id: string;
		ok: boolean;
		configured: boolean;
		sources: string[];
	}>;
	defaults: {
		agent: string;
		provider: string;
		model: string;
		providerAuthorized: boolean;
	};
	agents: {
		globalPath: string | null;
		localPath: string | null;
		globalNames: string[];
		localNames: string[];
	};
	tools: {
		builtInNames: string[];
		extensionNames: string[];
		effectiveNames: string[];
	};
	commands: {
		globalPath: string | null;
		globalNames: string[];
		localPath: string | null;
		localNames: string[];
	};
	issues: string[];
	suggestions: string[];
	globalAuthPath: string | null;
};

export async function runDoctorCommand(opts: { project?: string } = {}) {
	const projectRoot = opts.project ?? process.cwd();

	const { data, error } = await runDoctor({
		query: { project: projectRoot },
	});

	if (error || !data) {
		console.error('Failed to run doctor');
		return;
	}

	const result = data as DoctorResult;

	const configured = result.providers.filter((p) => p.configured);
	if (configured.length) {
		const providerLines: string[] = [];
		if (result.globalAuthPath)
			providerLines.push(
				colors.dim(`global auth: ${friendlyPath(result.globalAuthPath)}`),
			);
		if (providerLines.length) providerLines.push(' ');
		for (const meta of configured) {
			const status = meta.ok ? colors.green('ok') : colors.red('missing');
			const sources = meta.sources.length
				? colors.dim(`(${meta.sources.join(', ')})`)
				: '';
			providerLines.push(
				`${colors.bold(meta.id)} — ${status}${sources ? ` ${sources}` : ''}`,
			);
		}
		box('Credentials', providerLines);
	}

	const def = result.defaults;
	const defStatus = def.providerAuthorized
		? colors.green('ok')
		: colors.red('unauthorized');
	box('Defaults', [
		`agent: ${def.agent}`,
		`provider: ${def.provider} (${defStatus})`,
		`model: ${def.model}`,
	]);

	const agentScopes = buildScopeLines([
		['global', result.agents.globalNames],
		['local', result.agents.localNames],
	]);
	const agentLines: string[] = [];
	if (result.agents.globalPath)
		agentLines.push(
			colors.dim(`global file: ${friendlyPath(result.agents.globalPath)}`),
		);
	if (result.agents.localPath)
		agentLines.push(
			colors.dim(`local file: ${friendlyPath(result.agents.localPath)}`),
		);
	if (agentLines.length) agentLines.push(' ');
	agentLines.push(...agentScopes);
	box('Agents', agentLines);

	const toolScopes = buildScopeLines([
		['built-in', result.tools.builtInNames],
		['extensions', result.tools.extensionNames],
		['effective', result.tools.effectiveNames],
	]);
	box('Tools', toolScopes);

	const commandLines: string[] = [];
	if (result.commands.globalPath)
		commandLines.push(
			colors.dim(`global dir: ${friendlyPath(result.commands.globalPath)}`),
		);
	if (result.commands.localPath)
		commandLines.push(
			colors.dim(`local dir: ${friendlyPath(result.commands.localPath)}`),
		);
	const cmdScopes = buildScopeLines([
		['global', result.commands.globalNames],
		['local', result.commands.localNames],
	]);
	if (commandLines.length) commandLines.push(' ');
	commandLines.push(...cmdScopes);
	box('Commands', commandLines);

	if (result.issues.length)
		box('Issues', [colors.yellow('Issues found:'), ...result.issues]);
	else box('Checks', [colors.green('No config issues detected')]);

	if (result.suggestions.length) box('Suggestions', result.suggestions);
	else box('Suggestions', [colors.green('No obvious issues found')]);
}

function formatList(values: string[]): string {
	if (!values.length) return colors.dim('none');
	const limit = 6;
	const shown = values.slice(0, limit);
	const rest = values.length - shown.length;
	const body = shown.join(', ');
	if (rest > 0) return `${body}${colors.dim(` (+${rest} more)`)}`;
	return body;
}

function buildScopeLines(scopes: [string, string[]][]) {
	return scopes.map(([scope, entries]) => {
		const label = colors.bold(`${scope} (${entries.length})`);
		return `${label}: ${formatList(entries)}`;
	});
}

function friendlyPath(path: string | null) {
	if (!path) return '';
	const home = process.env.HOME || process.env.USERPROFILE || '';
	if (home && path.startsWith(home))
		return path.replace(home, '~').replace(/\\/g, '/');
	return path.replace(/\\/g, '/');
}
