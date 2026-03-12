const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRfCommand,
  parseChannelValue,
  setChannel,
  RF_COMMANDS,
} = require('./rf-control.service');

test('buildRfCommand uses command abstraction consistently', () => {
  assert.equal(buildRfCommand(RF_COMMANDS.CHANNEL, 42), 'CHANNEL:42');
});

test('parseChannelValue accepts valid integer range 0..80', () => {
  assert.equal(parseChannelValue(0), 0);
  assert.equal(parseChannelValue('80'), 80);
  assert.equal(parseChannelValue('12'), 12);
});

test('parseChannelValue rejects missing and non-integer values clearly', () => {
  assert.throws(() => parseChannelValue(undefined), {
    code: 'INVALID_CHANNEL',
    message: 'Channel is required and must be an integer between 0 and 80',
  });

  assert.throws(() => parseChannelValue('abc'), {
    code: 'INVALID_CHANNEL',
    message: 'Channel must be an integer between 0 and 80',
  });

  assert.throws(() => parseChannelValue('4.2'), {
    code: 'INVALID_CHANNEL',
    message: 'Channel must be an integer between 0 and 80',
  });
});

test('parseChannelValue rejects out-of-range values clearly', () => {
  assert.throws(() => parseChannelValue(-1), {
    code: 'INVALID_CHANNEL',
    message: 'Channel must be between 0 and 80',
  });

  assert.throws(() => parseChannelValue(81), {
    code: 'INVALID_CHANNEL',
    message: 'Channel must be between 0 and 80',
  });
});

test('setChannel returns explicit command payload', () => {
  assert.deepEqual(setChannel('7'), {
    commandType: 'CHANNEL',
    channel: 7,
    command: 'CHANNEL:7',
  });
});
