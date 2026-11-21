# Changelog

## 0.1.4

- **无条件提醒**：去掉前台判断与 `quietWhenFocused` 配置。只要有审批/提问在等，
  不管窗口是否最小化、是否在前台、在哪个会话，一律响铃 + 闪烁。
- 精简 `alert.ps1`：移除 `-QuietWhenFocused` 参数与 `GetForegroundWindow` 依赖。

## 0.1.3

- **修复提醒完全不触发**：`approval/request` 与 `user-questions/request` 是 Cordis waterfall 事件，
  内置 answerer 排在前面并且直接返回结果、不调用 `next()`，排在后面的监听器永远轮不到。
  监听改为 `{ global: true, prepend: true }`：先跑我们的提醒，再交给内置 answerer。
- 诊断日志增加事件派发与 hooks 计数（`dispatch` 行），以及提示音结果（`sound:ok / sound:fallback / sound:fail`），
  排查「为什么没响」时先看 `%LOCALAPPDATA%\dsh-approval-alert\alert.log`。
- `approval_alert_test` 回报里带上提示音状态。

## 0.1.2

- 修复「DSH 窗口在前台时另一个会话的授权没有提示」：默认不再因为前台是 DSH 就静默，
  因为一个 DSH 窗口里可能开着多个会话，前台是 DSH 不代表用户看到了那个审批。
  想要旧行为可以设 `quietWhenFocused: true`。
- 修复「最小化后没有提示音」的几个静默分支：
  - 找不到 DSH 进程时（例如浏览器/`dsh web` 方式运行）以前直接退出、不响铃，现在照样响铃；
  - 进程匹配改为「先按可执行文件绝对路径、再按进程名」，避免改名后找不到；
  - 每次提醒的结论写入 `%LOCALAPPDATA%\dsh-approval-alert\alert.log`，便于排查。
- `approval_alert_test` 会回报脚本实际走的路径（flashing / no-window / no-process）与日志位置。

## 0.1.1

- 提示音改成插件自带的三连上行「叮-叮-叮」（`assets/sounds/chime.wav`），不再用听起来像报错的 `SystemSounds.Exclamation`。
- 新增 `soundFile` 配置：可指定任意本地 WAV 作为提示音；没装音频设备或文件缺失时回退 `SystemSounds.Asterisk`。
- 新增 `tools/make-sounds.mjs`，可复现地合成候选音效。

## 0.1.0

首个可用版本。

- 监听 `approval/request` 与 `user-questions/request`，有请求等待时提醒。
- 提醒方式：系统提示音 + 任务栏按钮闪烁（`FlashWindowEx`）。
- `graceMs` 宽限期内解决则不打扰；窗口已在前台时不提醒。
- 请求解决后自动停止闪烁；支持 `repeatMs` 重复提醒。
- Windows 专用；窗口关闭到托盘时退化为仅提示音。
