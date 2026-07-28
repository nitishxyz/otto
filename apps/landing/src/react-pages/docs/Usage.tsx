import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';
import {
	Callout,
	CardGrid,
	Diagram,
	DiagramNode,
	DiagramRow,
	DocCard,
	DocHero,
} from '../../components/docs';

export function Usage() {
	return (
		<DocPage>
			<DocHero
				eyebrow="Usage"
				title="The commands you actually run"
				lede="Prompting, sessions, providers, the shared daemon, and the escape hatches when something looks wrong. The CLI's --help output is always the source of truth for flags."
				tags={['prompt', 'sessions', 'daemon', 'plugins', 'diagnostics']}
			/>

			<Diagram
				label="cli / command map"
				status="otto --help"
				md={`work        otto · otto ask · otto web
context     sessions · share · projects
config      setup · auth · models · providers · agents · tools
extend      mcp · skills · plugins · scaffold
runtime     service · projects · tunnel
check       doctor · debug · upgrade`}
			>
				<DiagramRow cols={3}>
					<DiagramNode
						label="work"
						title="Prompt"
						accent="lime"
						items={['otto', 'otto ask', 'otto web']}
					/>
					<DiagramNode
						label="context"
						title="Sessions & projects"
						accent="blue"
						items={['otto sessions', 'otto share', 'otto projects']}
					/>
					<DiagramNode
						label="config"
						title="Models & agents"
						accent="blue"
						items={['otto setup', 'otto auth', 'otto models', 'otto agents']}
					/>
					<DiagramNode
						label="extend"
						title="Tools & plugins"
						accent="yellow"
						items={['otto mcp', 'otto skills', 'otto plugins', 'otto scaffold']}
					/>
					<DiagramNode
						label="runtime"
						title="Daemon & access"
						accent="coral"
						items={['otto service', 'otto projects', 'otto tunnel']}
						desc="Daemon lifecycle, open projects, remote access."
					/>
					<DiagramNode
						label="check"
						title="Diagnostics"
						accent="coral"
						items={['otto doctor', 'otto debug', 'otto upgrade']}
					/>
				</DiagramRow>
			</Diagram>

			<h2>Prompting</h2>
			<CodeBlock>{`otto                                   # interactive terminal UI
otto ask "fix the failing test"
otto ask "review this change" --agent general
otto ask "make a plan first" --agent plan
otto --provider anthropic --model claude-sonnet-4-5`}</CodeBlock>
			<p>
				Try a model that is not in the catalog yet with an explicit provider and{' '}
				<code>--wild</code>:
			</p>
			<CodeBlock>{`otto ask "hello" --provider xai --model grok-composer-2.5-fast --wild`}</CodeBlock>

			<h2>Sessions</h2>
			<CodeBlock>{`otto sessions              # interactive picker
otto sessions --list
otto sessions --json
otto sessions --limit 10
otto share                 # publish a read-only link`}</CodeBlock>

			<h2>The shared daemon</h2>
			<p>
				Every surface reuses one local daemon. These commands are how you
				inspect and reset it.
			</p>
			<CodeBlock>{`otto service status
otto service start --port 47477
otto service restart
otto service stop
otto service token         # print the local daemon token`}</CodeBlock>
			<CodeBlock>{`otto projects list
otto projects open <path>
otto projects close <id>
otto projects forget <id-or-path>`}</CodeBlock>

			<Callout kind="tip" title="After upgrading">
				<p>
					A daemon from an older version is not reused. If a client seems stuck
					on stale behavior, run <code>otto service restart</code>.
				</p>
			</Callout>

			<h2>Web UI and standalone server</h2>
			<CodeBlock>{`otto web                          # this project, via the daemon
otto web --url <api-url>          # UI against an existing API
otto web --no-open

otto serve                        # standalone foreground API + UI
otto serve --port 3000            # API :3000, web UI :3001
otto serve --network              # bind 0.0.0.0
otto serve --tunnel               # public URL + QR code
otto serve --api-only`}</CodeBlock>

			<h2>Models, providers, and auth</h2>
			<CodeBlock>{`otto setup
otto models                # pick provider/model defaults
otto providers list
otto auth login
otto auth list
otto auth logout`}</CodeBlock>

			<h2>Agents, tools, skills, plugins</h2>
			<CodeBlock>{`otto agents                # list/configure agents
otto agents --local        # project agents
otto tools                 # tools and agent access
otto scaffold              # generate an agent, tool, or command

otto skills list
otto skills show <name>
otto skills validate

otto plugins list
otto plugins search <query>
otto plugins install <source> --scope project
otto plugins enable <name>`}</CodeBlock>
			<CodeBlock>{`otto mcp list
otto mcp add <name>
otto mcp test <name>
otto mcp auth <name>`}</CodeBlock>
			<p>
				See <a href="/docs/skills">Skills</a> for authoring{' '}
				<code>SKILL.md</code> files and <a href="/docs/plugins">Plugins</a> for
				packaging and installing them.
			</p>

			<h2>Remote access</h2>
			<CodeBlock>{`otto tunnel enable
otto tunnel status
otto tunnel disable`}</CodeBlock>
			<p>
				Details, including the difference between quick and managed tunnels, are
				in <a href="/docs/remote-access">Remote Access</a>.
			</p>

			<h2>Diagnostics and maintenance</h2>
			<CodeBlock>{`otto doctor
otto debug status
otto debug on <scope>
otto debug off
otto upgrade`}</CodeBlock>
			<p>
				Run <code>otto doctor</code> first whenever provider, path, database, or
				server behavior looks wrong.
			</p>

			<h2>Related</h2>
			<CardGrid cols={3}>
				<DocCard
					kicker="settings"
					title="Configuration"
					accent="blue"
					desc="Where config, credentials, and project overrides live."
					href="/docs/configuration"
				/>
				<DocCard
					kicker="clients"
					title="Surfaces & Apps"
					accent="lime"
					desc="TUI, web, desktop, launcher, and editors."
					href="/docs/surfaces"
				/>
				<DocCard
					kicker="extend"
					title="Plugins"
					accent="yellow"
					desc="Skills, commands, agents, and MCP servers in one install."
					href="/docs/plugins"
				/>
			</CardGrid>
		</DocPage>
	);
}
