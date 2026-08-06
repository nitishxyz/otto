import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';
import { initAutoHideScrollbar } from './lib/auto-hide-scrollbar';

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
			<App />
		</QueryClientProvider>
	</React.StrictMode>,
);
