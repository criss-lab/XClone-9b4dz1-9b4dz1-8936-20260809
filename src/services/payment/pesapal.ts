import { invokeEdge } from '@/lib/edge';

interface PesapalPaymentResponse {
  redirect_url?: string;
  [key: string]: unknown;
}

/**
 * Creates a Pesapal order through the Supabase Edge Function.
 * Credentials stay server-side in Edge Function secrets.
 */
export async function createPesapalPayment(
  amount: number,
  email: string,
  phone: string,
): Promise<PesapalPaymentResponse> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Payment amount must be greater than zero');
  }
  if (!email?.trim()) throw new Error('Email is required');
  if (!phone?.trim()) throw new Error('Phone number is required');

  return invokeEdge<PesapalPaymentResponse>('pesapal-create-order', {
    amount,
    email: email.trim(),
    phone: phone.trim(),
  });
}
