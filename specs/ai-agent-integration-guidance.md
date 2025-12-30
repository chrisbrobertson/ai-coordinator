AI Agent CLI Guidance (Codex · Claude · Gemini)

This document is a practical cheat sheet for building an AI-powered coding tool that integrates with OpenAI Codex, Anthropic Claude Code, and Google Gemini CLI in non-interactive, validator-safe, CI-friendly ways.

⸻

0. Universal Rules (Apply to All CLIs)

Always assume automation is hostile to interactive UIs.
	•	❌ Avoid TUIs, cursor queries, progress spinners
	•	✅ Prefer headless / print / exec modes
	•	✅ Disable color and ANSI escape codes
	•	✅ Force machine-parseable output (JSON / JSONL)
	•	✅ Explicitly control permissions and autonomy

Design principle:

Treat the model like an unreliable subprocess. Constrain inputs, constrain outputs, and validate everything.

⸻

1. OpenAI Codex CLI

1.1 Use codex exec (Never the TUI)

codex exec --color never "YOUR PROMPT"

	•	exec bypasses the interactive terminal UI
	•	Prevents cursor-position / terminal validation failures
	•	Safe for CI, tools, and wrappers

You can also pipe prompts via stdin:

cat prompt.txt | codex exec --color never -


⸻

1.2 Machine-Parseable Output

Option A: JSONL event stream

codex exec --json --color never "Task..."

	•	Emits newline-delimited JSON events
	•	Tool should extract the final agent_message

Option B: Schema-enforced output (recommended)

codex exec --output-schema schema.json --color never "Task..."

Minimal validator-safe schema:

{
  "type": "object",
  "properties": {
    "response_block": { "type": "string" }
  },
  "required": ["response_block"],
  "additionalProperties": false
}

This guarantees the required response block is always present.

⸻

1.3 Autonomous / “Full Auto” Mode

When Codex must edit files or run commands unattended:

codex exec --full-auto --color never "Implement X and run tests"

Use only in trusted environments.

⸻

1.4 Codex Prompt Contract (Drop-In)

Your final output must be ONLY valid JSON matching the provided schema.
Put the exact validator-required response in `response_block`.
Do not include any other text.


⸻

2. Anthropic Claude Code

2.1 Use Print / Headless Mode

claude -p "YOUR PROMPT" --output-format json

	•	-p (print mode) avoids interactive UI
	•	Required for reliable automation

For streaming parsers:

claude -p "YOUR PROMPT" --output-format stream-json


⸻

2.2 Permissioning = Claude’s “Full Auto”

Claude emphasizes explicit tool permissions.

Example (tight scope):

claude -p "Fix tests" --output-format json \
  --allowedTools "Read" "Write" "Bash(git:*)"

Options:
	•	--allowedTools / --disallowedTools
	•	--dangerously-skip-permissions (⚠️ trusted envs only)

⸻

2.3 Limit Agent Wandering
	•	Keep prompts narrow
	•	Cap turns where supported
	•	Prefer single-shot tasks in automation

⸻

2.4 Claude Prompt Contract

Return ONLY a JSON object with exactly one key: `response_block`.
The value must exactly match the required validator response.
No extra keys. No commentary.


⸻

3. Google Gemini CLI

3.1 Non-Interactive Usage

gemini -p "YOUR PROMPT"

or via stdin:

echo "YOUR PROMPT" | gemini


⸻

3.2 Request JSON Output (Version-Dependent)

gemini -p "YOUR PROMPT" --output-format json

⚠️ Important: Some Gemini CLI versions have broken or missing JSON flags.

Best practice:
	•	Prefer JSON output
	•	Implement a fallback parser for plain text

⸻

4. Recommended Universal Wrapper Contract

4.1 Inputs

{
  "task_prompt": "string",
  "mode": "read_only | edit_ok | danger_full_access",
  "response_schema": "json-schema"
}

4.2 Outputs (Your Tool Always Returns)

{
  "tool": "codex | claude | gemini",
  "response_block": "exact validator response",
  "raw": "optional raw model output"
}


⸻

4.3 Execution Profiles

Tool	Read Only	Edit OK	Full Auto
Codex	codex exec	codex exec --full-auto	same + sandbox
Claude	claude -p	allowedTools	dangerously-skip-permissions
Gemini	gemini -p	same	same


⸻

5. Universal Validator-Safe Prompt (Copy/Paste)

You are running inside an automated validator.
Output ONLY a single JSON object.
It must have exactly one key: "response_block".
The value must exactly match the required response block, byte-for-byte.
No markdown. No extra keys. No additional text.


⸻

6. Final Guidance
	•	Never trust stdout → always constrain output
	•	Never trust the agent → always gate permissions
	•	Never trust the terminal → always use headless modes

This document is intended to be dropped directly into a repo as:

ai-agent-cli-guidance.md

and used as the canonical reference for AI CLI integration.

⸻

Appendix A: Troubleshooting & Hardening

If validation fails intermittently:
	•	Re-check that you are using headless/print/exec modes only
	•	Disable color/ANSI (--color never or equivalent)
	•	Ensure your wrapper ignores non-final events (progress/logs)

If JSON output is malformed:
	•	Prefer schema-enforced output where available
	•	Add a final “ONLY JSON” contract to the prompt
	•	Implement a strict JSON parser with retries (same prompt, same input)

Version pinning:
	•	Pin CLI versions in CI to avoid flag regressions
	•	Log --version output alongside runs for auditability

Security:
	•	Default to least privilege (read-only)
	•	Enable full-auto / skip-permissions only in trusted repos
	•	Never allow network or shell access unless explicitly required

⸻

End of document.