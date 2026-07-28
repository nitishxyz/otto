import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';

export function AgentsTools() {
	return (
		<DocPage>
			<h1 className="np-title mb-3">Agents & Tools</h1>
			<p className="text-otto-dim text-sm mb-8">
				How otto chooses behavior and what the agent can do.
			</p>

			<h2>Agents</h2>
			<p>
				An agent is a preset: instructions plus an allowed tool set. Use the
				built-in agents for common workflows, then add project-specific agents
				when needed.
			</p>
			<CodeBlock>{`otto agents
otto ask "implement this" --agent build
otto ask "make a plan" --agent plan
otto ask "research this codepath" --agent research`}</CodeBlock>

			<h2>Built-in agents</h2>
			<ul>
				<li>
					<code>build</code> — code changes, tests, fixes, and implementation.
				</li>
				<li>
					<code>plan</code> — analysis and implementation plans before edits.
				</li>
				<li>
					<code>general</code> — general help across coding tasks.
				</li>
				<li>
					<code>research</code> — inspect code and prior session context.
				</li>
			</ul>

			<h2>Tools</h2>
			<p>
				Tools are the actions an agent can call: read files, search, edit, run
				commands, inspect git state, manage terminals, and report progress.
			</p>
			<CodeBlock>{`otto tools`}</CodeBlock>
			<p>
				Tool availability depends on the selected agent and project config. Run
				<code>otto tools</code> in the project to see the current list.
			</p>

			<h2>Custom agents</h2>
			<p>
				Keep project agents in <code>.otto/agents/</code> and register them in
				project config when needed. Prefer small, task-specific prompts.
			</p>
			<CodeBlock>{`.otto/
├── agents.json
└── agents/
    └── reviewer.md`}</CodeBlock>

			<h2>Skills</h2>
			<p>
				Skills are reusable instruction bundles loaded on demand. Use them for
				repeatable workflows instead of putting everything in one large agent
				prompt.
			</p>
			<CodeBlock>{`otto skills list
otto skills show <name>
otto skills validate`}</CodeBlock>

			<h2>MCP tools</h2>
			<p>
				MCP servers can add more tools at runtime. Configure them with the MCP
				commands instead of hard-coding tool definitions into agents.
			</p>
			<CodeBlock>{`otto mcp list
otto mcp add <name>
otto mcp test <name>`}</CodeBlock>
		</DocPage>
	);
}
