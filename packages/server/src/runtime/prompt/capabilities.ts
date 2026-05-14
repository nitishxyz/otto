import {
	filterDiscoveredSkills,
	getMCPManager,
	summarizeDescription,
	type DiscoveredSkill,
	type OttoConfig,
} from '@ottocode/sdk';

const MAX_SKILLS = 8;
const MAX_MCP_SERVERS = 8;
const MAX_MCP_TOOLS_PER_SERVER = 3;

export type CapabilitySummaryMCPTool = {
	name: string;
	server: string;
	description?: string;
};

export type CapabilitySummaryResult = {
	prompt: string;
	components: string[];
};

/**
 * Build a compact prompt block that advertises available skills and started MCP
 * servers without inlining their full instructions or tool catalogs.
 */
export function buildCapabilitySummary(options?: {
	skillSettings?: OttoConfig['skills'];
	skills?: DiscoveredSkill[];
	mcpTools?: CapabilitySummaryMCPTool[];
}): CapabilitySummaryResult {
	const skillLines = options?.skills
		? buildSkillLines(options.skills, options.skillSettings)
		: [];
	const mcpLines = buildMCPLines(options?.mcpTools);
	const components = ['capabilities'];
	const sections: string[] = [];

	if (skillLines.length > 0) {
		sections.push(['Skills:', ...skillLines].join('\n'));
		components.push('capabilities:skills');
	}
	if (mcpLines.length > 0) {
		sections.push(['Started MCP capabilities:', ...mcpLines].join('\n'));
		components.push('capabilities:mcp');
	}

	if (sections.length === 0) {
		return { prompt: '', components: [] };
	}

	const prompt = [
		'<optional-capabilities>',
		'You have additional capabilities available when they may help with the task.',
		'Use them proactively when relevant, but do not load or call them unnecessarily.',
		'',
		sections.join('\n\n'),
		'',
		'When one of these capabilities may help, prefer using it instead of ignoring it.',
		'</optional-capabilities>',
	].join('\n');

	return { prompt, components };
}

function buildSkillLines(
	providedSkills: DiscoveredSkill[],
	skillSettings: OttoConfig['skills'] | undefined,
): string[] {
	const skills = filterDiscoveredSkills(providedSkills, skillSettings);
	const seen = new Set<string>();
	const unique: DiscoveredSkill[] = [];

	for (const skill of skills) {
		const name = skill.name.trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		unique.push(skill);
	}

	unique.sort((a, b) => {
		const aExplicitlyEnabled = skillSettings?.items?.[a.name]?.enabled === true;
		const bExplicitlyEnabled = skillSettings?.items?.[b.name]?.enabled === true;
		if (aExplicitlyEnabled !== bExplicitlyEnabled) {
			return aExplicitlyEnabled ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});

	const visible = unique.slice(0, MAX_SKILLS).map((skill) => {
		const summary = finalizeSentence(summarizeDescription(skill.description));
		const description = summary || 'Task-specific instructions and guidance';
		return `- ${skill.name}: ${description}. Load with \`skill\` when it matches the task.`;
	});

	const remaining = unique.length - visible.length;
	if (remaining > 0) {
		visible.push(
			`- ${remaining} more skill${remaining === 1 ? '' : 's'} available via \`skill\`.`,
		);
	}

	return visible;
}

function buildMCPLines(
	providedMCPTools: CapabilitySummaryMCPTool[] | undefined,
): string[] {
	const tools = providedMCPTools ?? getLiveMCPTools();
	if (tools.length === 0) return [];

	const grouped = new Map<string, CapabilitySummaryMCPTool[]>();
	for (const tool of tools) {
		const list = grouped.get(tool.server) ?? [];
		list.push(tool);
		grouped.set(tool.server, list);
	}

	const servers = Array.from(grouped.entries()).sort(([a], [b]) =>
		a.localeCompare(b),
	);
	const visible = servers
		.slice(0, MAX_MCP_SERVERS)
		.map(([server, serverTools]) => {
			const summary = summarizeMCPServer(server, serverTools);
			return `- ${server}: ${summary}. Load relevant tools with \`load_mcp_tools\` when the task may benefit from them.`;
		});

	const remaining = servers.length - visible.length;
	if (remaining > 0) {
		visible.push(
			`- ${remaining} more started MCP server${remaining === 1 ? '' : 's'} available via \`load_mcp_tools\`.`,
		);
	}

	return visible;
}

function getLiveMCPTools(): CapabilitySummaryMCPTool[] {
	const manager = getMCPManager();
	if (!manager?.started) return [];
	return manager.getTools().map(({ name, server, tool }) => ({
		name,
		server,
		description: tool.description,
	}));
}

function summarizeMCPServer(
	server: string,
	tools: CapabilitySummaryMCPTool[],
): string {
	const namedTools = dedupeStrings(
		tools
			.map((tool) => stripServerPrefix(tool.name, server))
			.filter((name) => name.length > 0),
	);
	const representativeNames = namedTools.slice(0, MAX_MCP_TOOLS_PER_SERVER);
	const descriptiveText = dedupeStrings(
		tools
			.map((tool) => tool.description?.trim() ?? '')
			.filter((description) => description.length > 0)
			.map((description) => description.replace(/^MCP tool:\s*/i, '')),
	).map((description) => finalizeSentence(description));
	const summaryFromDescription = descriptiveText.find(
		(description) => description.length > 0,
	);

	if (summaryFromDescription) {
		if (representativeNames.length === 0) {
			return summaryFromDescription;
		}
		return `${summaryFromDescription}; tools include ${representativeNames.join(', ')}`;
	}

	if (representativeNames.length === 0) {
		return `external tools exposed by the ${server} MCP server`;
	}

	return `external ${server} tools such as ${representativeNames.join(', ')}`;
}

function stripServerPrefix(name: string, server: string): string {
	const prefix = `${server}__`;
	return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

function finalizeSentence(value: string): string {
	const normalized = value.replace(/\s+/g, ' ').trim();
	if (!normalized) return '';
	return normalized.replace(/[.!?;:,\s]+$/g, '');
}

function dedupeStrings(values: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		const normalized = value.trim();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		out.push(normalized);
	}
	return out;
}
