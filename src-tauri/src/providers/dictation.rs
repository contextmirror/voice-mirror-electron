//! Dictation Provider — no-op "null" provider for voice-to-text only mode.
//!
//! When selected, the voice pipeline runs STT normally but all transcriptions
//! are injected as text into the focused application (dictation mode).
//! No AI backend, PTY, or HTTP connection is used.

use tokio::sync::mpsc::UnboundedSender;

use super::{Provider, ProviderConfig, ProviderEvent};

pub struct DictationProvider {
    provider_type: String,
    event_tx: UnboundedSender<ProviderEvent>,
    running: bool,
}

impl DictationProvider {
    pub fn new(
        provider_type: &str,
        event_tx: UnboundedSender<ProviderEvent>,
        _config: ProviderConfig,
    ) -> Self {
        Self {
            provider_type: provider_type.to_string(),
            event_tx,
            running: false,
        }
    }
}

impl Provider for DictationProvider {
    fn start(&mut self, _cols: u16, _rows: u16) -> Result<(), String> {
        self.running = true;
        let _ = self.event_tx.send(ProviderEvent::Ready);
        Ok(())
    }

    fn stop(&mut self) {
        self.running = false;
    }

    fn send_input(&mut self, _data: &str) {
        // No-op: dictation mode has no AI to send input to.
    }

    fn send_raw_input(&mut self, _data: &[u8]) {
        // No-op: no PTY terminal.
    }

    fn resize(&mut self, _cols: u16, _rows: u16) {
        // No-op: no terminal to resize.
    }

    fn is_running(&self) -> bool {
        self.running
    }

    fn provider_type(&self) -> &str {
        &self.provider_type
    }

    fn display_name(&self) -> &str {
        "Dictation Only"
    }

    fn interrupt(&mut self) {
        // No-op: nothing to interrupt.
    }

    fn send_voice_loop(&mut self, _sender_name: &str) {
        // No-op: dictation mode doesn't use AI voice loops.
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    #[test]
    fn starts_and_stops() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut p = DictationProvider::new("dictation", tx, ProviderConfig::default());
        assert!(!p.is_running());
        p.start(120, 30).unwrap();
        assert!(p.is_running());
        assert_eq!(p.provider_type(), "dictation");
        assert_eq!(p.display_name(), "Dictation Only");
        p.stop();
        assert!(!p.is_running());
    }

    #[test]
    fn emits_ready_on_start() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut p = DictationProvider::new("dictation", tx, ProviderConfig::default());
        p.start(120, 30).unwrap();
        let event = rx.try_recv().unwrap();
        assert!(matches!(event, ProviderEvent::Ready));
    }
}
