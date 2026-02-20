<script>
  /**
   * TTSConfig.svelte -- TTS engine selection, voice picker, model size, speed/volume.
   */
  import { ADAPTER_REGISTRY } from '../../lib/voice-adapters.js';
  import Select from '../shared/Select.svelte';
  import TextInput from '../shared/TextInput.svelte';
  import Slider from '../shared/Slider.svelte';

  let {
    ttsAdapter = $bindable('kokoro'),
    ttsVoice = $bindable('af_bella'),
    ttsModelSize = $bindable('0.6B'),
    ttsSpeed = $bindable(1.0),
    ttsVolume = $bindable(1.0),
    ttsApiKey = $bindable(''),
    ttsEndpoint = $bindable(''),
    ttsModelPath = $bindable(''),
  } = $props();

  // ---- Derived values ----

  const currentTTSAdapter = $derived(ADAPTER_REGISTRY[ttsAdapter] || ADAPTER_REGISTRY.kokoro);

  const ttsAdapterOptions = $derived(
    Object.entries(ADAPTER_REGISTRY).map(([key, reg]) => ({
      value: key,
      label: reg.label,
      group: reg.category === 'local' ? 'Local' : reg.category === 'cloud-free' ? 'Cloud (free)' : 'Cloud (paid)',
    }))
  );

  const ttsVoiceOptions = $derived(
    currentTTSAdapter.voices.map(v => ({ value: v.value, label: v.label }))
  );

  const ttsModelSizeOptions = $derived(
    currentTTSAdapter.showModelSize && currentTTSAdapter.modelSizes
      ? currentTTSAdapter.modelSizes.map(s => ({ value: s.value, label: s.label }))
      : []
  );

  // ---- When TTS adapter changes, reset voice to first available ----

  function handleTTSAdapterChange(newAdapter) {
    ttsAdapter = newAdapter;
    const reg = ADAPTER_REGISTRY[newAdapter] || ADAPTER_REGISTRY.kokoro;
    const voiceExists = reg.voices.some(v => v.value === ttsVoice);
    if (!voiceExists) {
      ttsVoice = reg.voices[0]?.value || '';
    }
  }
</script>

<section class="settings-section">
  <h3>Text-to-Speech</h3>
  <div class="settings-group">
    <Select
      label="TTS Engine"
      value={ttsAdapter}
      options={ttsAdapterOptions}
      onChange={handleTTSAdapterChange}
    />
    <Select
      label="Voice"
      value={ttsVoice}
      options={ttsVoiceOptions}
      onChange={(v) => (ttsVoice = v)}
    />

    {#if currentTTSAdapter.showModelSize && ttsModelSizeOptions.length > 0}
      <Select
        label="Model Size"
        value={ttsModelSize}
        options={ttsModelSizeOptions}
        onChange={(v) => (ttsModelSize = v)}
      />
    {/if}

    <Slider
      label="Speed"
      value={ttsSpeed}
      min={0.5}
      max={2.0}
      step={0.1}
      onChange={(v) => (ttsSpeed = v)}
      formatValue={(v) => v.toFixed(1) + 'x'}
    />
    <Slider
      label="Volume"
      value={ttsVolume}
      min={0.1}
      max={2.0}
      step={0.1}
      onChange={(v) => (ttsVolume = v)}
      formatValue={(v) => Math.round(v * 100) + '%'}
    />

    {#if currentTTSAdapter.showApiKey}
      <TextInput
        label="API Key"
        value={ttsApiKey}
        type="password"
        placeholder="API key..."
        onChange={(v) => (ttsApiKey = v)}
      />
    {/if}

    {#if currentTTSAdapter.showEndpoint}
      <TextInput
        label="Endpoint"
        value={ttsEndpoint}
        placeholder="https://your-server.com/v1"
        onChange={(v) => (ttsEndpoint = v)}
      />
    {/if}

    {#if currentTTSAdapter.showModelPath}
      <TextInput
        label="Model Path"
        value={ttsModelPath}
        placeholder="Optional: path to custom .onnx voice file"
        onChange={(v) => (ttsModelPath = v)}
      />
    {/if}
  </div>
</section>
