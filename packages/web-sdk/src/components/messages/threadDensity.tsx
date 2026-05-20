import { createContext, useContext, type ReactNode } from 'react';

export type ThreadDensity = 'normal' | 'compact';

const ThreadDensityContext = createContext<ThreadDensity>('normal');

export function ThreadDensityProvider({
	density,
	children,
}: {
	density: ThreadDensity;
	children: ReactNode;
}) {
	return (
		<ThreadDensityContext.Provider value={density}>
			{children}
		</ThreadDensityContext.Provider>
	);
}

export function useThreadDensity(): ThreadDensity {
	return useContext(ThreadDensityContext);
}

export function useIsCompactThread(): boolean {
	return useThreadDensity() === 'compact';
}
