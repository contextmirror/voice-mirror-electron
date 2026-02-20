/**
 * attachments.test.js -- Source-inspection tests for attachments.svelte.js
 *
 * Validates the shared pending attachments store used by both the text
 * (ChatInput) and voice (routeTranscriptionToAI) message paths.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'lib', 'stores', 'attachments.svelte.js'),
  'utf-8'
);

describe('attachments: exports', () => {
  it('exports attachmentsStore', () => {
    assert.ok(src.includes('export const attachmentsStore'), 'Should export attachmentsStore');
  });

  it('creates store via createAttachmentsStore factory', () => {
    assert.ok(src.includes('function createAttachmentsStore()'), 'Should define createAttachmentsStore');
    assert.ok(src.includes('createAttachmentsStore()'), 'Should call createAttachmentsStore()');
  });
});

describe('attachments: $state reactivity', () => {
  it('uses $state for attachments', () => {
    assert.ok(/let\s+attachments\s*=\s*\$state\(/.test(src), 'Should use $state for attachments');
  });

  it('attachments initialized as empty array', () => {
    assert.ok(src.includes('$state([])'), 'attachments should be initialized as $state([])');
  });
});

describe('attachments: getters', () => {
  it('has getter "pending"', () => {
    assert.ok(src.includes('get pending()'), 'Should have pending getter');
  });

  it('has getter "hasPending"', () => {
    assert.ok(src.includes('get hasPending()'), 'Should have hasPending getter');
  });

  it('hasPending checks attachments length', () => {
    assert.ok(src.includes('attachments.length > 0'), 'hasPending should check length');
  });
});

describe('attachments: methods', () => {
  it('has add method', () => {
    assert.ok(src.includes('add('), 'Should have add method');
  });

  it('has remove method', () => {
    assert.ok(src.includes('remove('), 'Should have remove method');
  });

  it('has clear method', () => {
    assert.ok(src.includes('clear()'), 'Should have clear method');
  });

  it('has take method that returns and clears', () => {
    assert.ok(src.includes('take()'), 'Should have take method');
    // take() should read current attachments and then clear
    const takeBlock = src.slice(src.indexOf('take()'));
    const takeEnd = takeBlock.indexOf('},');
    const takeBody = takeBlock.slice(0, takeEnd);
    assert.ok(takeBody.includes('attachments = []'), 'take should clear attachments');
  });
});

describe('attachments: remove uses filter', () => {
  it('filters by index', () => {
    assert.ok(src.includes('.filter('), 'remove should use filter');
  });
});
