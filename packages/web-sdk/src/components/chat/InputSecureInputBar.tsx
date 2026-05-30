import { memo, useCallback, useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { apiClient } from '../../lib/api-client';
import { useSecureInputStore } from '../../stores/secureInputStore';

interface InputSecureInputBarProps {
	sessionId: string;
}

export const InputSecureInputBar = memo(function InputSecureInputBar({
	sessionId,
}: InputSecureInputBarProps) {
	const pendingInputs = useSecureInputStore((s) => s.pendingInputs);
	const removePendingInput = useSecureInputStore((s) => s.removePendingInput);
	const [value, setValue] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const pending = pendingInputs[0];

	const handleSubmit = useCallback(async () => {
		if (!pending || submitting) return;
		setSubmitting(true);
		try {
			await apiClient.submitSecureInput(sessionId, pending.promptId, value);
			removePendingInput(pending.promptId);
			setValue('');
		} catch (error) {
			console.error('Failed to submit secure input:', error);
		} finally {
			setSubmitting(false);
		}
	}, [pending, removePendingInput, sessionId, submitting, value]);

	const handleCancel = useCallback(async () => {
		if (!pending || submitting) return;
		setSubmitting(true);
		try {
			await apiClient.cancelSecureInput(sessionId, pending.promptId);
			removePendingInput(pending.promptId);
			setValue('');
		} catch (error) {
			console.error('Failed to cancel secure input:', error);
		} finally {
			setSubmitting(false);
		}
	}, [pending, removePendingInput, sessionId, submitting]);

	if (!pending) return null;

	return (
		<div className="mb-2 rounded-xl border border-amber-500/40 bg-card/95 p-3 shadow-lg backdrop-blur">
			<div className="mb-2 flex items-start gap-2">
				<KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
				<div className="min-w-0 flex-1">
					<div className="text-xs font-medium text-foreground">
						Secure input required
					</div>
					<div className="truncate text-[11px] text-muted-foreground">
						{pending.prompt}
					</div>
				</div>
				<button
					type="button"
					onClick={handleCancel}
					className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
					title="Cancel secure input"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			</div>
			<div className="flex items-center gap-2">
				<input
					type="password"
					value={value}
					onChange={(event) => setValue(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							void handleSubmit();
						}
					}}
					className="min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-sm outline-none focus:border-primary"
					placeholder="Enter password or passphrase"
					autoComplete="off"
					spellCheck={false}
				/>
				<button
					type="button"
					onClick={handleSubmit}
					disabled={submitting}
					className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
				>
					{submitting ? 'Sending…' : 'Send'}
				</button>
			</div>
			<div className="mt-1 text-[10px] text-muted-foreground/80">
				Sent directly to the running shell process. Not added to chat history.
			</div>
		</div>
	);
});
