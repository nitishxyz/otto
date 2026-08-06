import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PierreDiffProvider } from '@ottocode/web-sdk/components';
import App from './App';
import './index.css';
import { initAutoHideScrollbar } from './lib/auto-hide-scrollbar';
import { createPierreWorker } from './lib/pierre-worker';

initAutoHideScrollbar();

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30000,
			retry: 1,
		},
	},
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
	<React.StrictMode>
		<QueryClientProvider client={queryClient}>
			{/* Offloads Shiki highlighting for every diff surface in the app. */}
			<PierreDiffProvider workerFactory={createPierreWorker}>
				<App />
			</PierreDiffProvider>
		</QueryClientProvider>
	</React.StrictMode>,
);
