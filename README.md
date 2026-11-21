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
                          否（你就在窗口前）│ 是
                                        ▼
                              powershell.exe assets/alert.ps1
                              ├─ 找到 DSH 的任务栏窗口（按进程名）
                              ├─ 前台就是 DSH → 不打扰
                              └─ 否则 FlashWindowEx + SystemSounds
```

- `graceMs` 内解决 → 完全不吵你。
- 窗口已经是前台（你正看着审批面板）→ 脚本直接退出，不响也不闪。
- 请求解决 → 再调一次脚本撤掉闪烁（`FLASHW_STOP`）。

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

- 只认桌面版进程名；用浏览器打开 Web GUI 时，浏览器标签不在闪烁范围内（仍会响提示音）。
- 窗口关闭到托盘时无法闪烁（没有任务栏按钮）。
