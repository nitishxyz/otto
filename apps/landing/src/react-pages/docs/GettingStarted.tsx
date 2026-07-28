import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';

export function GettingStarted() {
	return (
		<DocPage>
			<h1 className="np-title mb-3">Getting Started</h1>
			<p className="text-otto-dim text-sm mb-8">
				Install otto, configure a model provider, and run your first prompt.
			</p>

			<h2>Install</h2>
			<p>Use the install script for the prebuilt CLI:</p>
			<CodeBlock>{`curl -fsSL https://install.ottocode.io | sh`}</CodeBlock>
			<p>
				Make sure the install directory is on your <code>PATH</code>, then check
				the binary:
			</p>
			<CodeBlock>{`otto --version`}</CodeBlock>

			<h2>Build from source</h2>
			<p>Use this if you are working on the repo locally.</p>
			<CodeBlock>{`git clone https://github.com/nitishxyz/otto.git
cd otto
bun install
bun run compile`}</CodeBlock>

			<h2>Configure a provider</h2>
			<p>
				Run the setup flow, or configure credentials through the auth command.
			</p>
			<CodeBlock>{`otto setup
otto auth login`}</CodeBlock>
			<p>Environment variables also work for supported providers:</p>
			<CodeBlock>{`ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GOOGLE_GENERATIVE_AI_API_KEY=...
OPENROUTER_API_KEY=...
OTTOROUTER_PRIVATE_KEY=...`}</CodeBlock>

			<h2>Run otto</h2>
			<CodeBlock>{`otto                         # interactive terminal UI
otto ask "explain this file" # one-shot prompt
otto serve --no-open         # local API + web UI server
otto web                     # web UI command`}</CodeBlock>

			<h2>Useful checks</h2>
			<CodeBlock>{`otto doctor      # diagnose local configuration
otto models      # choose/list models
otto agents      # choose/list agents
otto --help      # show CLI help`}</CodeBlock>

			<h2>Troubleshooting</h2>
			<ul>
				<li>
					If <code>otto</code> is not found, add the install directory to{' '}
					<code>PATH</code> or use the absolute path to the binary.
				</li>
				<li>
					If model calls fail, run <code>otto doctor</code> and verify provider
					credentials with <code>otto auth list</code>.
				</li>
				<li>
					If you are developing locally, use Bun for all commands in this repo.
				</li>
			</ul>
		</DocPage>
	);
}
