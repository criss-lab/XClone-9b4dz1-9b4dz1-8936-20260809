import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function enforceRateLimit(
  supabaseAdmin: ReturnType<typeof createClient>,
  bucket: string,
  limit: number,
  windowSeconds = 60,
): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc('consume_rate_limit', {
    p_bucket_key: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error(`Rate limiter unavailable: ${error.message}`);
  if (data !== true) {
    throw new Error('Too many requests. Please try again later.');
  }
}
