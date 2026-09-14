import { Loader2, Wallet as WalletIcon } from 'lucide-react';
import { WalletDashboard as LegacyWalletDashboard } from './WalletDashboardLegacy';
import { PayPalWalletActions } from './PayPalWalletActions';
import { MpesaWalletActions } from './MpesaWalletActions';
import { useWallet } from '@/hooks/useWallet';

export function WalletDashboard() {
  const { wallet, loading, refresh } = useWallet();

  // The wallet is created asynchronously. Never mount wallet-dependent
  // children while the wallet object is null; several legacy panels require
  // wallet.id during their initial render.
  if (loading) {
    return (
      <div className="flex items-center justify-center p-10" role="status" aria-label="Loading wallet">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!wallet) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-10 text-center border border-border rounded-2xl">
        <WalletIcon className="w-10 h-10 text-muted-foreground" />
        <div>
          <p className="font-semibold">Wallet is not available yet</p>
          <p className="text-sm text-muted-foreground">Please refresh in a moment while your wallet is initialized.</p>
        </div>
        <button onClick={() => void refresh()} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold">
          Retry wallet
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <LegacyWalletDashboard />
      <div className="flex items-center gap-2 text-sm font-bold">
        <span className="h-px flex-1 bg-border" />
        <span>Wallet funding & withdrawals</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <PayPalWalletActions wallet={wallet} refresh={refresh} />
      <MpesaWalletActions wallet={wallet} refresh={refresh} />
    </div>
  );
}
