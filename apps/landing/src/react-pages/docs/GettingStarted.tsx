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
	Steps,
} from '../../components/docs';

export function GettingStarted() {
	return (
		<DocPage>
			<DocHero
				eyebrow="Getting started"
				title="Install, connect a model, ship"
				lede="otto runs entirely on your machine: one binary, one local daemon, your project's data in your project. Three commands get you to a first prompt."
				tags={['macos', 'linux', 'windows', 'bun optional']}
			/>

			<Diagram
				label="setup / three steps"
				status="~2 minutes"
				md={`1. install   curl -fsSL https://install.ottocode.io | sh
2. connect   otto setup   (or otto auth login <provider>)
3. run       otto         (TUI)  ·  otto ask "..."  ·  otto web`}
			>
				<DiagramRow cols={3}>
					<DiagramNode
						label="step 01"
						title="Install the binary"
						accent="lime"
						desc="Install script, Bun, or build from source."
					/>
					<DiagramNode
						label="step 02"
						title="Connect a provider"
						accent="blue"
						desc="OAuth, API key, or one OttoRouter balance across providers."
					/>
					<DiagramNode
						label="step 03"
						title="Run otto"
						accent="yellow"
						desc="Terminal UI by default; browser and one-shot modes share the same runtime."
					/>
				</DiagramRow>
			</Diagram>

			<h2>Install</h2>
			<CodeBlock>{`curl -fsSL https://install.ottocode.io | sh`}</CodeBlock>
			<p>Pin a release when you need reproducibility:</p>
			<CodeBlock>{`OTTO_VERSION=v0.1.231 curl -fsSL https://install.ottocode.io | sh`}</CodeBlock>
			<p>Other options:</p>
			<CodeBlock>{`bun install -g @ottocode/install     # via Bun

git clone https://github.com/nitishxyz/otto.git
cd otto && bun install && bun run compile   # from source`}</CodeBlock>
			<p>
				Make sure the install directory is on your <code>PATH</code>, then check
				the binary:
			</p>
			<CodeBlock>{`otto --version`}</CodeBlock>

			<Callout kind="tip" title="Prefer an app?">
				<p>
					The desktop app and the launcher install and manage the CLI for you.
					See <a href="/docs/surfaces">Surfaces &amp; Apps</a>.
				</p>
			</Callout>

			<h2>Connect a provider</h2>
			<p>
				<code>otto setup</code> walks through providers and picks a default
				model. <code>otto auth login</code> handles individual credentials,
				including OAuth flows.
			</p>
			<CodeBlock>{`otto setup
otto auth login              # pick a provider interactively
otto auth login anthropic
otto auth login ottorouter   # one balance across providers
otto auth list`}</CodeBlock>
			<p>Environment variables work too:</p>
			<CodeBlock>{`ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GOOGLE_GENERATIVE_AI_API_KEY=...
OPENROUTER_API_KEY=...`}</CodeBlock>
			<p>
				OttoRouter uses an OAuth login rather than an environment key — run{' '}
				<code>otto auth login ottorouter</code>. See{' '}
				<a href="/docs/ottorouter">OttoRouter</a>.
			</p>

			<h2>First run</h2>
			<CodeBlock>{`otto                          # interactive terminal UI
otto ask "explain this file"  # one-shot prompt
otto web                      # browser workspace
otto --agent plan             # start on the planning agent`}</CodeBlock>

			<h2>What happens the first time</h2>
			<Steps
				items={[
					{
						title: 'A local daemon starts',
						desc: 'One shared daemon per user on 127.0.0.1, reused by every otto surface.',
						code: 'otto service status',
					},
					{
						title: 'Your project is opened',
						desc: 'The current directory becomes a project runtime with its own config and database.',
						code: '.otto/',
					},
					{
						title: 'Sessions persist locally',
						desc: 'Messages, tool calls, and artifacts stay on your machine unless you explicitly share them.',
						code: 'otto sessions',
					},
				]}
			/>

			<Callout kind="note" title="Nothing leaves the machine by default">
				<p>
					Model calls go to the provider you configured. Session data is local
					until you run <code>otto share</code> or enable a tunnel.
				</p>
			</Callout>

			<h2>Useful checks</h2>
			<CodeBlock>{`otto doctor        # diagnose local configuration
otto models        # choose or list models
otto agents        # choose or list agents
otto tools         # tools available in this project
otto --help`}</CodeBlock>

			<h2>Troubleshooting</h2>
			<ul>
				<li>
					<code>otto: command not found</code> — add the install directory to{' '}
					<code>PATH</code>, or call the binary by absolute path.
				</li>
				<li>
					Model calls failing — run <code>otto doctor</code> and confirm
					credentials with <code>otto auth list</code>.
				</li>
				<li>
					Stale behavior after an upgrade — restart the daemon with{' '}
					<code>otto service restart</code>.
				</li>
				<li>Working in this repo? Use Bun for every command.</li>
			</ul>

			<h2>Where to next</h2>
			<CardGrid cols={3}>
				<DocCard
					kicker="daily driver"
					title="Usage Guide"
					accent="lime"
					desc="Commands, sessions, providers, and diagnostics."
					href="/docs/usage"
				/>
				<DocCard
					kicker="behavior"
					title="Agents & Tools"
					accent="blue"
					desc="Presets, tool groups, skills, and custom agents."
					href="/docs/agents-tools"
				/>
				<DocCard
					kicker="under the hood"
					title="Architecture"
					accent="yellow"
					desc="How the daemon, projects, and packages fit together."
					href="/docs/architecture"
				/>
			</CardGrid>
		</DocPage>
	);
}
