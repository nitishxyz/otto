import { useKeyboard } from '@opentui/react';
import { useCallback, useRef, useState } from 'react';
import { useTheme } from '../theme.ts';
import type { PendingSecureInput } from '../types.ts';

interface SecureInputBarProps {
	pendingInput: PendingSecureInput;
	onSubmit: (promptId: string, value: string) => Promise<void> | void;
	onCancel: (promptId: string) => Promise<void> | void;
}

export function SecureInputBar({
	pendingInput,
	onSubmit,
	onCancel,
}: SecureInputBarProps) {
	const { colors } = useTheme();
	const [value, setValue] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const valueRef = useRef(value);
	const submittingRef = useRef(submitting);
	valueRef.current = value;
	submittingRef.current = submitting;

	const submit = useCallback(async () => {
		if (submittingRef.current) return;
		setSubmitting(true);
		try {
			await onSubmit(pendingInput.promptId, valueRef.current);
			setValue('');
		} finally {
			setSubmitting(false);
		}
	}, [onSubmit, pendingInput.promptId]);

	const cancel = useCallback(async () => {
		if (submittingRef.current) return;
		setSubmitting(true);
		try {
			await onCancel(pendingInput.promptId);
			setValue('');
		} finally {
			setSubmitting(false);
		}
	}, [onCancel, pendingInput.promptId]);

	useKeyboard((key) => {
		if (submittingRef.current) return;
		if (key.name === 'return') {
			void submit();
			return;
		}
		if (key.name === 'escape') {
			void cancel();
			return;
		}
		if (key.name === 'backspace') {
			setValue((prev) => prev.slice(0, -1));
			return;
		}
		if (key.ctrl || key.meta) return;
		if (key.raw && key.raw.length === 1) {
			setValue((prev) => `${prev}${key.raw}`);
			return;
		}
		if (key.name === 'space') {
			setValue((prev) => `${prev} `);
		}
	});

	const masked = value.length > 0 ? '•'.repeat(Math.min(value.length, 32)) : '';

	return (
		<box
			style={{
				width: '100%',
				flexShrink: 0,
				flexDirection: 'column',
				paddingLeft: 1,
				paddingRight: 1,
				paddingTop: 1,
				paddingBottom: 1,
				backgroundColor: '#3d2e00',
			}}
		>
			<box style={{ flexDirection: 'row', gap: 1, width: '100%' }}>
				<text fg={colors.yellow}>🔐 secure input required</text>
				<text fg={colors.fgMuted}>{pendingInput.prompt}</text>
			</box>
			<box style={{ flexDirection: 'row', gap: 1, width: '100%' }}>
				<text fg={colors.fgDark}>password:</text>
				<text fg={colors.fgBright}>{masked}</text>
				{value.length === 0 && <text fg={colors.fgDark}>type secret…</text>}
				<text fg={colors.green}>↵ send</text>
				<text fg={colors.red}>esc cancel</text>
				{submitting && <text fg={colors.blue}>sending…</text>}
			</box>
			<text fg={colors.fgDark}>
				Sent directly to the running process. Not added to chat history.
			</text>
		</box>
	);
}
