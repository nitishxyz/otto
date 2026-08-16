import { memo, useState } from 'react';
import {
	TerminalViewer,
	type TerminalViewerProps,
} from '@ottocode/web-sdk/components';
import { selectDesktopTerminalBackend } from '../../lib/desktop-terminal-backend';
import { NativeTerminalViewer } from './NativeTerminalViewer';

export const DesktopTerminalViewer = memo(function DesktopTerminalViewer(
	props: TerminalViewerProps,
) {
	const [
		officialWasmInitializationFailed,
		setOfficialWasmInitializationFailed,
	] = useState(false);
	const backend = selectDesktopTerminalBackend(
		officialWasmInitializationFailed,
	);

	if (backend === 'native') return <NativeTerminalViewer {...props} />;

	return (
		<TerminalViewer
			{...props}
			onInitializationError={() => setOfficialWasmInitializationFailed(true)}
		/>
	);
});
