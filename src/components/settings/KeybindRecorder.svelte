<script>
  /**
   * KeybindRecorder.svelte -- PTT/dictation/overlay key recording UI.
   *
   * Handles keyboard + mouse event capture, recording state machine,
   * and display of current keybind values.
   */
  import { formatKeybind } from '../../lib/voice-adapters.js';

  let {
    hotkeyToggle = $bindable('CommandOrControl+Shift+V'),
    pttKey = $bindable('MouseButton4'),
    dictationKey = $bindable('MouseButton5'),
    statsHotkey = $bindable('CommandOrControl+Shift+M'),
  } = $props();

  // ---- Keybind recording state ----

  let recordingKeybind = $state(null); // which keybind is being recorded: 'toggle' | 'ptt' | 'dictation' | 'stats'

  // ---- Recording handlers ----

  function startRecording(name) {
    recordingKeybind = name;
  }

  function cancelRecording() {
    recordingKeybind = null;
  }

  function setKeybindValue(name, rawKey) {
    if (name === 'toggle') hotkeyToggle = rawKey;
    else if (name === 'ptt') pttKey = rawKey;
    else if (name === 'dictation') dictationKey = rawKey;
    else if (name === 'stats') statsHotkey = rawKey;
  }

  function handleKeybindKeydown(e) {
    if (recordingKeybind === null) return;

    e.preventDefault();
    e.stopPropagation();

    // Escape cancels recording
    if (e.key === 'Escape') {
      cancelRecording();
      return;
    }

    // PTT and dictation use the native input hook — store as "kb:VKEY"
    // (single key, no modifier combos — the hook suppresses the key at OS level)
    if (recordingKeybind === 'ptt' || recordingKeybind === 'dictation') {
      // Ignore modifier-only presses
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      setKeybindValue(recordingKeybind, `kb:${e.keyCode}`);
      recordingKeybind = null;
      return;
    }

    // Other keybinds (toggle overlay, stats) use Tauri global shortcuts — combo format
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');

    const key = e.key;
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
      parts.push(key.length === 1 ? key.toUpperCase() : key);
    }

    if (parts.length > 0 && !['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      const rawKey = parts.join('+');
      setKeybindValue(recordingKeybind, rawKey);
      recordingKeybind = null;
    }
  }

  function handleKeybindMousedown(e) {
    if (recordingKeybind === null) return;

    // Skip left (0) and right (2) -- those are for UI interaction
    if (e.button === 0 || e.button === 2) return;

    e.preventDefault();
    e.stopPropagation();

    // Browser button IDs → our mouse button IDs
    // Browser: 1=middle, 3=back, 4=forward
    // Ours: 3=middle, 4=back (XBUTTON1), 5=forward (XBUTTON2)
    const buttonMap = { 1: 3, 3: 4, 4: 5 };
    const buttonId = buttonMap[e.button] || (e.button + 1);

    // PTT and dictation use the native input hook — store as "mouse:ID"
    if (recordingKeybind === 'ptt' || recordingKeybind === 'dictation') {
      setKeybindValue(recordingKeybind, `mouse:${buttonId}`);
      recordingKeybind = null;
      return;
    }

    // Other keybinds: legacy format for display
    const legacyNames = { 1: 'MouseButton3', 3: 'MouseButton4', 4: 'MouseButton5' };
    const rawKey = legacyNames[e.button] || `MouseButton${e.button + 1}`;
    setKeybindValue(recordingKeybind, rawKey);
    recordingKeybind = null;
  }

  function handleClickOutside(e) {
    if (recordingKeybind !== null && !e.target.closest('.keybind-input')) {
      cancelRecording();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="keybind-recorder"
  onkeydown={handleKeybindKeydown}
  onmousedown={handleKeybindMousedown}
  onclick={handleClickOutside}
>
  <div class="keybind-row">
    <span class="keybind-label">Toggle Overlay</span>
    <button
      class="keybind-input"
      class:recording={recordingKeybind === 'toggle'}
      onclick={(e) => { e.stopPropagation(); startRecording('toggle'); }}
    >
      {recordingKeybind === 'toggle' ? 'Press key...' : formatKeybind(hotkeyToggle)}
    </button>
  </div>
  <div class="keybind-row">
    <span class="keybind-label">Push-to-Talk</span>
    <button
      class="keybind-input"
      class:recording={recordingKeybind === 'ptt'}
      onclick={(e) => { e.stopPropagation(); startRecording('ptt'); }}
    >
      {recordingKeybind === 'ptt' ? 'Press key...' : formatKeybind(pttKey)}
    </button>
  </div>
  <div class="keybind-row">
    <span class="keybind-label">Dictation</span>
    <button
      class="keybind-input"
      class:recording={recordingKeybind === 'dictation'}
      onclick={(e) => { e.stopPropagation(); startRecording('dictation'); }}
    >
      {recordingKeybind === 'dictation' ? 'Press key...' : formatKeybind(dictationKey)}
    </button>
  </div>
  <div class="keybind-row">
    <span class="keybind-label">Stats Dashboard</span>
    <button
      class="keybind-input"
      class:recording={recordingKeybind === 'stats'}
      onclick={(e) => { e.stopPropagation(); startRecording('stats'); }}
    >
      {recordingKeybind === 'stats' ? 'Press key...' : formatKeybind(statsHotkey)}
    </button>
  </div>
</div>
