import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';
import {
	Callout,
	CardGrid,
	Diagram,
	DiagramFlow,
	DiagramNode,
	DiagramRow,
	DocCard,
	DocHero,
} from '../../components/docs';

export function AgentsTools() {
	return (
		<DocPage>
			<DocHero
				eyebrow="Agents & tools"
				title="Presets, tool groups, and delegation"
				lede="An agent is a prompt plus an allowed tool set. Tools are the actions it can take. Skills, MCP servers, and plugins extend that set without bloating a single prompt."
				tags={['build', 'plan', 'general', 'research']}
			/>

			<Diagram
				label="agent / what a session is allowed to do"
				status="per project"
				md={`agent preset  ->  prompt + allowed tool groups

core         progress_update · update_todos · skill · load_tools
filesystem   read · write · edit · multiedit · apply_patch · ls · tree · search
risky        shell · terminal · git_commit          (approval gated)
git          git_status · git_diff
research     query_sessions · query_messages · search_history · get_session_context
orchestration subagent · goal_list · goal_update
external     MCP tools · project tools · plugins`}
			>
				<DiagramRow cols={2}>
					<DiagramNode
						label="preset"
						title="Agent"
						accent="lime"
						emphasis
						desc="Prompt, default model, and the tool groups it may call."
						items={[
							'build · plan · general · research',
							'project agents in .otto/agents/',
						]}
					/>
					<DiagramNode
						label="runtime"
						title="Tool resolution"
						accent="blue"
						desc="Built-ins plus anything discovered for this project."
						items={[
							'project + global tool plugins',
							'MCP servers',
							'lazily loaded tool bundles',
						]}
					/>
				</DiagramRow>

				<DiagramFlow label="grant" />

				<DiagramRow cols={3}>
					<DiagramNode
						label="always allowed"
						title="Read & inspect"
						accent="lime"
						items={[
							'read, ls, tree, search',
							'git_status, git_diff',
							'websearch',
						]}
					/>
					<DiagramNode
						label="approval class"
						title="Mutate & execute"
						accent="coral"
						items={[
							'write, edit, apply_patch',
							'shell, terminal, forge',
							'git_commit, git_push',
						]}
					/>
					<DiagramNode
						label="coordination"
						title="Delegation"
						accent="yellow"
						items={['subagent delegate/message', 'goal_list, goal_update']}
					/>
				</DiagramRow>
			</Diagram>

			<h2>Built-in agents</h2>
			<CardGrid cols={2}>
				<DocCard
					kicker="default"
					title="build"
					accent="lime"
					desc="Implementation: code changes, tests, fixes. Full editing and execution tools."
					footnote='otto ask "implement this" --agent build'
				/>
				<DocCard
					kicker="read-first"
					title="plan"
					accent="blue"
					desc="Explores the codebase and produces a plan without editing files."
					footnote='otto ask "plan this refactor" --agent plan'
				/>
				<DocCard
					kicker="broad"
					title="general"
					accent="yellow"
					desc="General help across coding and non-coding questions."
					footnote='otto ask "what does this service do" --agent general'
				/>
				<DocCard
					kicker="history"
					title="research"
					accent="coral"
					desc="Searches past sessions and messages alongside the code."
					footnote='otto ask "did we try this before?" --agent research'
				/>
			</CardGrid>
			<CodeBlock>{`otto agents            # list and configure
otto agents --local    # project agents
otto tools             # tools and which agents can use them`}</CodeBlock>

			<h2>Tool approval</h2>
			<p>
				Approval mode decides which tool calls pause for a yes/no. Set it in
				config, or change it per session from the TUI and web UI.
			</p>
			<CodeBlock>{`{
	"defaults": {
		"toolApproval": "dangerous"   // auto | dangerous | all | yolo
	}
}`}</CodeBlock>
			<table>
				<thead>
					<tr>
						<th>Mode</th>
						<th>Pauses for</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>auto</code>
						</td>
						<td>Nothing — safety guards still apply</td>
					</tr>
					<tr>
						<td>
							<code>dangerous</code>
						</td>
						<td>Writes, patches, shell, terminal, commits</td>
					</tr>
					<tr>
						<td>
							<code>all</code>
						</td>
						<td>Every tool except progress and todo updates</td>
					</tr>
					<tr>
						<td>
							<code>yolo</code>
						</td>
						<td>Nothing, and safety guards are skipped</td>
					</tr>
				</tbody>
			</table>
			<Callout kind="warn" title="yolo means yolo">
				<p>
					<code>yolo</code> also bypasses the guard checks that catch
					destructive commands. Use it only in disposable environments.
				</p>
			</Callout>

			<h2>Custom agents</h2>
			<p>
				Keep project agents small and task-specific. Prompt overrides are plain
				Markdown or text.
			</p>
			<CodeBlock>{`.otto/
├── agents.json
└── agents/
    └── reviewer.md

~/.config/otto/agents/reviewer.md    # same agent, machine-wide`}</CodeBlock>
			<CodeBlock>{`otto scaffold          # generate an agent, tool, or command`}</CodeBlock>

			<h2>Custom tools</h2>
			<p>
				Tools are plugins discovered from project and global tool directories.
			</p>
			<CodeBlock>{`.otto/tools/<tool-name>/tool.js
~/.config/otto/tools/<tool-name>/tool.js`}</CodeBlock>

			<h2>Skills</h2>
			<p>
				Skills are reusable instruction bundles the agent loads on demand with
				the <code>skill</code> tool. Use them instead of growing one enormous
				prompt. Full details in <a href="/docs/skills">Skills</a>.
			</p>
			<CodeBlock>{`otto skills list
otto skills show <name>
otto skills validate`}</CodeBlock>

			<h2>Delegation</h2>
			<p>
				Agents can hand bounded work to child agents with the{' '}
				<code>subagent</code> tool. Results are delivered back automatically, so
				the parent keeps working instead of polling. Longer-running goals are
				tracked with <code>goal_list</code> and <code>goal_update</code>.
			</p>

			<h2>External tools</h2>
			<CardGrid cols={3}>
				<DocCard
					kicker="protocol"
					title="MCP servers"
					accent="blue"
					desc="Add tools from local processes or remote MCP endpoints."
					href="/docs/mcp"
					footnote="otto mcp add <name>"
				/>
				<DocCard
					kicker="registry"
					title="Plugins"
					accent="yellow"
					desc="Install packaged skills, commands, agents, and MCP servers."
					href="/docs/plugins"
					footnote="otto plugins search"
				/>
				<DocCard
					kicker="instructions"
					title="Skills"
					accent="lime"
					desc="On-demand instruction bundles the agent loads when relevant."
					href="/docs/skills"
					footnote="otto skills list"
				/>
			</CardGrid>
		</DocPage>
	);
}
