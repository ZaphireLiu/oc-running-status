# oc-running-status

One-line live step indicator for the OpenCode TUI. While a session is running, it shows the newest reasoning or tool record above the composer, so you can glance at what the agent is doing without expanding the transcript or enabling all thinking blocks.

```text
✻ thinking 6.2s │ …所以应该先改 slot 的渲染路径
● shell   2.4s │ bun test src/tui.test.ts
✓ edit    0.8s │ ~/.config/opencode/plugins/live-step/tui.ts
✗ execute 1.1s │ throw new Error(...) · SyntaxError: ...
```

## Behavior

- Idle sessions take **zero height**. The line only exists while the session is running.
- One line, always in the same place: the `session.composer.top` slot, directly above the prompt.
- A **running tool** always wins. Otherwise the newest reasoning or tool part of the last assistant message is shown.
- Streamed answer text is ignored: it already renders in the transcript, so repeating it adds nothing.
- Reasoning shows the **tail** of its last non-empty line, which is the freshest part while streaming. Tool arguments are summarized per tool (`shell → command`, `read/write/edit → path`, `subagent → description`, ...).
- `/livestep` (alias `/live`) toggles the line; the setting is persisted through the plugin storage.

## Install

The plugin is a normal OpenCode package with a server part (`.`) and a TUI part (`./tui`). Point a plugin entry at the checkout:

```json title="~/.config/opencode/opencode.jsonc"
{
  "plugins": ["file:///home/you/Workshop/oc-running-status"]
}
```

Or load it as a local directory plugin by placing a checkout at `~/.config/opencode/plugins/oc-running-status`.

No build step. Imports of `@opencode/plugin/tui`, `@opentui/solid` and `solid-js` resolve from OpenCode's own runtime.

## Layout

`tui.ts` uses `createElement` + `spread` instead of JSX: OpenCode maps the bare `@opentui/solid` specifier at runtime, but not the `jsx-runtime` subpath for plugins installed from npm or Git. Keep bare imports in this entry module.

Important: `spread` assigns prop values **as-is** and does not call functions. Dynamic props must come from re-evaluating the accessor passed to `spread`, not from function-valued props. Children functions are fine because Solid's `insertExpression` calls them.

## Current limits

- Single line, current session only. Subagent activity appears as `● subagent <description>` until the task ends.
- The detail column is clipped to a conservative 78 cells.
- The host data API is beta; every host read is guarded so a shape change only hides the line.

## Config

Only the on/off toggle exists today. Candidate options are collected in [`docs/PLAN_Config.md`](docs/PLAN_Config.md); none of them is confirmed or implemented.
