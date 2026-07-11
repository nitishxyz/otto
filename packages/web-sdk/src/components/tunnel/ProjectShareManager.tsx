import { memo, useState } from 'react';
import { Copy, Check, Trash2, Plus, Link2 } from 'lucide-react';
import { StableSpinner } from '../ui/StableSpinner';
import {
	useTunnelShares,
	useCreateTunnelShare,
	useRevokeTunnelShare,
	type TunnelShare,
} from '../../hooks/useTunnel';

interface ProjectShareManagerProps {
	projectId: string | null;
	projectName: string | null;
	/** Whether the managed remote tunnel is connected and can mint shares. */
	ready: boolean;
}

/**
 * Owner-only manager for managed project shares: create a per-project share
 * link, list active shares, copy their URLs, and revoke them.
 */
export const ProjectShareManager = memo(function ProjectShareManager({
	projectId,
	projectName,
	ready,
}: ProjectShareManagerProps) {
	const { data: shares, isLoading } = useTunnelShares(ready);
	const createShare = useCreateTunnelShare();
	const revokeShare = useRevokeTunnelShare();

	const projectShares = (shares ?? []).filter(
		(share) => share.projectId === projectId,
	);

	if (!ready) {
		return (
			<p className="text-xs text-muted-foreground/70 leading-relaxed">
				Managed project shares need a connected managed tunnel. Turn on remote
				access first.
			</p>
		);
	}

	if (!projectId) {
		return (
			<p className="text-xs text-muted-foreground/70 italic">
				Open a project to share it.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<button
				type="button"
				onClick={() => createShare.mutate(projectId)}
				disabled={createShare.isPending}
				className="flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
			>
				{createShare.isPending ? (
					<StableSpinner size="sm" title="Creating share" />
				) : (
					<Plus className="w-3.5 h-3.5" />
				)}
				Create share link
			</button>

			{createShare.error && (
				<p className="text-xs text-destructive">{createShare.error.message}</p>
			)}

			{isLoading ? (
				<div className="flex items-center gap-2 py-1">
					<StableSpinner size="sm" title="Loading shares" />
					<span className="text-xs text-muted-foreground">Loading shares…</span>
				</div>
			) : projectShares.length === 0 ? (
				<p className="text-xs text-muted-foreground/70 leading-relaxed">
					No active shares for
					{projectName ? ` "${projectName}"` : ' this project'}. Each link
					grants access to only this project.
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{projectShares.map((share) => (
						<ShareRow
							key={share.id}
							share={share}
							onRevoke={() => revokeShare.mutate(share.id)}
							revoking={
								revokeShare.isPending && revokeShare.variables === share.id
							}
						/>
					))}
				</ul>
			)}
		</div>
	);
});

interface ShareRowProps {
	share: TunnelShare;
	onRevoke: () => void;
	revoking: boolean;
}

const ShareRow = memo(function ShareRow({
	share,
	onRevoke,
	revoking,
}: ShareRowProps) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(share.url);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard may be unavailable; ignore.
		}
	};

	return (
		<li className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2">
			<Link2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
			<span className="flex-1 truncate font-mono text-xs text-foreground">
				{shareLabel(share.url)}
			</span>
			<button
				type="button"
				onClick={handleCopy}
				className="p-1 text-muted-foreground hover:text-foreground transition-colors"
				title="Copy share link"
			>
				{copied ? (
					<Check className="w-3.5 h-3.5 text-green-500" />
				) : (
					<Copy className="w-3.5 h-3.5" />
				)}
			</button>
			<button
				type="button"
				onClick={onRevoke}
				disabled={revoking}
				className="p-1 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
				title="Revoke share"
			>
				{revoking ? (
					<StableSpinner size="sm" title="Revoking" />
				) : (
					<Trash2 className="w-3.5 h-3.5" />
				)}
			</button>
		</li>
	);
});

function shareLabel(url: string): string {
	try {
		const parsed = new URL(url);
		const token = parsed.searchParams.get('share');
		const host = parsed.hostname;
		const suffix = token ? `…${token.slice(-6)}` : '';
		return `${host}${suffix}`;
	} catch {
		return url;
	}
}
