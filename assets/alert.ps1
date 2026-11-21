param(
  [ValidateSet('alert', 'stop')]
  [string]$Mode = 'alert',
  [string]$ProcessName = 'DeepSeek Harness',
  [string]$ProcessPath = '',
  [string]$SoundFile = '',
  [int]$SoundCount = 1,
  [switch]$NoSound,
  [switch]$NoFlash,
  [switch]$QuietWhenFocused
)

# DSH approval alert - native Windows attention helper.
# Usage:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File alert.ps1 -Mode alert
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File alert.ps1 -Mode stop
#
# Alert mode:
#   * collects top-level taskbar windows of the target DSH processes
#     (matched by executable path first, then by process name)
#   * flashes their taskbar buttons until activated (FLASHW_ALL | FLASHW_TIMERNOFG)
#   * plays the notification sound
#   * IMPORTANT: it always reminds, even when a DSH window is in the foreground,
#     because one DSH window can show several conversations - an approval waiting
#     in another conversation is invisible even though DSH itself is focused.
#     -QuietWhenFocused restores the old "stay silent while DSH is focused" behavior.
#   * when no target window can be found it still plays the sound, so a request is
#     never silently missed.
# Stop mode:
#   * stops any flashing previously requested by this helper.

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public sealed class DshApprovalAlertWin32
{
    public delegate bool EnumProc(IntPtr hwnd, IntPtr lparam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumProc callback, IntPtr lparam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern int GetWindowLongW(IntPtr hwnd, int index);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool FlashWindowEx(ref FLASHWINFO info);

    [StructLayout(LayoutKind.Sequential)]
    public struct FLASHWINFO
    {
        public uint cbSize;
        public IntPtr hwnd;
        public uint dwFlags;
        public uint uCount;
        public uint dwTimeout;
    }

    public static bool Flash(IntPtr hwnd, uint flags)
    {
        FLASHWINFO info = new FLASHWINFO();
        info.cbSize = (uint)Marshal.SizeOf(info);
        info.hwnd = hwnd;
        info.dwFlags = flags;
        info.uCount = 0;
        info.dwTimeout = 0;
        return FlashWindowEx(ref info);
    }

    // Top-level windows that own a taskbar button: not tool windows, not owned,
    // titled, and either visible or minimized.
    public static List<IntPtr> TaskbarWindows(uint[] processIds)
    {
        HashSet<uint> wanted = new HashSet<uint>(processIds);
        List<IntPtr> found = new List<IntPtr>();
        EnumWindows(delegate(IntPtr hwnd, IntPtr lparam)
        {
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (!wanted.Contains(pid)) return true;

            int exStyle = GetWindowLongW(hwnd, -20); // GWL_EXSTYLE
            if ((exStyle & 0x80) != 0) return true;   // WS_EX_TOOLWINDOW
            if (GetWindowLongW(hwnd, -8) != 0) return true; // GWL_HWNDPARENT (owned popup)

            StringBuilder title = new StringBuilder(1024);
            int length = GetWindowTextW(hwnd, title, 1024);
            if (length <= 0) return true;

            bool minimized = IsIconic(hwnd);
            if (!IsWindowVisible(hwnd) && !minimized) return true;

            found.Add(hwnd);
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static uint ForegroundProcessId()
    {
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return 0;
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        return pid;
    }
}
"@

[uint32]$FLASHW_ALL = 0x00000003
[uint32]$FLASHW_TIMERNOFG = 0x0000000C
[uint32]$FLASHW_STOP = 0x00000000

# ---------------------------------------------------------------- target processes

$processIds = @()
if ($ProcessPath -ne '')
{
    try
    {
        $processIds = @(Get-Process -ErrorAction SilentlyContinue |
            Where-Object { $null -ne $_.Path -and $_.Path -ieq $ProcessPath } |
            ForEach-Object { [uint32]$_.Id })
    }
    catch
    {
        $processIds = @()
    }
}
if ($processIds.Count -eq 0)
{
    try
    {
        $processIds = @(Get-Process -Name $ProcessName -ErrorAction Stop | ForEach-Object { [uint32]$_.Id })
    }
    catch
    {
        $processIds = @()
    }
}

$windows = @()
if ($processIds.Count -gt 0)
{
    $windows = [DshApprovalAlertWin32]::TaskbarWindows($processIds)
}

# ---------------------------------------------------------------- stop mode

if ($Mode -eq 'stop')
{
    $stopped = 0
    foreach ($hwnd in $windows)
    {
        if ([DshApprovalAlertWin32]::Flash($hwnd, $FLASHW_STOP)) { $stopped++ }
    }
    Write-Output ("stopped:" + $stopped)
    exit 0
}

# ---------------------------------------------------------------- alert mode

if ($processIds.Count -eq 0)
{
    # DSH is not running as a named desktop process (for example a plain
    # `dsh web` session). There is no window to flash, but the sound still
    # has to fire - otherwise an approval could be missed entirely.
    Write-Output 'no-process'
}
elseif ($windows.Count -eq 0)
{
    # Window closed to tray: no taskbar button to flash, keep the sound.
    Write-Output 'no-window'
}
elseif ($QuietWhenFocused -and $processIds -contains ([DshApprovalAlertWin32]::ForegroundProcessId()))
{
    Write-Output 'foreground'
    exit 0
}
elseif ($NoFlash)
{
    Write-Output 'flash-disabled'
}
else
{
    foreach ($hwnd in $windows)
    {
        [void][DshApprovalAlertWin32]::Flash($hwnd, ($FLASHW_ALL -bor $FLASHW_TIMERNOFG))
    }
    Write-Output ('flashing:' + $windows.Count)
}

# ---------------------------------------------------------------- sound (always last)

$soundState = 'sound:off'
if (-not $NoSound -and $SoundCount -gt 0)
{
    $soundState = 'sound:ok'
    if ($SoundFile -ne '' -and (Test-Path -LiteralPath $SoundFile))
    {
        for ($i = 0; $i -lt $SoundCount; $i++)
        {
            try
            {
                $player = New-Object System.Media.SoundPlayer
                $player.SoundLocation = $SoundFile
                $player.PlaySync()
            }
            catch
            {
                $soundState = 'sound:fallback'
                try { [System.Media.SystemSounds]::Asterisk.Play() } catch { $soundState = 'sound:fail' }
            }
            if ($i -lt ($SoundCount - 1)) { Start-Sleep -Milliseconds 200 }
        }
    }
    else
    {
        $soundState = 'sound:fallback'
        for ($i = 0; $i -lt $SoundCount; $i++)
        {
            try
            {
                [System.Media.SystemSounds]::Asterisk.Play()
            }
            catch
            {
                $soundState = 'sound:fail'
            }
            if ($i -lt ($SoundCount - 1)) { Start-Sleep -Milliseconds 260 }
        }
    }
}
Write-Output $soundState
