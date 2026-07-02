import { createFileRoute } from '@tanstack/react-router';
import { SessionsLayout } from '../components/sessions/SessionsLayout';

export const Route = createFileRoute('/looper/')({
	component: LooperIndexRoute,
});

function LooperIndexRoute() {
	return <SessionsLayout view="looper" />;
}
