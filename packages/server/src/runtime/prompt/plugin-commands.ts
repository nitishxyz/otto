import type { PluginCommandListEntry } from '../plugins/commands/types.ts';
import { listPluginCommands } from '../plugins/commands/resolve.ts';

export const MAX_PLUGIN_COMMAND_LINES = 12;

export type PluginCommandsPromptResult = {
	prompt: string;
	components: string[];
};

export async function buildPluginCommandsPrompt(
	projectRoot: string,
): Promise<PluginCommandsPromptResult> {
	const entries = await listPluginCommands(projectRoot);
	if (entries.length === 0) {
		return { prompt: '', components: [] };
	}

	const lines = buildPluginCommandLines(entries);
	const prompt = [
		'Available plugin commands:',
		...lines,
		'',
		'Recommend these to the user or run them with the `run_plugin_command` loadable tool (visible terminal).',
	].join('\n');

	return {
		prompt,
		components: ['plugin-commands'],
	};
}

export function buildPluginCommandLines(
	entries: PluginCommandListEntry[],
): string[] {
	const sorted = [...entries].sort(
		(a, b) =>
			a.plugin.localeCompare(b.plugin) || a.command.localeCompare(b.command),
	);
	const visible = sorted
		.slice(0, MAX_PLUGIN_COMMAND_LINES)
		.map(formatPluginCommandLine);
	const remaining = sorted.length - visible.length;
	if (remaining > 0) {
		visible.push(
			`- ${remaining} more plugin command${remaining === 1 ? '' : 's'} available via GET /v1/plugins/commands.`,
		);
	}
	return visible;
}

function formatPluginCommandLine(entry: PluginCommandListEntry): string {
	const invocation = `/${entry.plugin} ${entry.command}`;
	const argHint = formatPluginCommandArgHint(entry);
	const description = (
		entry.description?.trim() ||
		entry.label?.trim() ||
		`Run ${entry.plugin} ${entry.command}`
	).replace(/[.!?]+\s*$/u, '');
	const terminalNote = 'Opens a visible terminal.';
	return `- ${invocation}${argHint}: ${description}. ${terminalNote}`;
}

function formatPluginCommandArgHint(entry: PluginCommandListEntry): string {
	const parameters = entry.parameters;
	if (!parameters || Object.keys(parameters).length === 0) return '';

	const hints: string[] = [];
	for (const [name, parameter] of Object.entries(parameters).sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		if (parameter.required) {
			hints.push(`--${name} <${name}>`);
			continue;
		}
		if (parameter.default !== undefined) {
			hints.push(`--${name}`);
		}
	}
	return hints.length > 0 ? ` ${hints.join(' ')}` : '';
}
