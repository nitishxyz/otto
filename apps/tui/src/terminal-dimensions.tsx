import { useTerminalDimensions as useOpenTuiTerminalDimensions } from '@opentui/react';
import { createContext, useContext, type ReactNode } from 'react';

interface TerminalDimensions {
	width: number;
	height: number;
}

const TerminalDimensionsContext = createContext<TerminalDimensions | null>(
	null,
);

export function TerminalDimensionsProvider({
	children,
}: {
	children: ReactNode;
}) {
	const dimensions = useOpenTuiTerminalDimensions();

	return (
		<TerminalDimensionsContext.Provider value={dimensions}>
			{children}
		</TerminalDimensionsContext.Provider>
	);
}

export function useTerminalDimensions(): TerminalDimensions {
	const dimensions = useContext(TerminalDimensionsContext);
	if (!dimensions) {
		throw new Error(
			'useTerminalDimensions must be used within a TerminalDimensionsProvider',
		);
	}
	return dimensions;
}
