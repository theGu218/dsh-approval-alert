# Changelog

## 0.1.0

首个可用版本。

- 监听 `approval/request` 与 `user-questions/request`，有请求等待时提醒。
- 提醒方式：系统提示音 + 任务栏按钮闪烁（`FlashWindowEx`）。
- `graceMs` 宽限期内解决则不打扰；窗口已在前台时不提醒。
- 请求解决后自动停止闪烁；支持 `repeatMs` 重复提醒。
- Windows 专用；窗口关闭到托盘时退化为仅提示音。
