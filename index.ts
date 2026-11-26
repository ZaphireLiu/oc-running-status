import { Plugin } from "@opencode/plugin"

// Server-side entrypoint. This plugin only contributes a TUI slot and a TUI
// command, so the server part is intentionally empty. Keeping it here makes
// the directory a loadable OpenCode plugin package through `package.json`
// exports (`.` and `./tui`).
export default Plugin.define({
  id: "opencode.live-step",
  setup() {},
})
