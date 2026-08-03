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
	Steps,
} from '../../components/docs';

export function Plugins() {
	return (
		<DocPage>
			<DocHero
				eyebrow="Plugins"
				title="Bundle skills, commands, agents, and MCP servers"
				lede="A plugin is one directory with an otto.plugin.json manifest. Install it globally or per project and the agent picks up everything it declares — no prompt surgery required."
				tags={['otto.plugin.json', 'registry', 'global / project', 'skills']}
			/>

			<Diagram
				label="plugin / one manifest, many capabilities"
				status="enabled per scope"
				md={`otto.plugin.json
  skills      -> loaded on demand by the agent
  recipes     -> saved multi-step workflows
  agents      -> extra agent presets
  mcpServers  -> external tool servers
  commands    -> /<plugin> <command> in a visible terminal
  browser     -> preview URL for the workspace viewer
  requirements-> platform / command / env / toolchain checks`}
			>
				<DiagramNode
					label="package"
					title="otto.plugin.json"
					accent="lime"
					emphasis
					desc="Name, version, platforms, requirements — plus whatever capabilities the plugin adds."
				/>
				<DiagramFlow label="install" />
				<DiagramRow cols={3}>
					<DiagramNode
						label="knowledge"
						title="skills · recipes"
						accent="blue"
						items={['loaded on demand', 'synced to .agents/skills']}
					/>
					<DiagramNode
						label="capability"
						title="agents · mcpServers"
						accent="yellow"
						items={['extra presets', 'external tool servers']}
					/>
					<DiagramNode
						label="action"
						title="commands · browser"
						accent="coral"
						items={['/<plugin> <command>', 'workspace preview URL']}
					/>
				</DiagramRow>
			</Diagram>

			<h2>Install</h2>
			<CodeBlock>{`otto plugins search                 # browse the official registry
otto plugins search simulator
otto plugins info <name>

otto plugins install <name>                     # global (default)
otto plugins install <name> --scope project
otto plugins install ./my-plugin                # local directory
otto plugins install <name> --registry <url>    # custom registry`}</CodeBlock>
			<p>
				Registry installs default to global scope; local directory installs
				default to project scope.
			</p>

			<h2>Manage</h2>
			<CodeBlock>{`otto plugins list
otto plugins list --json
otto plugins enable <name>
otto plugins disable <name>
otto plugins update <name>
otto plugins remove <name>`}</CodeBlock>
			<p>
				Every command takes <code>--scope global|project</code> and{' '}
				<code>--project &lt;path&gt;</code>.
			</p>

			<h2>Scopes</h2>
			<p>
				Plugins install into two independent control planes. When both scopes
				have the same plugin, the project entry wins.
			</p>
			<CodeBlock>{`~/.config/otto/plugins.json     ~/.config/otto/plugins/<name>/    # global
.otto/plugins.json              .otto/plugins/<name>/             # project`}</CodeBlock>
			<CodeBlock>{`{
  "version": 1,
  "registries": [],
  "plugins": {
    "serve-sim": {
      "enabled": true,
      "source": "official:serve-sim",
      "version": "1.0.0"
    }
  }
}`}</CodeBlock>

			<Callout kind="tip" title="Project plugins are shareable">
				<p>
					Commit <code>.otto/plugins.json</code> so teammates get the same
					toolchain. The plugin payload itself is re-fetched on install.
				</p>
			</Callout>

			<h2>Plugin commands</h2>
			<p>
				Declared commands show up to the agent as{' '}
				<code>/&lt;plugin&gt; &lt;command&gt;</code>. They run in a{' '}
				<em>visible</em> terminal through <code>forge</code> with kind{' '}
				<code>plugin-command</code>, which is approval-gated like any other
				execution tool.
			</p>
			<CodeBlock>{`/serve-sim start
/expo doctor --fix`}</CodeBlock>

			<h2>Writing a plugin</h2>
			<Steps
				items={[
					{
						title: 'Create the directory and manifest',
						desc: 'The manifest is the whole contract — name and version are the only required fields.',
						code: 'my-plugin/otto.plugin.json',
					},
					{
						title: 'Declare what it adds',
						desc: 'Skills, recipes, agents, MCP servers, commands, browser preview, requirements.',
					},
					{
						title: 'Install it locally to test',
						code: 'otto plugins install ./my-plugin --scope project',
					},
					{
						title: 'Check it resolved',
						desc: 'Status shows installed / missing / invalid with the parse error if any.',
						code: 'otto plugins list',
					},
				]}
			/>

			<h3>Manifest example</h3>
			<CodeBlock>{`{
  "$schema": "https://ottocode.ai/schemas/plugin.json",
  "name": "serve-sim",
  "displayName": "serve-sim",
  "publisher": "EvanBacon",
  "version": "1.0.0",
  "description": "Apple Simulator workflows via serve-sim.",
  "platforms": ["darwin"],
  "tags": ["ios", "simulator"],
  "skills": [
    {
      "name": "serve-sim",
      "description": "Control and stream a running Simulator.",
      "source": {
        "type": "github",
        "repo": "EvanBacon/serve-sim",
        "ref": "main",
        "path": "skills/serve-sim",
        "include": ["SKILL.md", "references/**"]
      }
    }
  ],
  "recipes": [
    { "name": "inspect-ios-app", "path": "recipes/inspect-ios-app.md" }
  ],
  "commands": {
    "start": { "label": "Start serve-sim", "command": "npx", "args": ["serve-sim"] }
  },
  "browser": { "previewUrl": "http://localhost:3200" },
  "requirements": [
    { "kind": "platform", "value": "darwin", "message": "Requires macOS." },
    { "kind": "command", "value": "xcrun", "message": "Install Xcode CLI tools." }
  ]
}`}</CodeBlock>

			<h3>Manifest fields</h3>
			<table>
				<thead>
					<tr>
						<th>Field</th>
						<th>Purpose</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>skills</code>
						</td>
						<td>
							Instruction bundles, by <code>path</code> or a fetched{' '}
							<code>source</code>
						</td>
					</tr>
					<tr>
						<td>
							<code>recipes</code>
						</td>
						<td>Saved multi-step workflows shipped as Markdown</td>
					</tr>
					<tr>
						<td>
							<code>agents</code>
						</td>
						<td>Extra presets with their own prompt, model, and tool groups</td>
					</tr>
					<tr>
						<td>
							<code>mcpServers</code>
						</td>
						<td>MCP server definitions registered with the project</td>
					</tr>
					<tr>
						<td>
							<code>commands</code>
						</td>
						<td>Terminal commands with typed parameters and a fallback</td>
					</tr>
					<tr>
						<td>
							<code>browser</code>
						</td>
						<td>Preview URL surfaced in the workspace viewer</td>
					</tr>
					<tr>
						<td>
							<code>requirements</code>
						</td>
						<td>
							<code>platform</code>, <code>command</code>, <code>env</code>, or{' '}
							<code>toolchain</code> preconditions
						</td>
					</tr>
					<tr>
						<td>
							<code>dependencies</code>
						</td>
						<td>Other plugins installed alongside this one</td>
					</tr>
				</tbody>
			</table>

			<h2>Registries</h2>
			<p>
				The default registry is the official list in the otto repo. Point at
				your own with <code>--registry</code>, or add entries to{' '}
				<code>registries</code> in <code>plugins.json</code>. Registry entries
				can resolve to a GitHub path or a local directory.
			</p>
			<CodeBlock>{`packages/plugin-registry/registry.json          # official list
packages/plugin-registry/official/<name>/       # official payloads`}</CodeBlock>

			<Callout kind="warn" title="Plugins run code on your machine">
				<p>
					Commands, MCP servers, and requirements execute locally. Install from
					sources you trust, and read the manifest before enabling something
					unfamiliar.
				</p>
			</Callout>

			<h2>Related</h2>
			<CardGrid cols={3}>
				<DocCard
					kicker="behavior"
					title="Agents & Tools"
					accent="lime"
					desc="How tool groups, approvals, and skills fit together."
					href="/docs/agents-tools"
				/>
				<DocCard
					kicker="protocol"
					title="MCP Servers"
					accent="blue"
					desc="Add tools without packaging a plugin."
					href="/docs/mcp"
				/>
				<DocCard
					kicker="settings"
					title="Configuration"
					accent="yellow"
					desc="Where plugins.json and project overrides live."
					href="/docs/configuration"
				/>
			</CardGrid>
		</DocPage>
	);
}
