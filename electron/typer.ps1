# NightShift Coder - real keyboard typing helper (Windows).
# Reads commands from stdin, one per line, and answers OK / BLOCKED / ERR.
#   T|<base64 text>|<base64 window-title-must-contain>|<delay ms>
#   S|<base64 window-title-must-contain>      (presses Ctrl+S)
#   P                                          (ping)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class NSKeys {
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public MOUSEINPUT mi; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  const uint KEYUP = 2, UNICODE = 4;
  static readonly Random Rnd = new Random();
  public static string Title() { var sb = new StringBuilder(512); GetWindowText(GetForegroundWindow(), sb, 512); return sb.ToString(); }
  static bool InFront(string must) { return must.Length == 0 || Title().IndexOf(must, StringComparison.OrdinalIgnoreCase) >= 0; }
  static void Send(ushort vk, ushort scan, uint flags) {
    var i = new INPUT[1];
    i[0].type = 1; i[0].U.ki.wVk = vk; i[0].U.ki.wScan = scan; i[0].U.ki.dwFlags = flags;
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
  static void Key(ushort vk) { Send(vk, 0, 0); Send(vk, 0, KEYUP); }
  static void Char(char c) { Send(0, c, UNICODE); Send(0, c, UNICODE | KEYUP); }
  public static bool Type(string text, string must, int delay) {
    foreach (char c in text) {
      if (!InFront(must)) return false;
      if (c == '\r') continue;
      if (c == '\n') Key(0x0D); else if (c == '\t') Key(0x09); else Char(c);
      int d = delay + Rnd.Next(-delay / 2, delay / 2 + 1);
      if (c == '\n') d += delay * 3;
      Thread.Sleep(Math.Max(1, d));
    }
    return true;
  }
  public static bool Save(string must) {
    if (!InFront(must)) return false;
    Send(0x11, 0, 0); Key(0x53); Send(0x11, 0, KEYUP);
    return true;
  }
}
"@
function Dec($s) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $p = $line.Split('|')
  $r = 'ERR'
  try {
    if ($p[0] -eq 'T') { $r = if ([NSKeys]::Type((Dec $p[1]), (Dec $p[2]), [int]$p[3])) { 'OK' } else { 'BLOCKED' } }
    elseif ($p[0] -eq 'S') { $r = if ([NSKeys]::Save((Dec $p[1]))) { 'OK' } else { 'BLOCKED' } }
    elseif ($p[0] -eq 'P') { $r = 'OK' }
  } catch { $r = 'ERR' }
  [Console]::Out.WriteLine($r)
  [Console]::Out.Flush()
}
