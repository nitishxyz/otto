import { useState, useId, useEffect, useCallback } from 'react';
import { GitCommit, Sparkles } from 'lucide-react';
import { useGitStore } from '../../stores/gitStore';
import { useCommitChanges, useGenerateCommitMessage } from '../../hooks/useGit';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { Modal } from '../ui/Modal';
import { StableSpinner } from '../ui/StableSpinner';

export function GitCommitModal() {
	const isCommitModalOpen = useGitStore((state) => state.isCommitModalOpen);
	return isCommitModalOpen ? <GitCommitModalContent /> : null;
}

function GitCommitModalContent() {
	const closeCommitModal = useGitStore((state) => state.closeCommitModal);
	const commitSessionId = useGitStore((state) => state.commitSessionId);
	const commitChanges = useCommitChanges();
	const generateMessage = useGenerateCommitMessage(commitSessionId);
	const [message, setMessage] = useState('');
	const messageId = useId();

	const handleCommit = useCallback(async () => {
		if (!message.trim()) return;

		try {
			await commitChanges.mutateAsync(message);
			setMessage('');
			closeCommitModal();
		} catch (error) {
			console.error('Failed to commit:', error);
		}
	}, [message, commitChanges, closeCommitModal]);

	const handleClose = () => {
		setMessage('');
		closeCommitModal();
	};

	const handleGenerateMessage = useCallback(async () => {
		try {
			const result = await generateMessage.mutateAsync();
			setMessage(result.message);
		} catch (error) {
			console.error('Failed to generate commit message:', error);
		}
	}, [generateMessage]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
				e.preventDefault();
				e.stopPropagation();
				if (message.trim() && !commitChanges.isPending) {
					handleCommit();
				}
			}
			if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
				e.preventDefault();
				e.stopPropagation();
				handleGenerateMessage();
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [message, commitChanges.isPending, handleCommit, handleGenerateMessage]);

	return (
		<Modal
			isOpen
			onClose={handleClose}
			title={
				<div className="flex items-center gap-2">
					<GitCommit className="w-5 h-5" />
					<span>Commit Changes</span>
				</div>
			}
			maxWidth="2xl"
		>
			<div className="space-y-4">
				<div className="space-y-2">
					<label
						htmlFor={messageId}
						className="text-sm font-medium text-foreground"
					>
						Commit Message
					</label>
					<Textarea
						id={messageId}
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						placeholder="Enter commit message..."
						rows={6}
						className="w-full resize-none"
						autoFocus
						disabled={generateMessage.isPending}
					/>
				</div>

				<Button
					variant="secondary"
					onClick={handleGenerateMessage}
					className="w-full"
					disabled={generateMessage.isPending}
				>
					{generateMessage.isPending ? (
						<>
							<StableSpinner
								className="mr-2"
								title="Generating commit message"
							/>
							Generating...
						</>
					) : (
						<>
							<Sparkles className="w-4 h-4 mr-2" />
							Generate commit message{' '}
							<span className="text-muted-foreground ml-1">(⌘G)</span>
						</>
					)}
				</Button>

				{generateMessage.isError && (
					<div className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
						{generateMessage.error?.message ||
							'Failed to generate commit message'}
					</div>
				)}

				<div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
					<Button variant="ghost" onClick={handleClose}>
						Cancel <span className="text-muted-foreground ml-1">(Esc)</span>
					</Button>
					<Button
						variant="primary"
						onClick={handleCommit}
						disabled={!message.trim() || commitChanges.isPending}
					>
						{commitChanges.isPending ? (
							<span>Committing...</span>
						) : (
							<>
								<GitCommit className="w-4 h-4 mr-2" />
								Commit <span className="text-muted-foreground ml-1">(⌘↵)</span>
							</>
						)}
					</Button>
				</div>

				{commitChanges.isError && (
					<div className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
						{commitChanges.error?.message || 'Failed to commit changes'}
					</div>
				)}
			</div>
		</Modal>
	);
}
