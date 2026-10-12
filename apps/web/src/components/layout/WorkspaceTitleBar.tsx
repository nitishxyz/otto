import { memo } from 'react';
import {
	TitleBar,
	TitleBarRightRailToggle,
} from '@ottocode/web-sdk/components';

export const WorkspaceTitleBar = memo(function WorkspaceTitleBar() {
	return (
		<TitleBar
			className="hidden md:flex"
			trailing={
				<div className="flex items-center gap-2">
					<TitleBarRightRailToggle />
				</div>
			}
		/>
	);
});
