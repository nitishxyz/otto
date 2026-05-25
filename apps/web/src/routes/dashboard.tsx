import { useEffect } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { UsageDashboard } from '@ottocode/web-sdk';

export const Route = createFileRoute('/dashboard')({
	component: DashboardRoute,
});

function DashboardRoute() {
	const navigate = useNavigate();
	useEffect(() => {
		const prev = document.title;
		document.title = 'Usage · otto';
		return () => {
			document.title = prev;
		};
	}, []);
	return (
		<UsageDashboard
			onBack={() => {
				if (window.history.length > 1) {
					window.history.back();
				} else {
					navigate({ to: '/sessions' });
				}
			}}
		/>
	);
}
