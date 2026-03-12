function fail(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

const RF_COMMANDS = Object.freeze({
  CHANNEL: 'CHANNEL',
});

const CHANNEL_MIN = 0;
const CHANNEL_MAX = 80;

function buildRfCommand(command, value) {
  return `${command}:${value}`;
}

function parseChannelValue(rawChannel) {
  if (rawChannel === undefined || rawChannel === null || rawChannel === '') {
    throw fail(400, 'INVALID_CHANNEL', 'Channel is required and must be an integer between 0 and 80');
  }

  const parsed = Number(rawChannel);

  if (!Number.isInteger(parsed)) {
    throw fail(400, 'INVALID_CHANNEL', 'Channel must be an integer between 0 and 80');
  }

  if (parsed < CHANNEL_MIN || parsed > CHANNEL_MAX) {
    throw fail(400, 'INVALID_CHANNEL', 'Channel must be between 0 and 80');
  }

  return parsed;
}

function setChannel(rawChannel) {
  const channel = parseChannelValue(rawChannel);

  return {
    commandType: RF_COMMANDS.CHANNEL,
    channel,
    command: buildRfCommand(RF_COMMANDS.CHANNEL, channel),
  };
}

module.exports = {
  RF_COMMANDS,
  CHANNEL_MIN,
  CHANNEL_MAX,
  buildRfCommand,
  parseChannelValue,
  setChannel,
};
