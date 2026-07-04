/**
 * currency.test.cjs -- Source-inspection tests for the USD→local conversion util.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../src/lib/currency.js'),
  'utf-8'
);

describe('currency.js: exports', () => {
  for (const fn of ['detectCurrency', 'currencySymbol', 'getUsdConversion', 'formatCost']) {
    it(`exports ${fn}`, () => {
      assert.ok(src.includes(`export function ${fn}`) || src.includes(`export async function ${fn}`),
        `Should export ${fn}`);
    });
  }
});

describe('currency.js: conversion behaviour', () => {
  it('treats USD as a no-op (rate 1)', () => {
    assert.ok(src.includes("target === 'USD'"), 'Should short-circuit USD');
  });

  it('fetches from frankfurter.dev directly (no CORS-dropping redirect)', () => {
    assert.ok(src.includes('api.frankfurter.dev'), 'Should use the current frankfurter.dev host');
    assert.ok(!src.includes('api.frankfurter.app/latest'), 'Should not hit the redirecting .app host');
  });

  it('caches the rate in localStorage with a 24h TTL', () => {
    assert.ok(src.includes('localStorage'), 'Should cache in localStorage');
    assert.ok(src.includes('DAY_MS') && src.includes('24 * 60 * 60 * 1000'), 'Should use a 24h TTL');
  });

  it('falls back to USD rather than a wrong symbol on failure', () => {
    assert.ok(src.includes("return { rate: 1, code: 'USD' }"), 'Should fall back to honest USD');
  });

  it('detects the currency from the browser locale', () => {
    assert.ok(src.includes('Intl.Locale') && src.includes('navigator.language'), 'Should read the locale region');
    assert.ok(src.includes("GB: 'GBP'"), 'Should map GB → GBP');
  });
});
