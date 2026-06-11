import { createFileRoute } from '@tanstack/react-router';
import { SessionsLayout } from '../components/sessions/SessionsLayout';

export const Route = createFileRoute('/otto/')({
	component: OttoIndexRoute,
});

function OttoIndexRoute() {
	return <SessionsLayout view="otto" />;
}
