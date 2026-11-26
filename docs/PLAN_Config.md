# 配置项规划（未确认）

> 状态：**草案**。除了 `/livestep` 开关本身，下面没有任何一项已经实现或拍板。
> 当前 `tui.ts` 里全是硬编码常量。本文只记录候选配置、默认值建议、实现代价和待决问题，
> 供后续挑选。选中的项再单独实现，未选中的项不代表会做。

## 1. 现状：所有硬编码值

| 位置 | 当前值 | 说明 |
| --- | --- | --- |
| `DETAIL_CELLS` | `78` | 详情列最大显示宽度（按终端 cell 计，CJK 记 2） |
| 标签列宽度 | `17` | 左侧 `● shell 2.4s` 固定占位 |
| 左右留白 | `1` | `paddingLeft` / `paddingRight` |
| 刷新间隔 | `500ms` | 计时器，空闲时也一直在跑 |
| 空闲行为 | 立即隐藏 | 外框高度 `1 → 0` |
| 行数 | `1` | 单行 |
| 内容来源 | reasoning + tools | 忽略 `text`、`compaction`、`skill` 等系统通知 |
| 选条规则 | 运行中的工具优先，否则最新 reasoning/tool | 取最后一条 assistant 消息 |
| 思考截断 | 最后一行、保留尾部 | `clipTail` |
| 工具截断 | 保留头部 | `clipHead` |
| 工具参数映射 | 内置 switch | `shell→command`、`execute→code`、`read/write/edit→path`、`subagent→description`、`webfetch→url`… |
| 颜色 | 跟随主题 | thinking=muted、running=warning、done=success、error=error |
| 图标 | Unicode | `✻ ● ✓ ✗` |
| 会话范围 | 当前会话 | 不跟子会话 |
| 位置 | `session.composer.top` | 输入框正上方 |

## 2. 设计原则

1. 单行是这个插件的核心卖点，默认配置不应该破坏“只占一行”。
2. 只暴露会明显改变“看一眼”体验的开关；细节格式尽量写死。
3. 能在运行时生效的放存储（`context.storage.store`），需要重新注册 slot 的单独标记。
4. 所有读取都要有默认值和范围钳制，旧配置文件不能把插件弄挂。
5. 不引入小型模板语言、任意正则这类会膨胀维护面的配置。

## 3. 候选配置

### A. 显示内容（优先级最高）

| 配置名 | 类型 / 取值 | 建议默认 | 语义 | 代价 |
| --- | --- | --- | --- | --- |
| `mode` | `"off" \| "compact" \| "full"` | `"compact"` | 运行时总开关与信息档位，由 `/livestep` 循环切换 | 低 |
| `lines` | `1 \| 2 \| 3` | `1` | 行数；大于 1 时改为“当前步骤 + 最近完成记录”的多行结构，而不是把单行截得更狠 | 中 |
| `sources` | `("reasoning" \| "tools" \| "text" \| "notice")[]` | `["reasoning","tools"]` | 允许出现的 part 类型；`notice` 指 compaction、skill、subagent 状态等系统消息 | 低 |
| `toolResult` | `"none" \| "last-line"` | `"none"` | 是否在工具详情后追加结果的最后一行（对 `shell` / `execute` 尤其有用） | 中（要读 `state.content`） |
| `reasoning` | `"last-line" \| "last-chars" \| "first-line"` | `"last-line"` | 思考文本怎么取：最后一行 / 最后 N 个字符 / 第一行 | 低 |
| `reasoningChars` | 整数 | `78` | `last-chars` 模式下的宽度预算，同时可替代 `DETAIL_CELLS` | 低 |
| `detailCells` | 整数 | `78` | 详情列统一的 cell 预算（与 `reasoningChars` 二选一，避免重复） | 低 |
| `includeCompletedTool` | `boolean` | `true` | 工具结束后是否继续显示一条 `✓`；关掉后只在 running 时出现 | 低 |
| `toolInclude` | `string[]` | `[]` | 工具白名单，非空时只显示这些工具 | 低 |
| `toolExclude` | `string[]` | `[]` | 工具黑名单，用来屏蔽 `todo`、`read` 这类噪音 | 低 |
| `minToolMs` | 整数 | `0` | 持续时间低于该值的工具不显示，避免快速工具闪屏 | 低 |
| `minReasoningMs` | 整数 | `0` | 思考块持续时间低于该值时不显示（可选，防抖） | 低 |

说明：

- `lines > 1` 与 `mode` 的关系需要定：建议只有 `full` 模式允许多行，`compact` 强制 `1`。
- 白名单/黑名单同时存在时的优先级建议：`include` 非空时先过白名单，再过黑名单。
- 工具名以宿主实际传出为准（V2 是 `shell`、`execute`、`read`、`write`、`edit`…，不是 V1 的 `bash`）。

### B. 生命周期

| 配置名 | 类型 / 取值 | 建议默认 | 语义 | 代价 |
| --- | --- | --- | --- | --- |
| `idle` | `"hide" \| "last" \| { lingerMs: number }` | `"hide"` | 会话结束后的行为：立即隐藏 / 常驻最后一条 / 保留一段时间 | 低 |
| `idleSummary` | `boolean` | `false` | 一轮结束时显示汇总，如 `✓ done · 12.3s · 8 steps` | 中（需要统计步数/总耗时） |
| `tickMs` | 整数 | `500` | 计时刷新间隔；只在运行中或 linger 窗口内跑计时器 | 低 |
| `followSubagents` | `boolean` | `false` | 当前会话空闲、但子会话仍在运行时，显示子会话的步骤（前缀 `↳`） | 中（要沿 `family()` 找 running 的会话） |
| `subagentPrefix` | `string` | `"↳"` | 跟随子会话时的前缀标识 | 低 |

说明：

- 现在的计时器在空闲时也持续 tick（每 500ms 触发一次 memo 重算）。即使不加配置，也应该改成空闲时停表；`tickMs` 只是把频率也变成可调。
- `idle: "last"` 与 `idleSummary` 同时开启时，建议汇总优先。

### C. 布局与宽度

| 配置名 | 类型 / 取值 | 建议默认 | 语义 | 代价 |
| --- | --- | --- | --- | --- |
| `width` | `"auto" \| number` | `"auto"` | 自动按渲染宽度扣掉侧栏/边距，或固定字符数。当前写死 78，宽终端浪费、窄终端靠 `truncate` 兜底 | 中（resize 需要自己监听） |
| `labelWidth` | 整数 | `17` | 左侧标签列宽；工具名过长会被截 | 低 |
| `padding` | 整数 | `1` | 左右留白 | 低 |
| `divider` | `string` | `"│"` | 标签与详情之间的分隔符，可换 `·`、`-` | 低 |
| `placement` | `"composer"` | `"composer"` | 换到 `prompt.footer.status` 等位置。**换 slot 必须重新注册，改配置后要重载 TUI** | 高，建议不做 |

说明：

- `width: "auto"` 的实际可用宽度受“侧栏是否展开”影响，slot 输入里没有宽度字段，只能读 `context.renderer.width` 再估一个安全值。估错时仍由 `wrapMode: "none"` + `truncate` 兜底。
- `placement` 如果真要做，建议只支持 `composer` 与 `sidebar.footer` 两种，并且明确标注“需重载”。

### D. 样式与图标

| 配置名 | 类型 / 取值 | 建议默认 | 语义 | 代价 |
| --- | --- | --- | --- | --- |
| `icons` | `"unicode" \| "ascii" \| "none"` | `"unicode"` | ascii 用 `[.]` / `[ok]` / `[x]`；适合字体宽度异常的终端 | 低 |
| `colors` | `boolean` | `true` | 关掉后统一 muted，降低视觉噪音 | 低 |
| `boldHead` | `boolean` | `false` | 标签是否加粗 | 低 |
| `dimDetail` | `boolean` | `true` | 详情用 muted，头部用状态色 | 低 |
| `labels` | `Record<string,string>` | `{ thinking: "thinking" }` | 标签文案，顺便支持中文（`思考` / `执行`） | 低 |

说明：不建议开放逐 token 的配色覆盖。颜色应跟随 `context.theme`，否则主题切换会花。

### E. 明确排除

- 每种工具的参数模板（如 `shell: "{command}"`）：内置映射已经够，开放模板会变成小型 DSL。
- 任意正则过滤思考内容：性能和隐私都不划算，也容易误伤。
- 位置 × 行数的自由组合：行数可配，位置不做。
- 多实例 / 多个 slot 同时显示。

## 4. 建议的最小集（未确认）

如果只做一轮，建议只做这 8 项：

1. `mode`（`off` / `compact` / `full`，`/livestep` 循环）
2. `lines`（默认 `1`，仅 `full` 模式允许 `2~3`）
3. `idle`（默认 linger 3000ms，替换现在“立即消失”）
4. `reasoning` + `detailCells`
5. `toolResult`
6. `toolExclude` + `minToolMs`
7. `followSubagents`
8. `icons` + `labels`

其余（`width` 自动、`idleSummary`、`placement`）留到有实际反馈再说。

## 5. 交互与存储

### 命令

- `/livestep`：循环 `compact → full → off → compact`，状态持久化。
- `/livestep settings`：用 `context.ui.dialog.select` 列出前 6 项做快速调整，支持分组和键盘操作。
- 可选：`/livestep lines 2`、`/livestep idle 5s` 这样的子命令。代价是要写参数解析，优先级低。

### 存储

- 单 store：`settings`，`initial` 中放完整默认值。
- 读取时合并：`{ ...defaults, ...store }`，并对数字做 clamp、对枚举做白名单校验。
- 增加 `version` 字段，便于以后改默认值或迁移旧键。
- 当前已有的 `enabled` 保留，映射到 `mode: off|compact`，避免用户升级后设置丢失。
- 已废弃的实验性 `diag` store 不再写入（代码中已移除）。

## 6. 实现落点

- `buildView` 目前同时负责“选哪条”和“怎么展示”，配置变多后建议拆成：
  - `pickPart(messages, options)`：决定候选 part 与优先级；
  - `formatPart(part, options)`：生成 `View`（图标、标签、详情、耗时）；
  - `LiveStep` 只负责计时器与渲染。
- 所有常量替换为 `options`，渲染层的 `height`、`fg` 已经走 accessor 重算，行数变化可以自然响应。
- 计时器改为条件启动：`status === "running"` 或处于 linger 窗口。
- `followSubagents` 需要在 `family(sessionID)` 中找 `status === "running"` 的会话，再用它的 message store 取 part。
- `width: "auto"` 需要监听 renderer resize；拿不到时退回固定值。

## 7. 待决问题

1. **多行的两种形态**：
   - A：同一时刻展示多条（当前工具/思考 + 最近完成记录），信息密度高但占 2~3 行；
   - B：单行滚动日志（最新一条覆盖上一条），始终 1 行但信息量有限。
   倾向：A 只放在 `full` 模式，`compact` 永远一行。
2. `idle` 的默认值：`hide`（现状）还是 `linger 3000ms`？后者更符合“看完最后一步”，但会短暂占位。
3. 是否真的需要 `width: "auto"`，还是继续用固定 78 + `truncate` 兜底。
4. `followSubagents` 的价值取决于是否经常用 `subagent` 跑长任务；如果主要看主会话，可以先不做。
5. 是否需要 `/livestep settings` 对话框，还是让人直接改存储/配置文件就够。

## 8. 验收清单（实现任一配置项时）

- [ ] 默认值与当前行为一致（除刻意修改的默认，如 `idle`）。
- [ ] 旧 `settings` 文件（只有 `enabled`）能平滑读取。
- [ ] 非法值不会抛错，最差退回默认。
- [ ] 空闲时计时器停止，不持续重算。
- [ ] 窄终端（80 列、侧栏展开）不换行、不撑高。
- [ ] 配置改变后无需重载（除非该项需要重新注册 slot）。
