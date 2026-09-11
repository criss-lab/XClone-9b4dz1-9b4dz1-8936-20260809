import { WalletDashboard as LegacyWalletDashboard } from './WalletDashboardLegacy';
import { PayPalWalletActions } from './PayPalWalletActions';
import { MpesaWalletActions } from './MpesaWalletActions';
import { useWallet } from '@/hooks/useWallet';

export function WalletDashboard() {
  const { wallet, refresh } = useWallet();
  return (
    <div className="space-y-6">
      <LegacyWalletDashboard />
      {wallet && (
        <>
          <div className="flex items-center gap-2 text-sm font-bold">
            <span className="h-px flex-1 bg-border" />
            <span>Wallet funding & withdrawals</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <PayPalWalletActions wallet={wallet} refresh={refresh} />
          <MpesaWalletActions wallet={wallet} refresh={refresh} />
        </>
      )}
    </div>
  );
}
