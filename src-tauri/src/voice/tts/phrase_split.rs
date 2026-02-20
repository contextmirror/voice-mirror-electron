//! Text phrase splitting for incremental TTS synthesis.

/// Split text into phrases suitable for incremental TTS synthesis.
///
/// Targets 5-8 word boundaries using sentence punctuation and natural
/// break points. Short fragments are merged with neighbors.
pub fn split_into_phrases(text: &str) -> Vec<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return vec![];
    }

    // Short text -- don't split
    if trimmed.len() < 80 {
        return vec![trimmed.to_string()];
    }

    let mut phrases: Vec<String> = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = trimmed.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        current.push(chars[i]);

        // Sentence boundary: punctuation followed by whitespace or end
        let is_punct = matches!(chars[i], '.' | '!' | '?')
            && (i + 1 >= len || chars[i + 1].is_whitespace());

        // Paragraph break
        let is_para = chars[i] == '\n' && current.trim().len() > 10;

        if is_punct || is_para {
            let s = current.trim().to_string();
            if !s.is_empty() {
                phrases.push(s);
            }
            current.clear();
            // Skip whitespace after boundary
            while i + 1 < len && chars[i + 1].is_whitespace() {
                i += 1;
            }
        }
        i += 1;
    }

    // Push remainder
    let remainder = current.trim().to_string();
    if !remainder.is_empty() {
        if remainder.len() < 15 {
            // Very short -- merge with last phrase
            if let Some(last) = phrases.last_mut() {
                last.push(' ');
                last.push_str(&remainder);
            } else {
                phrases.push(remainder);
            }
        } else {
            phrases.push(remainder);
        }
    }

    // Merge short phrases (< 20 chars) forward
    let mut merged: Vec<String> = Vec::new();
    let mut carry = String::new();
    for s in phrases {
        if !carry.is_empty() {
            carry.push(' ');
            carry.push_str(&s);
            if carry.len() >= 20 {
                merged.push(std::mem::take(&mut carry));
            }
        } else if s.len() < 20 {
            carry = s;
        } else {
            merged.push(s);
        }
    }
    if !carry.is_empty() {
        if let Some(last) = merged.last_mut() {
            last.push(' ');
            last.push_str(&carry);
        } else {
            merged.push(carry);
        }
    }

    if merged.is_empty() {
        vec![trimmed.to_string()]
    } else {
        merged
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_phrase_splitting_empty() {
        assert!(split_into_phrases("").is_empty());
        assert!(split_into_phrases("   ").is_empty());
    }

    #[test]
    fn test_phrase_splitting_short() {
        let result = split_into_phrases("Hello world.");
        assert_eq!(result, vec!["Hello world."]);
    }

    #[test]
    fn test_phrase_splitting_multiple() {
        let text = "This is the first sentence with enough text. \
                     The second sentence follows here. And a third one.";
        let result = split_into_phrases(text);
        assert!(
            result.len() >= 2,
            "Expected at least 2 phrases, got {}: {:?}",
            result.len(),
            result
        );
    }

    #[test]
    fn test_phrase_splitting_preserves_content() {
        let text = "First sentence here. Second sentence follows. Third wraps up.";
        let result = split_into_phrases(text);
        let joined = result.join(" ");
        assert!(joined.contains("First"));
        assert!(joined.contains("Second"));
        assert!(joined.contains("Third"));
    }
}
