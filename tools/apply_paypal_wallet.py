from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path: str, replacements: list[tuple[str, str]]) -> bool:
    p = ROOT / path
    text = p.read_text()
    original = text
    for old, new in replacements:
        if old in text and new not in text:
            text = text.replace(old, new, 1)
    if text != original:
        p.write_text(text)
        print(f'patched {path}')
        return True
    return False

changed = False
changed |= patch('src/pages/ProfilePage.tsx', [
    ("import { ProductionEditProfileDialog } from '@/components/features/ProductionEditProfileDialog';", "import { ProductionEditProfileDialog } from '@/components/features/ProductionEditProfileDialog';\nimport { WalletCard } from '@/components/features/WalletCard';"),
    ("      <div className=\"sticky top-0 z-20 border-y border-border bg-background/95 backdrop-blur flex overflow-x-auto\">", "      {isOwn && <WalletCard username={profile.username} />}\n\n      <div className=\"sticky top-0 z-20 border-y border-border bg-background/95 backdrop-blur flex overflow-x-auto\">")
]) or changed

changed |= patch('src/components/features/WalletDashboard.tsx', [
    ("import { FunctionsHttpError } from '@supabase/supabase-js';", "import { FunctionsHttpError } from '@supabase/supabase-js';\nimport { PayPalWalletPanel } from '@/components/features/PayPalWalletPanel';"),
    ("      {/* ── Balance Card ── */}", "      <PayPalWalletPanel />\n\n      {/* ── Balance Card ── */")
]) or changed

if not changed:
    print('PayPal wallet UI already patched')
