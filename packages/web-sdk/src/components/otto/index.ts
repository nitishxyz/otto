export { OttoTabBar, type WorkspaceTab } from './OttoTabBar';
export { OttoSessionRail } from './OttoSessionRail';
export { OttoWorkspace } from './OttoWorkspace';
export { OttoSessionView } from './OttoSessionView';
export { OttoGoalBar } from './OttoGoalBar';
// Hosts should gate Otto routes/tabs on this flag; the components above also
// self-gate defensively when otto is disabled on the server.
export { useOttoEnabled } from '../../hooks/useGoals';
