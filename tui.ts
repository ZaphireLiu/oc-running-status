/**
 * oc-running-status — a one-line live step indicator for the OpenCode TUI.
 *
 * While a session is running, this renders the newest reasoning or tool record
 * above the composer, so the latest step is visible without expanding the
 * transcript or turning on all thinking blocks. The line collapses to zero
 * height when the session is idle.
 *
 * Data comes from `context.data.session.message`, the host's live message
 * store: the newest running tool wins, otherwise the newest reasoning or tool
 * part of the last assistant message is shown. Streamed answer text is ignored
 * because the transcript already renders it.
 */
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { createComponent, createElement, spread } from "@opentui/solid"
import { createMemo, createSignal, onCleanup } from "solid-js"

// OpenCode maps the bare `@opentui/solid` specifier at runtime but not the
// `@opentui/solid/jsx-runtime` subpath for plugins installed from npm/Git.
// Building elements with this tiny classic factory keeps every bare import in
// this entry module, so the same source works for local-path and package
// installs without a build step.
//
// `spread` assigns prop values as-is: it does not call functions. So a prop
// that changes over time must be produced by re-evaluating the accessor passed
// to `spread`, not by passing a function as the prop value. `props` may
// therefore be an object or a function returning the current object.
function h(type: any, props: any, ...children: any[]) {
  if (typeof type === "function") return createComponent(type, props)
  const element = createElement(type)
  spread(element, () => {
    const source = typeof props === "function" ? props() : props
    const next = { ...(source ?? {}) }
    if (children.length === 1) next.children = children[0]
    else if (children.length > 1) next.children = children
    return next
  })
  return element
}

/** Cells the detail column may use. Kept conservative so the line never wraps. */
const DETAIL_CELLS = 78

type Kind = "thinking" | "running" | "done" | "error"

interface View {
  readonly glyph: string
  readonly label: string
  readonly detail: string
  readonly kind: Kind
  readonly elapsed?: number
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Approximate terminal cell width of a code point (CJK/emoji count as 2). */
function cellWidth(cp: number): number {
  if (cp < 0x1100) return 1
  if (
    cp <= 0x115f ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2
  }
  return 1
}

/** Keeps the head of `text`, appending an ellipsis when it is cut. */
function clipHead(text: string, maxCells: number): string {
  const chars = Array.from(text)
  let used = 0
  let index = 0
  while (index < chars.length) {
    const width = cellWidth(chars[index].codePointAt(0) ?? 0)
    if (used + width > maxCells - 1) break
    used += width
    index++
  }
  return index < chars.length ? chars.slice(0, index).join("") + "…" : chars.join("")
}

/** Keeps the tail of `text` (newest reasoning), prefixing an ellipsis when cut. */
function clipTail(text: string, maxCells: number): string {
  const chars = Array.from(text)
  let used = 0
  let index = chars.length
  while (index > 0) {
    const width = cellWidth(chars[index - 1].codePointAt(0) ?? 0)
    if (used + width > maxCells - 1) break
    used += width
    index--
  }
  return index > 0 ? "…" + chars.slice(index).join("") : chars.join("")
}

function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/** Last meaningful line of a reasoning block: the most recent thought. */
function reasoningTail(text: string): string {
  const lines = text.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]
      .replace(/^\s*(?:[-*#>`]+|\d+[.)])\s*/, "")
      .trim()
    if (line) return line
  }
  return ""
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function pickString(input: any, key: string): string | undefined {
  const value = input?.[key]
  return typeof value === "string" ? value : undefined
}

/** One-line summary of a tool call's arguments. */
function toolSummary(name: string, input: any): string {
  if (!input || typeof input !== "object") return ""
  switch (name) {
    case "bash":
    case "shell":
      return pickString(input, "command") ?? ""
    case "execute":
      return pickString(input, "code") ?? ""
    case "read":
    case "write":
    case "edit":
    case "multiedit":
    case "apply_patch":
      return pickString(input, "path") ?? pickString(input, "filePath") ?? ""
    case "grep":
    case "glob":
      return pickString(input, "pattern") ?? ""
    case "task":
    case "subagent":
      return pickString(input, "description") ?? pickString(input, "prompt") ?? ""
    case "webfetch":
      return pickString(input, "url") ?? ""
    case "websearch":
      return pickString(input, "query") ?? ""
    case "skill":
      return pickString(input, "name") ?? ""
    default: {
      for (const value of Object.values(input)) {
        if (typeof value === "string" && value) return value
      }
      return ""
    }
  }
}

// ---------------------------------------------------------------------------
// Deriving the current step from the live message store
// ---------------------------------------------------------------------------

function toolView(part: any, now: number): View {
  const state = part.state ?? {}
  const running = state.status === "running" || state.status === "streaming"
  const failed = state.status === "error"
  const start = part.time?.ran ?? part.time?.created
  const end = running ? now : part.time?.completed ?? now
  const elapsed = typeof start === "number" ? Math.max(0, end - start) : undefined

  let detail: string
  if (state.status === "streaming") {
    detail = flatten(String(state.input ?? ""))
  } else {
    detail = flatten(toolSummary(part.name, state.input))
    if (failed && state.error?.message) {
      const message = flatten(String(state.error.message))
      detail = detail ? `${detail} · ${message}` : message
    }
  }

  return {
    glyph: failed ? "✗" : running ? "●" : "✓",
    label: String(part.name ?? "tool").slice(0, 12),
    detail: clipHead(detail, DETAIL_CELLS),
    kind: failed ? "error" : running ? "running" : "done",
    elapsed,
  }
}

/**
 * Picks the newest reasoning or tool record of the last assistant message.
 * Text parts are ignored: the answer is already streaming in the transcript.
 * Returns undefined when the session is idle or has nothing to report.
 */
function buildView(context: any, sessionID: string, now: number, enabled: boolean): View | undefined {
  if (!enabled) return undefined
  try {
    return deriveView(context, sessionID, now)
  } catch {
    // A status line must never take the composer down with it; the host data
    // API is beta and a missing collection should just render nothing.
    return undefined
  }
}

function deriveView(context: any, sessionID: string, now: number): View | undefined {
  if (context.data.session.status(sessionID) !== "running") return undefined

  const messages: any[] = context.data.session.message.list(sessionID) ?? []
  let message: any
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.type === "assistant") {
      message = messages[index]
      break
    }
  }
  if (!message) return undefined

  const content: any[] = message.content ?? []

  // A tool that is executing right now always wins, even if an earlier
  // reasoning block is the newest non-running part.
  for (let index = content.length - 1; index >= 0; index--) {
    const part = content[index]
    const status = part?.state?.status
    if (part?.type === "tool" && (status === "running" || status === "streaming")) {
      return toolView(part, now)
    }
  }

  // Otherwise show the newest reasoning or tool part, skipping streamed text.
  for (let index = content.length - 1; index >= 0; index--) {
    const part = content[index]
    if (part?.type === "tool") return toolView(part, now)
    if (part?.type !== "reasoning" || typeof part.text !== "string") continue
    const tail = flatten(reasoningTail(part.text))
    if (!tail) continue
    const start = part.time?.created
    const end = part.time?.completed ?? now
    return {
      glyph: "✻",
      label: "thinking",
      detail: clipTail(tail, DETAIL_CELLS),
      kind: "thinking",
      elapsed: typeof start === "number" ? Math.max(0, end - start) : undefined,
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function colorFor(context: any, view: View | undefined) {
  const text = context.theme?.text
  if (!view) return text?.muted
  if (view.kind === "error") return text?.feedback?.error?.base ?? text?.feedback?.error?.default ?? text?.muted
  if (view.kind === "running") return text?.feedback?.warning?.base ?? text?.feedback?.warning?.default ?? text?.base
  if (view.kind === "done") return text?.feedback?.success?.base ?? text?.feedback?.success?.default ?? text?.muted
  return text?.muted ?? text?.base
}

function LiveStep(props: { sessionID: string; settings: { enabled: boolean } }) {
  const context = usePlugin()
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 500)
  onCleanup(() => clearInterval(timer))

  const view = createMemo(() =>
    buildView(context, props.sessionID, now(), props.settings.enabled),
  )

  const head = () => {
    const current = view()
    if (!current) return ""
    const elapsed = current.elapsed === undefined ? "" : ` ${formatMs(current.elapsed)}`
    return `${current.glyph} ${current.label}${elapsed}`
  }
  const detail = () => {
    const current = view()
    return current ? `│ ${current.detail}` : ""
  }

  return h(
    "box",
    () => ({
      flexDirection: "column",
      height: view() ? 1 : 0,
      overflow: "hidden",
    }),
    h(
      "box",
      {
        flexDirection: "row",
        width: "100%",
        height: 1,
        overflow: "hidden",
        paddingLeft: 1,
        paddingRight: 1,
      },
      h(
        "text",
        () => ({
          fg: colorFor(context, view()),
          width: 17,
          wrapMode: "none",
          truncate: true,
        }),
        head,
      ),
      h(
        "text",
        () => ({
          fg: context.theme?.text?.muted,
          flexGrow: 1,
          wrapMode: "none",
          truncate: true,
        }),
        detail,
      ),
    ),
  )
}

// Settings live in context.storage; the slot reads them reactively.
export default Plugin.define({
  id: "opencode.live-step.tui",
  setup(context) {
    const [store, update] = context.storage.store("settings", {
      initial: { enabled: true },
    })

    context.ui.slot({
      append: "session.composer.top",
      render: ({ sessionID }) => h(LiveStep, { sessionID, settings: store }),
    })

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "live-step.toggle",
          title: "Toggle live step line",
          description: "显示/隐藏输入框上方的实时思考与工具记录",
          group: "Session",
          slash: { name: "livestep", aliases: ["live"] },
          palette: true,
          run: async () => {
            await update((draft) => {
              draft.enabled = !draft.enabled
            })
            context.ui.toast.show({
              message: `Live step: ${store.enabled ? "on" : "off"}`,
              variant: store.enabled ? "success" : "info",
            })
          },
        },
      ],
    }))
  },
})
