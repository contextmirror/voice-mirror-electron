//! Lock-based ring buffer for audio samples.
//!
//! Uses a simple Vec-based circular buffer with mutex protection.
//! Not lock-free like the voice-core ringbuf implementation, but
//! sufficient for the Tauri integration where we have more flexibility
//! in thread scheduling.

use std::sync::{Arc, Mutex};

/// Simple ring buffer producer (wraps a Vec with write position).
pub(crate) struct RingProducer {
    pub(crate) buffer: Arc<Mutex<RingBuffer>>,
}

/// Simple ring buffer consumer (reads from shared buffer).
pub(crate) struct RingConsumer {
    pub(crate) buffer: Arc<Mutex<RingBuffer>>,
}

/// Lock-based ring buffer for audio samples.
pub(crate) struct RingBuffer {
    data: Vec<f32>,
    write_pos: usize,
    read_pos: usize,
    count: usize,
    capacity: usize,
}

impl RingBuffer {
    pub(crate) fn new(capacity: usize) -> Self {
        Self {
            data: vec![0.0; capacity],
            write_pos: 0,
            read_pos: 0,
            count: 0,
            capacity,
        }
    }

    pub(crate) fn push_slice(&mut self, samples: &[f32]) -> usize {
        let mut written = 0;
        for &sample in samples {
            if self.count >= self.capacity {
                // Overwrite oldest data
                self.read_pos = (self.read_pos + 1) % self.capacity;
                self.count -= 1;
            }
            self.data[self.write_pos] = sample;
            self.write_pos = (self.write_pos + 1) % self.capacity;
            self.count += 1;
            written += 1;
        }
        written
    }

    pub(crate) fn pop_slice(&mut self, buf: &mut [f32]) -> usize {
        let to_read = buf.len().min(self.count);
        for item in buf.iter_mut().take(to_read) {
            *item = self.data[self.read_pos];
            self.read_pos = (self.read_pos + 1) % self.capacity;
            self.count -= 1;
        }
        to_read
    }

    #[allow(dead_code)]
    pub(crate) fn available(&self) -> usize {
        self.count
    }

    pub(crate) fn drain_all(&mut self) -> Vec<f32> {
        let n = self.count;
        if n == 0 {
            return Vec::new();
        }
        let mut buf = vec![0.0f32; n];
        self.pop_slice(&mut buf);
        buf
    }
}

pub(crate) fn create_ring_buffer(capacity: usize) -> (RingProducer, RingConsumer) {
    let buffer = Arc::new(Mutex::new(RingBuffer::new(capacity)));
    (
        RingProducer {
            buffer: Arc::clone(&buffer),
        },
        RingConsumer { buffer },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ring_buffer_basic() {
        let mut rb = RingBuffer::new(10);
        assert_eq!(rb.available(), 0);

        rb.push_slice(&[1.0, 2.0, 3.0]);
        assert_eq!(rb.available(), 3);

        let mut buf = [0.0f32; 2];
        let read = rb.pop_slice(&mut buf);
        assert_eq!(read, 2);
        assert_eq!(buf, [1.0, 2.0]);
        assert_eq!(rb.available(), 1);
    }

    #[test]
    fn test_ring_buffer_overflow() {
        let mut rb = RingBuffer::new(4);
        // Write 6 samples into a buffer of size 4
        rb.push_slice(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        assert_eq!(rb.available(), 4);

        // Should have the last 4 samples (overflow drops oldest)
        let all = rb.drain_all();
        assert_eq!(all, vec![3.0, 4.0, 5.0, 6.0]);
    }

    #[test]
    fn test_ring_buffer_drain_all() {
        let mut rb = RingBuffer::new(100);
        rb.push_slice(&[1.0, 2.0, 3.0, 4.0]);
        let all = rb.drain_all();
        assert_eq!(all, vec![1.0, 2.0, 3.0, 4.0]);
        assert_eq!(rb.available(), 0);
    }

    #[test]
    fn test_ring_buffer_empty_drain() {
        let mut rb = RingBuffer::new(100);
        let all = rb.drain_all();
        assert!(all.is_empty());
    }
}
