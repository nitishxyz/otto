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

export function Skills() {
	return (
		<DocPage>
			<DocHero
				eyebrow="Skills"
				title="Instructions the agent loads on demand"
				lede="A skill is a SKILL.md file with frontmatter. otto shows the agent a one-line summary of each one and only pulls in the full text when the task actually matches."
				tags={['SKILL.md', 'frontmatter', 'on demand', 'cross-harness']}
			/>

			<Diagram
				label="skill / summary now, body later"
				status="token efficient"
				md={`discovery   scan skill dirs -> name + description per skill
prompt      agent sees the short list, not the bodies
load        agent calls the \`skill\` tool with a name
use         full SKILL.md + its reference files enter the context`}
			>
				<DiagramRow cols={2}>
					<DiagramNode
						label="always in prompt"
						title="Name + description"
						accent="lime"
						desc="One line per skill. Cheap enough to list everything you have."
					/>
					<DiagramNode
						label="on request"
						title="Full skill body"
						accent="blue"
						desc="Loaded only when the agent decides the skill applies."
					/>
				</DiagramRow>
				<DiagramFlow label="skill tool" />
				<DiagramNode
					label="session"
					title="Working context"
					accent="yellow"
					emphasis
					desc="Instructions plus any reference files the skill directory ships."
				/>
			</Diagram>

			<h2>Where skills live</h2>
			<p>
				otto reads its own directories and the cross-harness ones, so skills you
				already wrote for other agents work unchanged. Project scope wins over
				user scope on a name collision.
			</p>
			<CodeBlock>{`# project
.otto/skills/<name>/SKILL.md
.agents/skills/<name>/SKILL.md
.claude/skills/<name>/SKILL.md
.codex/skills/<name>/SKILL.md

# user
~/.config/otto/skills/<name>/SKILL.md
~/.agents/skills/<name>/SKILL.md
~/.claude/skills/<name>/SKILL.md
~/.codex/skills/<name>/SKILL.md`}</CodeBlock>

			<h2>Commands</h2>
			<CodeBlock>{`otto skills list
otto skills list --json
otto skills show <name>
otto skills create            # interactive scaffold
otto skills validate [path]`}</CodeBlock>

			<h2>Writing a skill</h2>
			<p>
				Frontmatter carries the metadata; everything after it is the instruction
				body. <code>description</code> is what the agent sees when deciding
				whether to load the skill, so make it about <em>when to use it</em>, not
				just what it is.
			</p>
			<CodeBlock>{`---
name: release-checklist
description: Cut a release for this repo. Use when asked to publish, tag, or ship a version.
allowed-tools:
  - shell
  - git_status
  - git_diff
---

# Release checklist

1. Confirm the working tree is clean.
2. Update the changelog from merged PR titles.
3. Tag with \`v<version>\` and push tags.

See references/versioning.md for the version scheme.`}</CodeBlock>

			<h3>Frontmatter fields</h3>
			<table>
				<thead>
					<tr>
						<th>Field</th>
						<th>Notes</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>name</code>
						</td>
						<td>Required. Identifier the agent passes to the skill tool.</td>
					</tr>
					<tr>
						<td>
							<code>description</code>
						</td>
						<td>
							Trigger text. Derived from the first line if you omit it — write
							it yourself.
						</td>
					</tr>
					<tr>
						<td>
							<code>allowed-tools</code>
						</td>
						<td>Optional tool allowlist while the skill is active.</td>
					</tr>
					<tr>
						<td>
							<code>license</code>, <code>compatibility</code>,{' '}
							<code>metadata</code>
						</td>
						<td>Optional provenance and free-form metadata.</td>
					</tr>
				</tbody>
			</table>

			<h3>Reference files</h3>
			<p>
				A skill can ship supporting files next to <code>SKILL.md</code>. The
				agent loads them individually by relative path, so keep the main file
				short and push detail into references.
			</p>
			<CodeBlock>{`.otto/skills/release-checklist/
├── SKILL.md
└── references/
    ├── versioning.md
    └── changelog-template.md`}</CodeBlock>
			<p>
				Reads are sandboxed to the skill directory, limited to text-like
				extensions, and capped at 256 KB per file.
			</p>

			<Callout kind="tip" title="Skills over giant prompts">
				<p>
					If an agent prompt is growing a section that only matters sometimes,
					that section is a skill. The agent stays cheap by default and pulls
					the detail in when it is relevant.
				</p>
			</Callout>

			<Callout kind="warn" title="Skills are instructions, not sandboxes">
				<p>
					A skill can tell the agent to run commands. Review third-party skills
					before dropping them into a project — otto flags suspicious content
					but does not execute in isolation.
				</p>
			</Callout>

			<h2>Shipping skills to others</h2>
			<p>
				Package skills in a plugin when you want them installable and versioned.
				Plugin skills can point at a path in the plugin or a GitHub source that
				is fetched on install, then synced into <code>.agents/skills</code>.
			</p>

			<h2>Related</h2>
			<CardGrid cols={3}>
				<DocCard
					kicker="packaging"
					title="Plugins"
					accent="lime"
					desc="Bundle skills, commands, agents, and MCP servers."
					href="/docs/plugins"
				/>
				<DocCard
					kicker="behavior"
					title="Agents & Tools"
					accent="blue"
					desc="How the skill tool fits into the agent's tool set."
					href="/docs/agents-tools"
				/>
				<DocCard
					kicker="settings"
					title="Configuration"
					accent="yellow"
					desc="Project and global directories otto reads."
					href="/docs/configuration"
				/>
			</CardGrid>
		</DocPage>
	);
}
