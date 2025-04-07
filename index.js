const fs = require('fs');
const path = require('path');
const buildMeta = require('./src/buildMeta');
const buildReplay = require('./src/buildReplay');

const replayChunksDir = path.join(__dirname, 'replay_chunks');
const metadataFilePath = path.join(replayChunksDir, 'metadata.json');
const timingFilePath = path.join(replayChunksDir, 'timing.json');

const defaultConfig = {
  updateCallback: (progress) => console.log('Progress:', progress),
  dataCount: Infinity,
  eventCount: Infinity,
  checkpointCount: Infinity,
};

const loadJSONFile = (filePath, fileName) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${fileName} file not found at ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
};

const loadChunkFile = (chunkName) => {
  const filePath = path.join(replayChunksDir, chunkName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Chunk file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath);
};

const processReplay = async (config = defaultConfig) => {
  console.log('Starting replay processing...');

  const metadata = loadJSONFile(metadataFilePath, 'Metadata');
  const timingData = loadJSONFile(timingFilePath, 'Timing Data');

  if (!metadata?.meta) throw new Error('Invalid metadata: missing "meta" field.');

  const { meta } = metadata;
  const { updateCallback } = config;
  const downloadChunks = [];

  const pavlovEvents = metadata.events_pavlov?.events || [];
  const checkpointEvents = metadata.events?.events || [];

  const metaBuffer = buildMeta(meta);
  console.log('Meta buffer created successfully.');

  const headerFile = 'replay.header';
  const headerData = loadChunkFile(headerFile);
  downloadChunks.push({
    data: headerData,
    type: 'chunk',
    chunkType: 0,
    encoding: null,
  });

  // Process stream files.
  const streamFiles = fs.readdirSync(replayChunksDir)
    .filter(file => file.startsWith('stream.'))
    .sort((a, b) => parseInt(a.split('.')[1], 10) - parseInt(b.split('.')[1], 10));

  updateCallback({
    header: { current: 0, max: 1 },
    dataChunks: { current: 0, max: Math.min(streamFiles.length, config.dataCount) },
    eventChunks: { current: 0, max: Math.min(pavlovEvents.length, config.eventCount) },
    checkpointChunks: { current: 0, max: Math.min(checkpointEvents.length, config.checkpointCount) },
  });

  let currentOffset = 0;

  console.log(`\n**Dumping Chunks Before Writing File**`);
  console.log(`------------------------------------------`);

  streamFiles.forEach((file, index) => {
    if (index >= config.dataCount) return;
    const fileData = loadChunkFile(file);
    const fileSize = fileData.length;

    if (fileSize <= 0) {
      console.warn(`-| Skipping empty stream file: ${file}`);
      return;
    }

    console.log(`-| Data Chunk ${index}: Offset ${currentOffset}, Size ${fileSize}`);
    downloadChunks.push({
      data: fileData,
      type: 'chunk',
      chunkType: 1,
      Time1: 0, // or use timing if available
      Time2: 0, // or use timing if available
      encoding: null,
    });
    currentOffset += fileSize;
  });

  // Add event and checkpoint chunks.
  const addEventChunk = (event, chunkType, index, maxCount) => {
    if (index >= maxCount) return;
    if (!event.id || !event.group) {
      console.warn(`-| Skipping event chunk with missing ID/Group:`, event);
      return;
    }

    // Get event data buffer.
    const eventBuffer = (event.data?.type === 'Buffer' && Array.isArray(event.data.data))
      ? Buffer.from(event.data.data)
      : Buffer.from([]);

    console.log(`-| Event Chunk ${index}: Offset ${currentOffset}, Data Size ${eventBuffer.length} (Type ${chunkType})`);

    downloadChunks.push({
      data: eventBuffer,
      type: 'chunk',
      chunkType: chunkType,
      Id: event.id,
      Group: event.group,
      Metadata: event.meta,
      Time1: event.time1 || 0,
      Time2: event.time2 || 0,
      encoding: null,
    });

    currentOffset += eventBuffer.length;
  };

  pavlovEvents.forEach((event, index) => addEventChunk(event, 3, index, config.eventCount));
  checkpointEvents.forEach((event, index) => addEventChunk(event, 2, index, config.checkpointCount));

  console.log('All chunks processed. Building replay...');

  const replay = buildReplay([
    { type: 'meta', data: metaBuffer },
    ...downloadChunks,
  ]);

  console.log('Replay built successfully.');

  const outputFilePath = path.join(__dirname, 'processed_replay.replay');
  fs.writeFileSync(outputFilePath, replay);

  console.log(`Replay saved: ${outputFilePath}`);
  return replay;
};

(async () => {
  try {
    await processReplay();
  } catch (error) {
    console.error('Error during replay processing:', error);
  }
})();
