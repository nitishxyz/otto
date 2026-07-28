import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';
import {
	Callout,
	Diagram,
	DiagramFlow,
	DiagramNode,
	DiagramRow,
	DocHero,
	Steps,
} from '../../components/docs';

export function RemoteAccess() {
	return (
		<DocPage>
			<DocHero
				eyebrow="Remote access"
				title="Reach your daemon from anywhere"
				lede="Your sessions stay on your machine. Tunnels give a phone, tablet, or teammate a controlled path to the same local daemon — no cloud copy of your project."
				tags={['quick tunnel', 'managed tunnel', 'project shares']}
			/>

			<Diagram
				label="tunnel / your machine stays the source of truth"
				status="credentials required"
				md={`phone / laptop  -->  cloudflare tunnel  -->  otto daemon (127.0.0.1)
                                          |
                              project runtimes, sessions, tools

quick tunnel    anonymous, random URL, per serve session
managed tunnel  stable hostname, needs an OttoRouter login`}
			>
				<DiagramRow cols={2}>
					<DiagramNode
						label="remote device"
						title="Browser on your phone"
						accent="blue"
						desc="Loads the bundled web UI from the tunnel origin."
					/>
					<DiagramNode
						label="edge"
						title="Cloudflare tunnel"
						accent="coral"
						desc="Quick (anonymous) or managed (stable hostname via OttoRouter)."
					/>
				</DiagramRow>

				<DiagramFlow label="authenticated" />

				<DiagramNode
					label="your machine"
					title="otto daemon"
					emphasis
					accent="lime"
					desc="Navigation and static assets are reachable so the browser can authenticate; API calls still require daemon or share credentials."
					items={[
						'project runtimes and SQLite stay local',
						'share tokens are scoped to one project',
						'revoking a share ends access immediately',
					]}
				/>
			</Diagram>

			<h2>Quick tunnel</h2>
			<p>
				One command, no account. The tunnel binary downloads on first use and
				the URL changes every session.
			</p>
			<CodeBlock>{`otto serve --tunnel`}</CodeBlock>
			<Steps
				items={[
					{
						title: 'First run downloads the tunnel binary',
						desc: 'One-time, roughly 17 MB.',
					},
					{
						title: 'An anonymous Cloudflare tunnel is created',
						desc: 'No Cloudflare account required.',
					},
					{
						title: 'Scan the QR code or copy the URL',
						desc: 'The web UI can also start a tunnel from the globe icon in the sidebar.',
					},
				]}
			/>

			<h2>Managed tunnel</h2>
			<p>
				Persistent machine-sharing access with a stable hostname, tied to your
				OttoRouter account. Enable it once and the daemon keeps it up across
				restarts.
			</p>
			<CodeBlock>{`otto tunnel enable
otto tunnel status
otto tunnel disable`}</CodeBlock>
			<p>
				If OttoRouter is not linked yet, <code>otto tunnel enable</code> offers
				to log in. In CI, link it first:
			</p>
			<CodeBlock>{`otto auth login ottorouter
# or
otto ottorouter --login`}</CodeBlock>

			<Callout kind="warn" title="Treat tunnel URLs as credentials">
				<p>
					Anyone with a live URL and a valid share token can drive sessions on
					your machine — including tools that run shell commands. Share
					deliberately, and disable the tunnel when you are done.
				</p>
			</Callout>

			<h2>LAN access</h2>
			<p>
				When the other device is on the same network, skip tunnels entirely.
			</p>
			<CodeBlock>{`otto serve --network            # binds 0.0.0.0
otto web --network`}</CodeBlock>

			<h2>Sharing vs. remote access</h2>
			<table>
				<thead>
					<tr>
						<th>Goal</th>
						<th>Use</th>
						<th>What the other side gets</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Show a finished session</td>
						<td>
							<code>otto share</code>
						</td>
						<td>Read-only snapshot on a public viewer</td>
					</tr>
					<tr>
						<td>Use otto from your phone</td>
						<td>
							<code>otto tunnel enable</code>
						</td>
						<td>Live workspace on your machine</td>
					</tr>
					<tr>
						<td>Quick one-off demo</td>
						<td>
							<code>otto serve --tunnel</code>
						</td>
						<td>Live workspace, temporary URL</td>
					</tr>
					<tr>
						<td>Same Wi-Fi only</td>
						<td>
							<code>--network</code>
						</td>
						<td>Live workspace, LAN-only address</td>
					</tr>
				</tbody>
			</table>
			<p>
				For read-only links, see <a href="/docs/sharing">Session Sharing</a>.
			</p>
		</DocPage>
	);
}
