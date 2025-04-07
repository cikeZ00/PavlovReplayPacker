// Helper: Serialize a string as [int32 length][utf8 bytes]
const writeStringBuffer = (str) => {
  const strBuf = Buffer.from(str, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeInt32LE(strBuf.length, 0);
  return Buffer.concat([lenBuf, strBuf]);
};
 
const buildReplay = (parts) => {
  const buffers = [];
 
  parts.forEach((part) => {
    if (part.type === 'meta') {
      // Meta parts are assumed to be already serialized.
      buffers.push(part.data);
    } else if (part.type === 'chunk') {
      let bodyBuffer;
 
      switch (part.chunkType) {
        // Chunk type 0: Header. Write the raw data.
        case 0:
          bodyBuffer = part.data;
          break;
 
        // Chunk type 1: Data chunk.
        case 1: {
          const headerBuf = Buffer.alloc(16);
          headerBuf.writeInt32LE(part.Time1, 0);
          headerBuf.writeInt32LE(part.Time2, 4);
          headerBuf.writeInt32LE(part.data.length, 8);
          if (part.SizeInBytes == null) {
            part.SizeInBytes = part.data.length;
          }
          headerBuf.writeInt32LE(part.SizeInBytes, 12);
          bodyBuffer = Buffer.concat([headerBuf, part.data]);
          break;
        }
 
        // Chunk types 2 and 3: Checkpoint / Event chunks.
        case 2:
        case 3: {
          const idBuf = writeStringBuffer(part.Id);
          const groupBuf = writeStringBuffer(part.Group);
          const metaBuf = writeStringBuffer(part.Metadata || '');

          const intBuf = Buffer.alloc(12);
          intBuf.writeInt32LE(part.Time1, 0);
          intBuf.writeInt32LE(part.Time2, 4);
          intBuf.writeInt32LE(part.data.length, 8);
 
          bodyBuffer = Buffer.concat([idBuf, groupBuf, metaBuf, intBuf, part.data]);
          break;
        }
 
        default:
          console.error(`Unknown chunk type encountered: ${part.chunkType}`);
          return;
      }
 
      const headerBuffer = Buffer.alloc(8);
      headerBuffer.writeInt32LE(part.chunkType, 0);
      headerBuffer.writeInt32LE(bodyBuffer.length, 4);
 
      buffers.push(headerBuffer);
      buffers.push(bodyBuffer);
    }
  });
 
  return Buffer.concat(buffers);
};
 
module.exports = buildReplay;
