import { useCallback, useState } from 'react';

interface UseSkillMentionReturn {
	showSkillMention: boolean;
	skillMentionQuery: string;
	skillMentionSelectedIndex: number;
	currentSkillToSelect: string | undefined;
	setShowSkillMention: (show: boolean) => void;
	setSkillMentionQuery: (query: string) => void;
	setSkillMentionSelectedIndex: (index: number) => void;
	setCurrentSkillToSelect: (skill: string | undefined) => void;
	handleSkillSelect: (
		skillName: string,
		textareaRef: React.RefObject<HTMLTextAreaElement>,
		setMessage: (msg: string) => void,
	) => void;
	handleEnterSelect: (skill: string | undefined) => void;
	checkForSkillMention: (value: string, cursorPos: number) => void;
}

const SKILL_TRIGGER_REGEX = /(^|[\s([{])\$([a-z0-9-]*)$/;

export function useSkillMention(): UseSkillMentionReturn {
	const [showSkillMention, setShowSkillMention] = useState(false);
	const [skillMentionQuery, setSkillMentionQuery] = useState('');
	const [skillMentionSelectedIndex, setSkillMentionSelectedIndex] = useState(0);
	const [currentSkillToSelect, setCurrentSkillToSelect] = useState<
		string | undefined
	>();

	const handleSkillSelect = useCallback(
		(
			skillName: string,
			textareaRef: React.RefObject<HTMLTextAreaElement>,
			setMessage: (msg: string) => void,
		) => {
			const textarea = textareaRef.current;
			if (!textarea) return;

			const value = textarea.value;
			const cursorPos = textarea.selectionStart;
			const textBeforeCursor = value.slice(0, cursorPos);
			const match = textBeforeCursor.match(SKILL_TRIGGER_REGEX);
			if (!match) return;

			const triggerPos = cursorPos - match[0].length + match[1].length;
			const newValue = `${value.slice(0, triggerPos)}$${skillName} ${value.slice(cursorPos)}`;

			setMessage(newValue);
			setShowSkillMention(false);

			setTimeout(() => {
				const newCursorPos = triggerPos + skillName.length + 2;
				textarea.setSelectionRange(newCursorPos, newCursorPos);
				textarea.focus();
			}, 0);
		},
		[],
	);

	const handleEnterSelect = useCallback((skill: string | undefined) => {
		setCurrentSkillToSelect(skill);
	}, []);

	const checkForSkillMention = useCallback(
		(value: string, cursorPos: number) => {
			const textBeforeCursor = value.slice(0, cursorPos);
			const match = textBeforeCursor.match(SKILL_TRIGGER_REGEX);

			if (match) {
				setShowSkillMention(true);
				setSkillMentionQuery(match[2]);
				setSkillMentionSelectedIndex(0);
			} else {
				setShowSkillMention(false);
			}
		},
		[],
	);

	return {
		showSkillMention,
		skillMentionQuery,
		skillMentionSelectedIndex,
		currentSkillToSelect,
		setShowSkillMention,
		setSkillMentionQuery,
		setSkillMentionSelectedIndex,
		setCurrentSkillToSelect,
		handleSkillSelect,
		handleEnterSelect,
		checkForSkillMention,
	};
}
