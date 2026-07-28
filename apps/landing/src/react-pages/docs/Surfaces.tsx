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

export function Surfaces() {
	return (
		<DocPage>
			<DocHero
				eyebrow="Surfaces"
				title="Same runtime, five front doors"
				lede="Terminal, browser, native app, launcher, and editor integrations are all clients of the same local daemon. Sessions started in one show up in the others."
				tags={['tui', 'web', 'desktop', 'launcher', 'acp']}
			/>

			<Diagram
				label="surfaces / pick per task"
				status="one session store"
				md={`otto          interactive TUI, the default
otto ask      one-shot prompt for scripts and CI
otto web      browser workspace on the local daemon
desktop app   native window (Tauri), local + remote projects
launcher app  zero-setup: provision, clone, run
otto --acp    editor-driven session over stdio`}
			>
				<DiagramRow cols={3}>
					<DiagramNode
						label="otto"
						title="Terminal UI"
						accent="lime"
						desc="The default. Sessions, approvals, model and agent switching, slash commands."
					/>
					<DiagramNode
						label="otto ask"
						title="One-shot CLI"
						accent="coral"
						desc="Single prompt in, streamed answer out. Scriptable and CI friendly."
					/>
					<DiagramNode
						label="otto web"
						title="Browser workspace"
						accent="blue"
						desc="Sessions, git, files, terminals, and previews served by the daemon."
					/>
					<DiagramNode
						label="desktop"
						title="Native app"
						accent="yellow"
						desc="Tauri shell that embeds the CLI and web UI, with project switching."
					/>
					<DiagramNode
						label="launcher"
						title="Zero-setup app"
						accent="yellow"
						desc="Installs prerequisites, sets up SSH and git, clones a repo, and starts otto."
					/>
					<DiagramNode
						label="otto --acp"
						title="Editor agent"
						accent="blue"
						desc="Agent Client Protocol: your editor renders the UI, otto does the work."
					/>
				</DiagramRow>
			</Diagram>

			<h2>Terminal</h2>
			<p>
				Running <code>otto</code> with no arguments ensures a daemon, opens the
				current project, and launches the TUI.
			</p>
			<CodeBlock>{`otto                                  # interactive TUI
otto --agent plan                     # start on a specific agent
otto --provider anthropic --model claude-sonnet-4-5
otto ask "why is the nightly job timing out?"
otto ask "review this diff" --agent general`}</CodeBlock>

			<h2>Browser</h2>
			<p>
				<code>otto web</code> reuses the daemon and opens this project in the
				bundled web UI. Point it at an existing API when you want the UI without
				a local server.
			</p>
			<CodeBlock>{`otto web
otto web --no-open
otto web --url https://your-otto-host    # connect to an existing API`}</CodeBlock>
			<p>
				<code>otto serve</code> is the standalone foreground mode: it runs the
				API and web UI in one process instead of using the shared daemon.
			</p>
			<CodeBlock>{`otto serve
otto serve --port 3000       # API on :3000, web UI on :3001
otto serve --network         # bind 0.0.0.0 — LAN access, use deliberately
otto serve --api-only`}</CodeBlock>

			<h2>Desktop and launcher</h2>
			<CardGrid cols={2}>
				<DocCard
					kicker="apps/desktop"
					title="otto desktop"
					accent="yellow"
					desc="Native window around the full workspace. Embeds the CLI binary, reuses or replaces a stale daemon, and passes project id + daemon token to the UI."
					items={[
						'macOS .dmg/.app, Linux AppImage, Windows',
						'local folders and connected remote projects',
						'compares daemon version before reusing it',
					]}
				/>
				<DocCard
					kicker="apps/launcher"
					title="otto launcher"
					accent="lime"
					desc="For machines that are not set up yet. Installs system packages, configures SSH and git, clones the repo, installs dependencies, then starts otto."
					items={[
						'guided project setup with live progress',
						'project cards with ports and status',
						'good first stop for non-terminal users',
					]}
				/>
			</CardGrid>

			<h2>Editors</h2>
			<p>
				Any Agent Client Protocol editor can start otto as a background agent.
				The editor owns rendering; otto owns the session, tools, MCP servers,
				and history.
			</p>
			<CodeBlock>{`otto --acp`}</CodeBlock>
			<p>
				See the <a href="/docs/acp">ACP integration guide</a> for editor
				configuration and troubleshooting.
			</p>

			<h2>Beyond the local machine</h2>
			<CardGrid cols={3}>
				<DocCard
					kicker="read-only links"
					title="Session sharing"
					accent="blue"
					desc="Publish a snapshot of a session to a public viewer URL."
					href="/docs/sharing"
					footnote="otto share"
				/>
				<DocCard
					kicker="tunnels"
					title="Remote access"
					accent="coral"
					desc="Reach your machine's daemon from a phone or another device."
					href="/docs/remote-access"
					footnote="otto tunnel enable"
				/>
				<DocCard
					kicker="your app"
					title="Embedding"
					accent="yellow"
					desc="Drive otto from your own service through the generated client."
					href="/docs/embedding"
					footnote="@ottocode/api"
				/>
			</CardGrid>

			<Callout kind="note" title="Mobile is in development">
				<p>
					An Expo client lives in <code>apps/mobile</code>. Until it ships, the
					supported way to use otto from a phone is the web UI over a tunnel.
				</p>
			</Callout>

			<h2>Which one should I use?</h2>
			<table>
				<thead>
					<tr>
						<th>Situation</th>
						<th>Reach for</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Day-to-day coding in a terminal</td>
						<td>
							<code>otto</code>
						</td>
					</tr>
					<tr>
						<td>Scripts, git hooks, CI</td>
						<td>
							<code>otto ask</code>
						</td>
					</tr>
					<tr>
						<td>Reviewing diffs, files, and terminals side by side</td>
						<td>
							<code>otto web</code>
						</td>
					</tr>
					<tr>
						<td>No terminal habit, or a fresh machine</td>
						<td>desktop / launcher</td>
					</tr>
					<tr>
						<td>Staying inside your editor</td>
						<td>
							<code>otto --acp</code>
						</td>
					</tr>
					<tr>
						<td>Hosting otto inside another product</td>
						<td>
							<code>@ottocode/server</code> + <code>@ottocode/api</code>
						</td>
					</tr>
				</tbody>
			</table>
		</DocPage>
	);
}
