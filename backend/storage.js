import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const s3 = new S3Client({
  region: process.env.B2_REGION,
  endpoint: process.env.B2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APPLICATION_KEY,
  },
});

const DOWNLOAD_URL_TTL = 6 * 60 * 60; // 6 hours - plenty for a normal chat session

export async function getUploadUrl(key, contentType) {
  const command = new PutObjectCommand({
    Bucket: process.env.B2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn: 300 });
}

export async function getDownloadUrl(key) {
  if (!key) return null;
  const command = new GetObjectCommand({
    Bucket: process.env.B2_BUCKET_NAME,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn: DOWNLOAD_URL_TTL });
}
