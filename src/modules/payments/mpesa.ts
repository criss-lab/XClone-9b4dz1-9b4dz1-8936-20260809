import { invokeEdge } from '@/lib/edge';
import { MpesaConfig, PaymentResponse } from './types';

/**
 * Client facade for M-Pesa. The config is retained for API compatibility, but
 * credentials are deliberately ignored here: all M-Pesa secrets belong in
 * Supabase Edge Function secrets.
 */
export class MpesaService {
  constructor(_config?: MpesaConfig) {}

  public async stkPush(phone: string, amount: number): Promise<PaymentResponse> {
    try {
      if (!phone?.trim()) throw new Error('Phone number is required');
      if (!Number.isFinite(amount) || amount < 1) {
        throw new Error('Amount must be at least KES 1');
      }

      const data = await invokeEdge<{
        success?: boolean;
        checkout_request_id?: string;
        merchant_request_id?: string;
        customer_message?: string;
        response_description?: string;
        error?: string;
      }>('mpesa-stk-push', {
        phone: phone.trim(),
        amount: Math.ceil(amount),
        purpose: 'wallet_topup',
      });

      return {
        success: data?.success === true,
        data,
        message: data?.error ?? data?.customer_message,
      };
    } catch (error: unknown) {
      return {
        success: false,
        data: null,
        message: error instanceof Error ? error.message : 'M-Pesa request failed',
      };
    }
  }
}
