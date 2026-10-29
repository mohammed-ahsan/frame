'use strict';

const { Readable } = require('node:stream');
const sharp = require('sharp');

class MediaLimitError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'MediaLimitError';
    this.code = code;
  }
}

class MediaService {
  constructor({ db, bucket, config }) {
    this.db = db;
    this.bucket = bucket;
    this.config = config;
  }

  async normalize(inputBuffer) {
    return sharp(inputBuffer, { failOn: 'error', limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 1080, height: 1350, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84, effort: 5 })
      .toBuffer({ resolveWithObject: true });
  }

  async assertCapacity(userId, incomingBytes) {
    const [fileCount, totals] = await Promise.all([
      this.db.collection('mediaFiles').countDocuments({ userId, deletedAt: null }),
      this.db.collection('mediaFiles').aggregate([
        { $match: { userId, deletedAt: null } },
        { $group: { _id: null, bytes: { $sum: '$bytes' } } },
      ]).next(),
    ]);
    if (fileCount >= this.config.MAX_FILES_PER_USER) {
      throw new MediaLimitError('File limit reached. Delete an image before uploading another.', 'FILE_LIMIT_REACHED');
    }
    if ((totals?.bytes || 0) + incomingBytes > this.config.maxStorageBytes) {
      throw new MediaLimitError('Storage limit reached. Delete images to free space.', 'STORAGE_LIMIT_REACHED');
    }
  }

  async store({ userId, source, buffer, originalName = 'image', generationId = null }) {
    const normalized = await this.normalize(buffer);
    await this.assertCapacity(userId, normalized.data.length);
    const upload = this.bucket.openUploadStream(`${crypto.randomUUID()}.webp`, {
      contentType: 'image/webp',
      metadata: { userId, source, generationId },
    });
    await new Promise((resolve, reject) => {
      Readable.from(normalized.data).pipe(upload).once('finish', resolve).once('error', reject);
    });
    const now = new Date();
    const document = {
      userId,
      gridFsId: upload.id,
      originalName: String(originalName).slice(0, 180),
      source,
      generationId,
      mimeType: 'image/webp',
      width: normalized.info.width,
      height: normalized.info.height,
      bytes: normalized.data.length,
      createdAt: now,
      deletedAt: null,
    };
    const result = await this.db.collection('mediaFiles').insertOne(document);
    return { id: result.insertedId, ...document };
  }
}

module.exports = { MediaLimitError, MediaService };
