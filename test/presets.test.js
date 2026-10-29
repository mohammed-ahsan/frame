'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PRESETS, getPreset } = require('../src/domain/presets');

test('style library exposes 20 unique visual presets', () => {
  assert.equal(PRESETS.length, 20);
  assert.equal(new Set(PRESETS.map((preset) => preset.id)).size, 20);
  assert.equal(getPreset('ghibli-dream').name, 'Ghibli Dream');
  assert.ok(PRESETS.every((preset) => preset.prompt.length > 40));
});
