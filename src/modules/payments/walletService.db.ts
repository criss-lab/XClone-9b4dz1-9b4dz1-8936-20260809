import { WalletRepository } from "./walletRepository";

const repo = new WalletRepository();

export async function getWalletBalance(userId: string): Promise<number> {
  const wallet = await repo.getWallet(userId);
  return wallet?.balance || 0;
}

export async function deductFromWallet(userId: string, amount: number, reference?: string) {
  return repo.debit(userId, amount, reference);
}

export async function creditWalletFromMpesa(input: { userId: string; amount: number; receipt?: string; checkoutRequestID?: string }) {
  const reference = input.receipt || input.checkoutRequestID || `mpesa:${input.userId}:${Date.now()}`;
  return repo.credit(input.userId, Number(input.amount), reference);
}

export class WalletServiceDB {
  async creditFromMpesa(userId: string, amount: number, reference: string) {
    return repo.credit(userId, amount, reference);
  }
  async debit(userId: string, amount: number, reference?: string) {
    return repo.debit(userId, amount, reference);
  }
  async getBalance(userId: string) {
    return getWalletBalance(userId);
  }
  async ensureWallet(userId: string) {
    const wallet = await repo.getWallet(userId);
    if (!wallet) return repo.createWallet(userId);
    return wallet;
  }
}
