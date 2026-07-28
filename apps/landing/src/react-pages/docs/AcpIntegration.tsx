import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';
import {
	Diagram,
	DiagramFlow,
	DiagramNode,
	DocHero,
} from '../../components/docs';

export function AcpIntegration() {
	return (
		<DocPage>
			<DocHero
				eyebrow="ACP"
				title="otto inside your editor"
				lede="Agent Client Protocol lets an editor run otto as a background agent over stdio. The editor renders everything; otto owns the session, tools, and history."
				tags={['stdio', 'editor ui', 'otto --acp']}
			/>

			<Diagram
				label="acp / editor drives, otto works"
				status="stdout is protocol"
				md={`editor  <--stdio-->  otto --acp  -->  otto session runtime
																		 tools, MCP, slash commands, history

editor renders: file edits, terminal output, tool calls, permissions`}
			>
				<DiagramNode
					label="client"
					title="ACP editor"
					accent="blue"
					desc="Starts otto as a child process and renders every update in its own UI."
				/>
				<DiagramFlow label="jsonrpc / stdio" />
				<DiagramNode
					label="agent"
					title="otto --acp"
					accent="lime"
					emphasis
					desc="Same agents, tools, models, and session history as the terminal UI."
				/>
			</Diagram>

			<h2>What this does</h2>
			<p>
				ACP lets an editor start otto as a background process and talk to it
				over stdin/stdout. The editor owns the UI. Otto handles the agent
				session, model calls, tools, slash commands, MCP servers, and session
				history.
			</p>
			<p>
				Use this when you want otto inside an ACP-compatible editor instead of
				the otto terminal UI.
			</p>

			<h2>Requirements</h2>
			<ul>
				<li>
					An installed <code>otto</code> CLI that is available on your{' '}
					<code>PATH</code>
				</li>
				<li>An ACP-compatible editor or editor extension</li>
				<li>
					At least one configured provider/model in otto, the same as normal CLI
					usage
				</li>
			</ul>

			<h2>Editor setup</h2>
			<p>
				Add otto as a custom ACP agent in your editor. The command is always:
			</p>
			<CodeBlock>{`otto --acp`}</CodeBlock>
			<p>
				The exact settings shape depends on your editor. A typical JSON-based
				configuration looks like this:
			</p>
			<CodeBlock>{`{
  "command": "otto",
  "args": ["--acp"],
  "env": {}
}`}</CodeBlock>
			<p>
				If your editor cannot find <code>otto</code>, use the absolute path to
				the binary instead of <code>otto</code>.
			</p>

			<h2>How to use it</h2>
			<ol>
				<li>Open a project folder in your editor.</li>
				<li>Select otto as the ACP agent.</li>
				<li>Start a new agent session.</li>
				<li>Send prompts the same way you would in the otto CLI.</li>
			</ol>
			<p>
				The editor may show file edits, terminal output, tool calls, and
				permission prompts using its own UI. That is expected; otto is running
				headlessly behind it.
			</p>

			<h2>What otto supports over ACP</h2>
			<ul>
				<li>New, load, list, close, and resume session flows</li>
				<li>Project working directories and additional directories</li>
				<li>Text prompts, image prompts, and embedded context</li>
				<li>Available models and agent modes from your otto configuration</li>
				<li>Slash commands, including MCP-related commands</li>
				<li>MCP servers passed by the ACP client</li>
				<li>Tool call updates, file edits, terminal output, and plans</li>
			</ul>

			<h2>Troubleshooting</h2>
			<h3>The editor cannot start otto</h3>
			<ul>
				<li>
					Run <code>otto --version</code> in a normal terminal to confirm the
					CLI is installed.
				</li>
				<li>
					If that works in your shell but not in the editor, configure the
					editor with the absolute path to <code>otto</code>.
				</li>
				<li>
					Do not wrap the command in an interactive shell unless your editor
					requires it.
				</li>
			</ul>

			<h3>The agent starts but cannot use a model</h3>
			<ul>
				<li>Check that your provider credentials are configured for otto.</li>
				<li>
					Open the same project in a terminal and run a normal otto prompt to
					verify the configuration outside ACP.
				</li>
			</ul>

			<h3>Output looks broken or the connection closes</h3>
			<ul>
				<li>
					ACP uses stdout for protocol messages. Logs and errors should go to
					stderr.
				</li>
				<li>
					Avoid shell aliases or wrapper scripts that print banners, prompts, or
					other text to stdout before starting otto.
				</li>
			</ul>

			<h2>For maintainers</h2>
			<p>
				The ACP adapter lives in <code>packages/acp</code>. The public CLI entry
				point is <code>otto --acp</code>, which calls <code>runAcp()</code> and
				starts an <code>AgentSideConnection</code> using{' '}
				<code>@agentclientprotocol/sdk</code>.
			</p>
			<CodeBlock>{`packages/acp/src/index.ts   # stdio transport setup
packages/acp/src/agent.ts   # ACP Agent implementation
packages/acp/src/events.ts  # otto stream events -> ACP updates
packages/acp/src/tools.ts   # tool output mapping`}</CodeBlock>
		</DocPage>
	);
}
