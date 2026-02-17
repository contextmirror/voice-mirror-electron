//! Lock-free SPSC ring buffer for audio samples.
//!
//! Uses the `ringbuf` crate to provide a single-producer single-consumer
//! buffer suitable for passing f32 audio samples from the cpal callback
//! thread to the processing thread without locks.

use ringbuf::{
    traits::{Consumer, Observer, Producer, Split},
    HeapRb,
};

/// Default capacity: ~10 seconds of 16 kHz mono audio.
const DEFAULT_CAPACITY: usize = 160_000;

/// Producer half — lives in the cpal audio callback thread.
pub struct AudioProducer {
    inner: ringbuf::HeapProd<f32>,
}

/// Consumer half — lives in the audio processing thread.
pub struct AudioConsumer {
    inner: ringbuf::HeapCons<f32>,
}

/// Create a matched producer/consumer pair backed by a lock-free ring buffer.
pub fn audio_ring_buffer(capacity: Option<usize>) -> (AudioProducer, AudioConsumer) {
    let cap = capacity.unwrap_or(DEFAULT_CAPACITY);
    let rb = HeapRb::<f32>::new(cap);
    let (prod, cons) = rb.split();
    (AudioProducer { inner: prod }, AudioConsumer { inner: cons })
}

impl AudioProducer {
    /// Push a slice of samples into the ring buffer.
    /// Returns the number of samples actually written (may be less than
    /// `samples.len()` if the buffer is full).
    pub fn push_slice(&mut self, samples: &[f32]) -> usize {
        self.inner.push_slice(samples)
    }
}

// Safety: the ringbuf producer is designed to be used from a single thread.
// cpal callbacks run on a dedicated audio thread, so this is fine.
unsafe impl Send for AudioProducer {}

impl AudioConsumer {
    /// Pop up to `buf.len()` samples from the ring buffer into `buf`.
    /// Returns the number of samples actually read.
    pub fn pop_slice(&mut self, buf: &mut [f32]) -> usize {
        self.inner.pop_slice(buf)
    }

    /// Number of samples currently available for reading.
    pub fn available(&self) -> usize {
        self.inner.occupied_len()
    }

    /// Drain all available samples into a Vec.
    pub fn drain_all(&mut self) -> Vec<f32> {
        let n = self.available();
        if n == 0 {
            return Vec::new();
        }
        let mut buf = vec![0.0f32; n];
        let read = self.pop_slice(&mut buf);
        buf.truncate(read);
        buf
    }
}

unsafe impl Send for AudioConsumer {}
