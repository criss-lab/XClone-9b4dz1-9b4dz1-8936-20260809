/**
 * Minimal compatibility type for legacy code that still imports
 * FunctionsHttpError from the Supabase SDK. The application runtime is
 * Cloudflare-native; this class carries only the HTTP error/context contract
 * needed by those legacy callers and performs no Supabase SDK/network work.
 */
export class FunctionsHttpError extends Error {
  readonly name = 'FunctionsHttpError';
  readonly context?: Response;

  constructor(message: string, context?: Response) {
    super(message);
    this.context = context;
    Object.setPrototypeOf(this, FunctionsHttpError.prototype);
  }
}
