import { useState, useId } from 'react';
import { GitBranch } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { StableSpinner } from '../ui/StableSpinner';
import { useCreateBranch } from '../../hooks/useBranch';
import { useSession } from '../../hooks/useSessions';
import type { Message } from '../../types/api';

interface BranchModalProps {
	isOpen: boolean;
	onClose: () => void;
	sessionId: string;
	message: Message;
	onBranchCreated?: (newSessionId: string) => void;
}

export function BranchModal({
	isOpen,
	onClose,
	sessionId,
	message,
	onBranchCreated,
}: BranchModalProps) {
	const session = useSession(sessionId);
	const createBranch = useCreateBranch(sessionId);

	const [title, setTitle] = useState('');
	const [useCurrentConfig, setUseCurrentConfig] = useState(true);
	const titleId = useId();
	const configId = useId();

	const messagePreview =
		message.parts?.find((p) => p.type === 'text')?.content || '';
	const parsedPreview = (() => {
		try {
			const parsed = JSON.parse(messagePreview);
			return parsed?.text?.slice(0, 100) || '';
		} catch {
			return messagePreview.slice(0, 100);
		}
	})();

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		try {
			const result = await createBranch.mutateAsync({
				fromMessageId: message.id,
				title: title.trim() || undefined,
				provider: useCurrentConfig ? session?.provider : undefined,
				model: useCurrentConfig ? session?.model : undefined,
				agent: useCurrentConfig ? session?.agent : undefined,
			});

			onClose();
			if (onBranchCreated && result.session) {
				onBranchCreated(result.session.id);
			}
		} catch (error) {
			console.error('Failed to create branch:', error);
		}
	};

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			title={
				<div className="flex items-center gap-2">
					<GitBranch className="h-5 w-5 text-primary" />
					<span>Branch Session</span>
				</div>
			}
			maxWidth="md"
		>
			<form onSubmit={handleSubmit} className="space-y-4">
				<div className="text-sm text-muted-foreground">
					<p>Creating branch from message:</p>
					<p className="mt-1 p-2 bg-muted/50 rounded text-foreground italic truncate">
						"{parsedPreview}..."
					</p>
				</div>

				<div className="space-y-2">
					<label
						htmlFor={titleId}
						className="block text-sm font-medium text-foreground"
					>
						Branch Title (optional)
					</label>
					<input
						id={titleId}
						type="text"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder={`Branch of ${session?.title || 'Untitled'}`}
						className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
					/>
				</div>

				<div className="flex items-center gap-2">
					<input
						id={configId}
						type="checkbox"
						checked={useCurrentConfig}
						onChange={(e) => setUseCurrentConfig(e.target.checked)}
						className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
					/>
					<label htmlFor={configId} className="text-sm text-foreground">
						Use same provider/model/agent as parent
					</label>
				</div>

				{session && (
					<div className="text-xs text-muted-foreground bg-muted/30 rounded p-2">
						<div className="flex gap-4">
							<span>
								<strong>Provider:</strong> {session.provider}
							</span>
							<span>
								<strong>Model:</strong> {session.model}
							</span>
							<span>
								<strong>Agent:</strong> {session.agent}
							</span>
						</div>
					</div>
				)}

				<div className="flex justify-end gap-2 pt-2">
					<button
						type="button"
						onClick={onClose}
						className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={createBranch.isPending}
						className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
					>
						{createBranch.isPending ? (
							<>
								<StableSpinner title="Creating branch" />
								Creating...
							</>
						) : (
							<>
								<GitBranch className="h-4 w-4" />
								Create Branch
							</>
						)}
					</button>
				</div>

				{createBranch.isError && (
					<p className="text-sm text-red-500">
						{createBranch.error?.message || 'Failed to create branch'}
					</p>
				)}
			</form>
		</Modal>
	);
}
