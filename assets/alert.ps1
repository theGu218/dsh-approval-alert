param(
  [ValidateSet('alert', 'stop')]
  [string]$Mode = 'alert',
  [string]$ProcessName = 'DeepSeek Harness',
  [int]$SoundCount = 2,
  [switch]$NoSound,
  [switch]$NoFlash
)

# DSH approval alert - native Windows attention helper.
# Usage:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File alert.ps1 -Mode alert
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File alert.ps1 -Mode stop
#
# Behavior (Mode = alert):
#   * collects top-level taskbar windows that belong to $ProcessName processes
#   * if the user is already looking at one of them (it is the foreground window),
#     does nothing at all
#   * otherwise flashes their taskbar buttons until the window is activated
#     (FLASHW_ALL | FLASHW_TIMERNOFG) and plays the system notification sound
# Behavior (Mode = stop):
#   * stops any flashing previously requested by this helper

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
try
{
    $processIds = @(Get-Process -Name $ProcessName -ErrorAction Stop | ForEach-Object { [uint32]$_.Id })
}
catch
{
    $processIds = @()
}

if ($processIds.Count -eq 0)
{
    Write-Output 'no-process'
    exit 0
}

$windows = [DshApprovalAlertWin32]::TaskbarWindows($processIds)

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

if ($windows.Count -eq 0)
{
    # Window gone (closed to tray) - there is no taskbar button to flash,
    # keep the sound so the user still gets a signal.
    Write-Output 'no-window'
}
else
{
    $foregroundPid = [DshApprovalAlertWin32]::ForegroundProcessId()
    if ($foregroundPid -ne 0 -and ($processIds -contains $foregroundPid))
    {
        # The user is already looking at DSH; the approval panel is on screen.
        Write-Output 'foreground'
        exit 0
    }

    if (-not $NoFlash)
    {
        foreach ($hwnd in $windows)
        {
            [void][DshApprovalAlertWin32]::Flash($hwnd, ($FLASHW_ALL -bor $FLASHW_TIMERNOFG))
        }
        Write-Output 'flashing'
    }
    else
    {
        Write-Output 'flash-disabled'
    }
}

if (-not $NoSound -and $SoundCount -gt 0)
{
    for ($i = 0; $i -lt $SoundCount; $i++)
    {
        try
        {
            [System.Media.SystemSounds]::Exclamation.Play()
        }
        catch
        {
            # sound device missing - nothing else to do
        }
        if ($i -lt ($SoundCount - 1)) { Start-Sleep -Milliseconds 260 }
    }
}
