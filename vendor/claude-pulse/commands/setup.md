Set up the claude-pulse status bar. This is a one-time setup.

---

## Steps

1. **Find the script.** Use the Glob tool to search for `claude_status.py` inside `~/.claude/plugins/` recursively. The pattern is `**/claude_status.py`. Use the result that contains `claude-pulse` in the path. Save this as SCRIPT_PATH.

2. **Run the installer.** Execute: `python "SCRIPT_PATH" --install`

   This adds the status line command and animation hooks to `~/.claude/settings.json`.

3. **Confirm to the user:**
   - "claude-pulse is installed! Restart Claude Code to see your status bar."
   - "Type `/claude-pulse:pulse` to configure themes, colours, and animations."
   - "Type `/claude-pulse:pulse show` to preview all themes."
