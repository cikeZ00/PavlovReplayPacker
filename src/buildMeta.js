const Replay = require('./Replay');
const Size = require('./Size');

const FRIENDLY_NAME_SIZE = 514; // Reserved space for friendly name in bytes

const buildMeta = (meta) => {
  const size = new Size();

  // Fixed fields size (before friendly name)
  size.size += 48;

  // Construct friendly name string using the specified fields
  // Format: gameMode,friendlyName,competitive,0,workshop_mods,live
  const competitiveStr = meta.competitive ? 'competitive' : 'casual';
  let friendlyNameStr = `${meta.gameMode},${meta.friendlyName},${competitiveStr},0,${meta.workshop_mods},${meta.live}`;

  // Convert friendly name to a UTF-16LE buffer
  let nameBytes = Buffer.from(friendlyNameStr, 'utf-16le');

  // Create a fixed-size buffer prefilled with spaces in UTF-16LE.
  // In UTF-16LE a space is encoded as 0x20 0x00.
  let friendlyNameBuffer = Buffer.alloc(FRIENDLY_NAME_SIZE);
  for (let i = 0; i < FRIENDLY_NAME_SIZE - 2; i += 2) {
    friendlyNameBuffer[i] = 0x20;   // Low byte for space
    friendlyNameBuffer[i + 1] = 0x00; // High byte for space
  }

  // Ensure the remaining bytes are explicitly set to 0x00
  for (let i = FRIENDLY_NAME_SIZE - 2; i < FRIENDLY_NAME_SIZE; i++) {
    friendlyNameBuffer[i] = 0x00;
  }

  // Copy the friendly name bytes into our fixed-size buffer.
  // If nameBytes is longer than FRIENDLY_NAME_SIZE, it will be truncated.
  nameBytes.copy(friendlyNameBuffer, 0, 0, Math.min(nameBytes.length, FRIENDLY_NAME_SIZE));

  // Update the total expected size with the reserved friendly name space.
  size.size += FRIENDLY_NAME_SIZE;
  console.log(`Friendly name reserved size: ${FRIENDLY_NAME_SIZE}`);

  console.log(`Total buffer size: ${size.size}`);
  const buffer = new Replay(size.getBuffer());

  // Write fixed fields
  buffer.writeInt32(0x1CA2E27F); // Magic number
  buffer.writeInt32(6);           // Version
  buffer.writeInt32(meta.totalTime); // Total time
  buffer.writeInt32(meta.__v);       // Network version
  buffer.writeInt32(0); 
  buffer.writeInt32(-257);     // Some fixed max value

  // Write the friendly name field (fixed size, padded as above)
  console.log(`Writing padded friendly name at offset: ${buffer.offset}`);
  buffer.writeBytes(friendlyNameBuffer);

  // Write live status (1 for true, 0 for false)
  console.log(`Writing live status at offset: ${buffer.offset}`);
  buffer.writeInt32(meta.live ? 1 : 0);

  // Write timestamp (converted to the proper format)
  const timestamp = BigInt(new Date(meta.created).getTime() * 10000) + 621355968000000000n;
  console.log(`Writing timestamp at offset: ${buffer.offset}`);
  buffer.writeInt64(timestamp);

  // Write compressed flag
  console.log(`Writing compressed flag at offset: ${buffer.offset}`);
  buffer.writeInt32(meta.bCompressed);

  // Write number of chunks (set to 0)
  console.log(`Writing number of chunks at offset: ${buffer.offset}`);
  buffer.writeInt32(0);

  // Write an empty array for additional data
  console.log(`Writing empty array at offset: ${buffer.offset}`);
  buffer.writeArray([], (a, value) => a.writeByte(value));

  // Validate the written buffer size
  console.log(`Final buffer offset: ${buffer.offset}`);
  size.validate(buffer);

  return buffer.buffer;
};

module.exports = buildMeta;
