import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { PierreDiffProvider } from '@ottocode/web-sdk/components';
import { createPierreWorker } from './lib/pierre-worker';
import { router } from './router';

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			structuralSharing: true,
		},
	},
});

export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			{/* Offloads Shiki highlighting for every diff surface in the app. */}
			<PierreDiffProvider workerFactory={createPierreWorker}>
				<RouterProvider router={router} />
			</PierreDiffProvider>
		</QueryClientProvider>
	);
}

export default App;
