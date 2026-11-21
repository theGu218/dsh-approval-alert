# Changelog

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
