import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';

export function Sharing() {
	return (
		<DocPage>
			<h1 className="np-title mb-3">Session Sharing</h1>
			<p className="text-otto-dim text-sm mb-8">
				Create read-only links for otto sessions.
			</p>

			<h2>Use it</h2>
			<CodeBlock>{`otto share
otto share <session-id>
otto share --list
otto share <session-id> --status`}</CodeBlock>
			<p>
				The share command uploads a copy of a local session to the share service
				and returns a public URL.
			</p>

			<h2>What to check before sharing</h2>
			<ul>
				<li>Review the session for secrets or private project details.</li>
				<li>
					Do not share sessions containing API keys or private credentials.
				</li>
				<li>Use status/list commands to see what has already been shared.</li>
			</ul>

			<h2>Updating or removing</h2>
			<CodeBlock>{`otto share <session-id> --update
otto share <session-id> --delete`}</CodeBlock>
			<p>
				Use <code>--update</code> after a shared session receives new messages.
				Use <code>--delete</code> when a public link should no longer resolve.
			</p>
		</DocPage>
	);
}
