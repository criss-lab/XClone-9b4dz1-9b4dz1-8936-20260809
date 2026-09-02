import { supabase } from './supabase';

/**
 * Single client-side gateway for server-side work.
 * Secrets and third-party credentials must never be placed in VITE_* variables.
 */
export async function invokeEdge<TResponse = unknown, TBody = Record<string, unknown>>(
  functionName: string,
  body?: TBody,
): Promise<TResponse> {
  const { data, error } = await supabase.functions.invoke(functionName, {
    body: body ?? {},
  });

  if (error) {
    let message = error.message || `Edge Function ${functionName} failed`;
    if ('context' in error && error.context instanceof Response) {
      try {
        const payload = await error.context.clone().json();
        message = payload?.error || payload?.message || message;
      } catch {
        // Keep the original SDK error when the response is not JSON.
      }
    }
    throw new Error(message);
  }

  return data as TResponse;
}
