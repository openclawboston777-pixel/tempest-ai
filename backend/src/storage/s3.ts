import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { config } from "../config.js";
import { logger } from "../logger.js";

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: config.awsRegion,
      credentials: {
        accessKeyId: config.awsAccessKeyId!,
        secretAccessKey: config.awsSecretAccessKey!,
      },
    });
  }
  return client;
}

export async function putObject(
  key: string,
  body: Buffer | string,
  contentType: string
): Promise<void> {
  if (!config.storageEnabled) {
    logger.debug({ key }, "s3 storage disabled — skipping putObject");
    return;
  }
  try {
    await getClient().send(
      new PutObjectCommand({
        Bucket: config.s3Bucket!,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
    logger.info({ key }, "stored object in s3");
  } catch (err) {
    logger.error({ err, key }, "failed to store object in s3");
  }
}

export function dateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function sanitizeId(id: string): string {
  return String(id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}
