function fail(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

const RF_COMMANDS = Object.freeze({
  CHANNEL: 'CHANNEL',
  POWER: 'POWER',
  ANTENNA: 'ANTENNA',
});

const CHANNEL_MIN = 0;
const CHANNEL_MAX = 80;
const POWER_MIN = 0;
const POWER_MAX = 10;
const SUPPORTED_ANTENNAS = Object.freeze({
  MAIN: 'main',
  POGO: 'pogo',
});
const SUPPORTED_ANTENNA_VALUES = Object.freeze(Object.values(SUPPORTED_ANTENNAS));

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

function parsePowerValue(rawPower) {
  if (rawPower === undefined || rawPower === null || rawPower === '') {
    throw fail(400, 'INVALID_POWER', 'Power is required and must be an integer between 0 and 10');
  }

  const parsed = Number(rawPower);

  if (!Number.isInteger(parsed)) {
    throw fail(400, 'INVALID_POWER', 'Power must be an integer between 0 and 10');
  }

  if (parsed < POWER_MIN || parsed > POWER_MAX) {
    throw fail(400, 'INVALID_POWER', 'Power must be between 0 and 10');
  }

  return parsed;
}

function setPower(rawPower) {
  const power = parsePowerValue(rawPower);

  return {
    commandType: RF_COMMANDS.POWER,
    power,
    command: buildRfCommand(RF_COMMANDS.POWER, power),
  };
}

function parseAntennaValue(rawAntenna) {
  if (rawAntenna === undefined || rawAntenna === null || rawAntenna === '') {
    throw fail(400, 'INVALID_ANTENNA', 'Antenna is required and must be one of: main, pogo');
  }

  if (typeof rawAntenna !== 'string') {
    throw fail(400, 'INVALID_ANTENNA', 'Antenna must be one of: main, pogo');
  }

  const parsed = rawAntenna.trim().toLowerCase();

  if (!SUPPORTED_ANTENNA_VALUES.includes(parsed)) {
    throw fail(400, 'INVALID_ANTENNA', 'Antenna must be one of: main, pogo');
  }

  return parsed;
}

function setAntenna(rawAntenna) {
  const antenna = parseAntennaValue(rawAntenna);

  return {
    commandType: RF_COMMANDS.ANTENNA,
    antenna,
    command: buildRfCommand(RF_COMMANDS.ANTENNA, antenna),
  };
}

module.exports = {
  RF_COMMANDS,
  CHANNEL_MIN,
  CHANNEL_MAX,
  POWER_MIN,
  POWER_MAX,
  SUPPORTED_ANTENNAS,
  SUPPORTED_ANTENNA_VALUES,
  buildRfCommand,
  parseChannelValue,
  parsePowerValue,
  parseAntennaValue,
  setChannel,
  setPower,
  setAntenna,
};
