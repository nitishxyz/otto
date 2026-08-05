# Local dictation

Otto's web and desktop chat inputs stream microphone audio to the local daemon over a WebSocket. The daemon converts the stream to 16 kHz mono PCM and transcribes it locally with `whisper.cpp`; audio is not sent to a hosted speech service.

Install or remove speech models under **Preferences → Dictation**. The default model is `small.en-q5_1`.

## Vocabulary and spoken aliases

The daemon derives a small vocabulary at runtime from the active project's directory name, package name and scope, and detected language manifests. There is no hardcoded product or technical keyword list.

Preferences → Dictation shows the currently detected project terms and lets users add global entries with:

- a canonical keyword, which is added to the Whisper prompt; and
- optional comma-separated spoken aliases, which are replaced with the canonical keyword in the final transcript.

Each detected project term has a remove button. Removed terms are excluded from Whisper's project vocabulary and appear under **Excluded**, where they can be restored. Exclusions are stored globally in `defaults.dictationExcludedProjectKeywords`; adding the same term explicitly under **Your keywords** includes it again.

For example, a user can add `OttoCode` with the aliases `autocode`, `auto code`, and `otto code`. Alias replacement is case-insensitive and only matches complete words or phrases.

Custom entries are stored in the global config under `defaults.dictationKeywords`:

```json
{
  "defaults": {
    "dictationKeywords": [
      {
        "keyword": "AcmeDB",
        "aliases": ["acme database", "acme db"]
      }
    ]
  }
}
```

## Smart formatting

Enable **Preferences → Dictation → Smart Formatting** to turn clear spoken layout instructions into Markdown before the transcript reaches the chat input. Formatting stays local and deterministic; it does not call an AI model or send transcript text to another service.

Whisper itself supplies transcription and punctuation, but its initial prompt is vocabulary context rather than a reliable instruction-following formatting system. Otto therefore applies the optional Markdown formatting after Whisper returns the transcript.

Supported patterns include:

- `new paragraph` for a blank line;
- `new line` for a line break;
- `bullet point` or `next bullet` for Markdown bullets;
- `number one`, `number two`, and similar commands for numbered lists; and
- clear sequences such as `First ... Second ... Finally ...` for numbered lists;
- counted introductions such as `There are three things to check`, followed by a comma-separated list.

For example, saying “bullet point add tests, bullet point update the docs” produces:

```md
- add tests
- update the docs
```

The setting is on by default and can be disabled under Preferences. It is stored globally as `defaults.dictationSmartFormatting`.

## Test it manually

1. Open **Preferences → Dictation** and confirm **Smart Formatting** is enabled.
2. Under **Vocabulary → Detected for this project**, confirm terms from the active directory, package name, and language manifests are shown. Remove one term and confirm it moves to **Excluded**; select it there to restore it.
3. Dictate: “bullet point add tests, bullet point update the docs”.
4. Stop recording and confirm the composer contains two Markdown bullet lines.
5. Dictate: “First, install dependencies. Second, run the tests. Finally, ship it.” and confirm it becomes a numbered list.
6. To test a custom correction, add `OttoCode` with `autocode, auto code` as spoken aliases, then dictate “open autocode”.

Keyword-only entries are vocabulary hints and are not guaranteed corrections. If Whisper produces a specific wrong form such as `custom edu`, add that exact form as an alias for the intended canonical keyword. Spaces and hyphens are treated equivalently for aliases.

If no project terms appear, use the refresh button in the Local Speech Models header and verify the client is attached to a project rather than the unscoped server home.

## Prompt precedence

The base transcription prompt can still be overridden. Precedence is:

1. a prompt supplied when the dictation session is created;
2. `OTTO_DICTATION_PROMPT`;
3. `<project>/.otto/dictation-prompt.txt`;
4. the global dictation `prompt.txt` in Otto's config directory; or
5. the generic dictation prompt.

Runtime project terms and user-defined canonical keywords are appended to the selected prompt. User-provided spoken aliases are applied after transcription regardless of which prompt source is selected.
