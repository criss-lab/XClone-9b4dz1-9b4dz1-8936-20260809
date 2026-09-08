import { LegacyWalletDashboard } from './WalletDashboardLegacy';
import { PayPalWalletActions } from './PayPalWalletActions';
import { useWallet } from '@/hooks/useWallet';

export function WalletDashboard() {
  const { wallet, refresh } = useWallet();
  return (
    <div className="space-y-6">
      <LegacyWalletDashboard />
      {wallet && <PayPalWalletActions wallet={wallet} refresh={refresh} />}
    </div>
  );
}
