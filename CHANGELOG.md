# Changelog

## 1.2.0 — 2026-11-01

- Click Output and use `Ctrl+=` to enlarge its text, `Ctrl+-` to shrink it, or `Ctrl+0` to reset it to 14 px. These shortcuts do not change editor text or page layout while Output has focus.
- Save Output's text size separately from the editor; restore it after reopening the page/app. The editor font menu changes only editor text.
- Disable automatic wrapping of editor and terminal lines. Long lines scroll horizontally; explicit newlines remain intact.
- Prevent the Windows WebView's built-in page zoom from intercepting Output's shortcuts.

Verified in the local browser and rebuilt Windows app: zoom in/out/reset, unchanged editor text size, horizontal scrolling for long lines, and saved output size after refresh. Installer install/upgrade/uninstall checks passed; the installed upgrade preserved all 18 existing source files.
