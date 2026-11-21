# dsh-approval-alert

DSH 的「待授权提醒」插件。

## 它解决什么问题

DSH 在等用户批准一个工具调用（或被问一个问题）时，界面只是把审批面板挂在当前会话里。
如果这时你把窗口最小化了、切到别的程序，甚至把窗口关了，**没有任何消息告诉你「这里在等一个授权」**——
任务就卡在那里，你要过很久才发现。

这个插件监听 Host 的两个「等用户决策」事件：

| 事件 | 触发场景 |
| --- | --- |
| `approval/request` | 工具调用需要用户批准（沙箱提权、装插件、危险命令等） |
| `user-questions/request` | 模型通过 `ask_user_question` 向用户提问 |

一旦有请求在等待，并且你不在窗口前，它就：

1. 播放系统提示音；
2. 让 DSH 进程的**任务栏按钮闪烁**（`FlashWindowEx`，最小化时同样有效）；
3. 请求一直没人处理就按间隔重复提醒；
4. 你处理完（批准/拒绝/取消）后自动停止闪烁。

## 工作方式

```
approval/request ──► 等待 graceMs ──► 还在等？
                                        │
                                       是
                                        ▼
                              powershell.exe assets/alert.ps1
                              ├─ 找到 DSH 的任务栏窗口（按路径/进程名）
                              └─ FlashWindowEx + 播放提示音
```

- `graceMs` 内解决 → 完全不吵你。
- 窗口是否前台、是否最小化、是否在别的会话 —— 都不影响，一律提醒。
- 请求解决 → 再调一次脚本撤掉闪烁（`FLASHW_STOP`）。

### 为什么监听要 prepend

`approval/request` 与 `user-questions/request` 是 Cordis 的 **waterfall** 事件：
内置 answerer 会直接返回审批结果、**不调用 `next()`**，所以排在它后面的监听器永远轮不到。
插件用 `ctx.on(name, handler, { global: true, prepend: true })` 注册：

- `global: true` 绕过 agent scope 过滤（事件按 `scopeTarget(agent, ...)` 派发）；
- `prepend: true` 保证先于内置 answerer 执行，执行完再 `next()` 把决定原样交还给它。

这两点是「插件到底会不会响」的关键，改动监听注册时不要去掉。

插件自己 `spawn` `powershell.exe`，不依赖 Electron API：DSH 的 Host 是
`ELECTRON_RUN_AS_NODE` 子进程，拿不到 `BrowserWindow.flashFrame`，只能走 Win32。

## 安装

在 DSH profile 里装 bundle（本地开发用绝对路径）：

```
plugin_manager: install_bundle, target = <本目录绝对路径>
```

或发布后：

```
dsh plugin --profile desktop add dsh-approval-alert
```

## 配置

`cordis.patch.yml` 里的 `config`：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `graceMs` | `4000` | 请求出现后多久开始提醒（毫秒），`0` = 立刻 |
| `repeatMs` | `30000` | 重复提醒间隔（毫秒），`0` = 只提醒一次 |
| `sound` | `true` | 是否播放提示音 |
| `flash` | `true` | 是否闪烁任务栏 |
| `processName` | `'DeepSeek Harness'` | 要闪的进程名；桌面版默认即可 |
| `soundFile` | 空（用自带音效） | 自定义提示音 WAV 的绝对路径；留空 = 插件自带的柔和三连音「叮-叮-叮」 |

默认音效是插件自带的 `assets/sounds/chime.wav`（三连上行），刻意避开 Windows 的报错系提示音。
想换成自己的音效，把 WAV 路径填进 `soundFile` 即可，任何 16-bit PCM WAV 都能播。

### 无条件提醒

只要有审批或提问在等，**不管窗口是否最小化、是否在前台、你在哪个会话**，一律响铃 + 闪烁。
不做任何「你是不是正看着」的判断：一个 DSH 窗口可以同时开着多个会话，
你在会话 A 时会话 B 的审批虽然存在但你看不见，任何基于窗口状态的猜测都可能漏掉它。

每次提醒的结论会追加到 `%LOCALAPPDATA%\dsh-approval-alert\alert.log`，排查「为什么没听到」时先看它。

示例：

```yaml
- insert:
    - id: dsh-approval-alert
      name: dsh-approval-alert
      config:
        graceMs: 3000
        repeatMs: 60000
        sound: true
        flash: true
        soundFile: 'D:\sounds\my-alert.wav'
```

## 平台

只对 **Windows** 生效（任务栏闪烁是 Win32 能力）。其他平台上插件保持静默，不影响审批。

窗口被完全关闭（退到托盘、没有任务栏按钮）时没有可闪的按钮，此时只播放提示音。

## 开发与测试

```
node --check index.js
node --check lib/scheduler.js
node --check lib/win32.js
node test/scheduler.test.mjs     # 调度逻辑单测（9 个）
```

真机验证：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File assets/alert.ps1 -Mode alert`
（有 DSH 窗口时会闪 + 响，随后 `-Mode stop` 停止）。

## 已知限制

- 窗口**完全关闭到托盘**时没有任务栏按钮可闪烁，此时仍会播放提示音；
- 用浏览器打开 Web GUI 时，浏览器标签不在闪烁范围内，但提示音照常响。
