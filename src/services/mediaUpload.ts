import { supabase } from '@/lib/supabase';

const PART_CONCURRENCY = 4;

type MediaType = 'image' | 'video' | 'audio' | 'document';
type Session = { assetId: string; key: string; uploadId: string; partSize: number; partCount: number };

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('media-upload', { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function uploadMediaToR2(file: File, mediaType: MediaType) {
  const session = await invoke({
    action: 'create',
    filename: file.name,
    contentType: file.type || 'application/octet-stream',
    size: file.size,
    mediaType,
  }) as Session;

  const partNumbers = Array.from({ length: session.partCount }, (_, i) => i + 1);
  try {
    const uploaded = await mapConcurrent(partNumbers, PART_CONCURRENCY, async (partNumber) => {
      const signed = await invoke({ action: 'sign-part', key: session.key, uploadId: session.uploadId, partNumber }) as { url: string; partNumber: number };
      const start = (partNumber - 1) * session.partSize;
      const end = Math.min(start + session.partSize, file.size);
      const response = await fetch(signed.url, {
        method: 'PUT',
        body: file.slice(start, end),
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      if (!response.ok) throw new Error(`R2 part ${partNumber} failed (${response.status})`);
      const etag = response.headers.get('ETag');
      if (!etag) throw new Error(`R2 part ${partNumber} did not return an ETag`);
      return { PartNumber: partNumber, ETag: etag };
    });

    return await invoke({
      action: 'complete',
      key: session.key,
      uploadId: session.uploadId,
      parts: uploaded,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
      mediaType,
    });
  } catch (error) {
    await invoke({ action: 'abort', key: session.key, uploadId: session.uploadId }).catch(() => undefined);
    throw error;
  }
}
