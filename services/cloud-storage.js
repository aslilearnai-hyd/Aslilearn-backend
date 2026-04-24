import fs from 'fs/promises';
import path from 'path';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const STORAGE_PROVIDER = String(process.env.CLOUD_STORAGE_PROVIDER || 'local').toLowerCase();

function buildS3Client() {
  const region = process.env.AWS_REGION || process.env.SPACES_REGION || 'us-east-1';
  const endpoint = process.env.S3_ENDPOINT || process.env.SPACES_ENDPOINT;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.SPACES_KEY;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.SPACES_SECRET;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Missing S3/Spaces credentials');
  }
  return new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle: !!endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucket() {
  const bucket = process.env.S3_BUCKET || process.env.SPACES_BUCKET;
  if (!bucket) throw new Error('Missing S3_BUCKET/SPACES_BUCKET');
  return bucket;
}

function getPublicBaseUrl() {
  return process.env.S3_PUBLIC_BASE_URL || process.env.SPACES_PUBLIC_BASE_URL || '';
}

export async function uploadPdfToConfiguredStorage({
  localPath,
  originalName,
  mimeType,
}) {
  const fileBuffer = await fs.readFile(localPath);
  const ext = path.extname(originalName || '').toLowerCase() || '.pdf';
  const key = `pdf-knowledge/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

  if (STORAGE_PROVIDER === 's3' || STORAGE_PROVIDER === 'spaces') {
    const client = buildS3Client();
    const bucket = getBucket();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fileBuffer,
        ContentType: mimeType || 'application/pdf',
      })
    );
    const base = getPublicBaseUrl();
    const fileUrl = base ? `${base.replace(/\/+$/, '')}/${key}` : `s3://${bucket}/${key}`;
    return {
      fileName: path.basename(key),
      fileUrl,
      storageProvider: STORAGE_PROVIDER,
      storageKey: key,
      shouldDeleteLocal: true,
    };
  }

  return {
    fileName: path.basename(localPath),
    fileUrl: `/uploads/pdf-knowledge/${path.basename(localPath)}`,
    storageProvider: 'local',
    storageKey: '',
    shouldDeleteLocal: false,
  };
}

export async function deleteFromConfiguredStorage({ storageKey, fileUrl, storageProvider }) {
  const provider = String(storageProvider || STORAGE_PROVIDER).toLowerCase();
  if ((provider === 's3' || provider === 'spaces') && storageKey) {
    const client = buildS3Client();
    const bucket = getBucket();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }));
    return;
  }

  if (fileUrl && fileUrl.startsWith('/uploads/')) {
    const localPath = path.resolve(process.cwd(), fileUrl.replace(/^\//, ''));
    await fs.rm(localPath, { force: true });
  }
}

async function streamToBuffer(stream) {
  const chunks = [];
  // eslint-disable-next-line no-restricted-syntax
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function getPdfBufferFromStorage({ storageProvider, storageKey, fileUrl }) {
  const provider = String(storageProvider || STORAGE_PROVIDER).toLowerCase();
  if ((provider === 's3' || provider === 'spaces') && storageKey) {
    const client = buildS3Client();
    const bucket = getBucket();
    const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
    return streamToBuffer(resp.Body);
  }
  const localPath = path.resolve(process.cwd(), String(fileUrl || '').replace(/^\//, ''));
  return fs.readFile(localPath);
}

