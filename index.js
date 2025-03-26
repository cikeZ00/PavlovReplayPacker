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

const loadMetadata = () => {
  console.log(`Loading metadata from: ${metadataFilePath}`);
  if (!fs.existsSync(metadataFilePath)) {
    throw new Error(`Metadata file not found at ${metadataFilePath}`);
  }
  const metadata = JSON.parse(fs.readFileSync(metadataFilePath, 'utf-8'));
  return metadata;
};

const loadTimingData = () => {
  console.log(`Loading timing data from: ${timingFilePath}`);
  if (!fs.existsSync(timingFilePath)) {
    throw new Error(`Timing file not found at ${timingFilePath}`);
  }
  const timingData = JSON.parse(fs.readFileSync(timingFilePath, 'utf-8'));
  return timingData;
};

const loadChunkFile = (chunkName) => {
  const filePath = path.join(replayChunksDir, chunkName);
  console.log(`Loading chunk file: ${filePath}`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Chunk file not found: ${filePath}`);
  }
  const chunkData = fs.readFileSync(filePath);
  console.log(`Chunk file loaded successfully: ${chunkName}`);
  return chunkData;
};

const processReplay = async (config = defaultConfig) => {
  console.log('Starting replay processing with config:', config);

  const metadata = loadMetadata();
  const timingData = loadTimingData();
  if (!metadata || !metadata.meta) {
    throw new Error('Metadata is invalid or missing the "meta" field.');
  }
  const { meta } = metadata;
  const { updateCallback } = config;

  const downloadChunks = [];

  // Build meta buffer
  const metaBuffer = buildMeta(meta);
  console.log('Meta buffer created successfully.');

  // Load the header file
  console.log('Loading header file: replay.header');
  downloadChunks.push({
    data: loadChunkFile('replay.header'),
    type: 'chunk',
    chunkType: 0, // header type
    size: fs.statSync(path.join(replayChunksDir, 'replay.header')).size,
    encoding: null,
  });

  // Process stream files
  const allFiles = fs.readdirSync(replayChunksDir);
  const streamFiles = allFiles
    .filter(file => file.startsWith('stream.'))
    .sort((a, b) => {
      const aNum = parseInt(a.split('.')[1], 10);
      const bNum = parseInt(b.split('.')[1], 10);
      return aNum - bNum;
    });

  const eventsArray = (metadata.events && Array.isArray(metadata.events.events))
    ? metadata.events.events
    : [];

  // Set progress max
  updateCallback({
    header: { current: 0, max: 1 },
    dataChunks: { current: 0, max: Math.min(streamFiles.length, config.dataCount) },
    eventChunks: { current: 0, max: Math.min(eventsArray.length, config.eventCount) },
    checkpointChunks: { current: 0, max: Math.min(eventsArray.length, config.checkpointCount) },
  });

  // Load streams
  streamFiles.forEach((file, index) => {
    if (index >= config.dataCount) return;
    console.log(`Loading data chunk: ${file}`);
    const filePath = path.join(replayChunksDir, file);
    const fileSize = fs.statSync(filePath).size;

    const chunkNumber = index + 1; // Stream files are 1-indexed in timing.json
    const timingEntry = timingData.find(entry => parseInt(entry.numchunks, 10) === chunkNumber);

    downloadChunks.push({
      data: loadChunkFile(file),
      type: 'chunk',
      chunkType: 1, // data chunk
      size: fileSize,
      Time1: timingEntry ? parseInt(timingEntry.mtime1, 10) : 0,
      Time2: timingEntry ? parseInt(timingEntry.mtime2, 10) : 0,
      SizeInBytes: fileSize,
      encoding: null,
    });
  });

  // Process events from the metadata as event chunks.
  eventsArray.forEach((event, index) => {
    if (index >= config.eventCount) return;
    console.log(`Processing event chunk for event: ${event.id}`);

    // Convert event.data to a Buffer
    let eventBuffer;
    if (event.data && event.data.type === 'Buffer' && Array.isArray(event.data.data)) {
      eventBuffer = Buffer.from(event.data.data);
    }

    const computedSize =
      35 +
      (event.id ? event.id.length : 0) +
      (event.group ? event.group.length : 0) +
      (event.meta ? event.meta.toString().length : 0) +
      eventBuffer.length;

    downloadChunks.push({
      data: eventBuffer,
      type: 'chunk',
      chunkType: 3, // event chunk type
      size: computedSize,
      encoding: null,
      Id: event.id,         
      Group: event.group,   
      Metadata: event.meta,
      Time1: event.time1 || 0, 
      Time2: event.time2 || 0,
    });
  });

  // Process the same events as checkpoint chunks
  eventsArray.forEach((event, index) => {
    if (index >= config.checkpointCount) return;
    console.log(`Processing checkpoint chunk for event: ${event.id}`);

    // Convert event.data to a Buffer
    let checkpointBuffer;
    if (event.data && event.data.type === 'Buffer' && Array.isArray(event.data.data)) {
      checkpointBuffer = Buffer.from(event.data.data);
    }

    const computedSize =
      35 +
      (event.id ? event.id.length : 0) +
      (event.group ? event.group.length : 0) +
      (event.meta ? event.meta.toString().length : 0) +
      checkpointBuffer.length;

    downloadChunks.push({
      data: checkpointBuffer,
      type: 'chunk', 
      chunkType: 2, 
      size: computedSize,
      encoding: null,
      Id: event.id,         
      Group: event.group,   
      Metadata: event.meta, 
      Time1: event.time1 || 0, 
      Time2: event.time2 || 0, 
    });
  });

  // Update progress for all chunks
  let headerDone = 0;
  let dataDone = 0;
  let eventDone = 0;
  let checkpointDone = 0;

  downloadChunks.forEach((chunk) => {
    switch (chunk.chunkType) {
      case 0:
        headerDone += 1;
        break;
      case 1:
        dataDone += 1;
        break;
      case 3:
        eventDone += 1;
        break;
      case 2:
        checkpointDone += 1;
        break;
      default:
        break;
    }

    updateCallback({
      header: { current: headerDone, max: 1 },
      dataChunks: { current: dataDone, max: Math.min(streamFiles.length, config.dataCount) },
      eventChunks: { current: eventDone, max: Math.min(eventsArray.length, config.eventCount) },
      checkpointChunks: { current: checkpointDone, max: Math.min(eventsArray.length, config.checkpointCount) },
    });
  });

  console.log('All chunks processed. Building replay...');
  const replay = buildReplay([
    { type: 'meta', size: metaBuffer.length, data: metaBuffer },
    ...downloadChunks,
  ]);

  console.log('Replay built successfully.');
  return replay;
};

(async () => {
  try {
    const result = await processReplay();
    console.log('Replay processing completed successfully:', result);

    const outputFilePath = path.join(__dirname, 'processed_replay.replay');
    fs.writeFileSync(outputFilePath, result);
    console.log(`Replay saved successfully to: ${outputFilePath}`);
  } catch (error) {
    console.error('Error during replay processing:', error);
  }
})();
