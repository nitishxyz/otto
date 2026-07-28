import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';
import {
	Callout,
	Diagram,
	DiagramFlow,
	DiagramNode,
	DocHero,
} from '../../components/docs';

export function Sharing() {
	return (
		<DocPage>
			<DocHero
				eyebrow="Sharing"
				title="Read-only links for sessions"
				lede="Publish a snapshot of one session to a public viewer. The share is a copy — your machine is never exposed, and the link stops resolving the moment you delete it."
				tags={['snapshot', 'public url', 'revocable']}
			/>

			<Diagram
				label="share / snapshot, not a connection"
				status="explicit action"
				md={`local session  --otto share-->  share service  -->  public viewer URL

--update  push new messages into an existing share
--delete  revoke the link
--until   share only up to a specific message`}
			>
				<DiagramNode
					label="local"
					title="Session on your machine"
					accent="lime"
					desc="Messages, tool calls, and artifacts in the project database."
				/>
				<DiagramFlow label="otto share" />
				<DiagramNode
					label="public"
					title="Viewer link"
					accent="blue"
					emphasis
					desc="A read-only copy. Nothing streams back to your daemon."
				/>
			</Diagram>

			<h2>Use it</h2>
			<CodeBlock>{`otto share                        # pick a session interactively
otto share <session-id>
otto share <session-id> --title "Checkout refactor"
otto share <session-id> --until <message-id>
otto share --list
otto share <session-id> --status`}</CodeBlock>

			<h2>Update or revoke</h2>
			<CodeBlock>{`otto share <session-id> --update   # push newer messages
otto share <session-id> --delete   # revoke the public link`}</CodeBlock>

			<Callout kind="warn" title="Read the transcript before you publish">
				<p>
					Shared sessions include prompts, file contents, diffs, and command
					output. Check for tokens, internal hostnames, and customer data first.
				</p>
			</Callout>

			<h2>Sharing vs. remote access</h2>
			<p>
				Sharing publishes a snapshot. If you want to actually <em>use</em> otto
				from another device, you want a tunnel instead — see{' '}
				<a href="/docs/remote-access">Remote Access</a>.
			</p>
		</DocPage>
	);
}
