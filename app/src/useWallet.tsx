import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { stellarWallets } from "./stellarWallet";
import { getKit, passkeySignIn } from "./wallet";

type WalletState = {
  /** The passkey wallet (C...) connected in this browser. */
  wallet: string | null;
  /** A Stellar wallet (G...) connected through Freighter, LOBSTR, xBull and others. */
  stellar: string | null;
  /** True until the stored session has been checked. */
  restoring: boolean;
  /** Wallets the server knows this browser controls (for downloads and edits). */
  proven: string[];
  create: (label?: string) => Promise<string>;
  /** Passkey sign-in on this or any other device. */
  signIn: () => Promise<string>;
  signOut: () => Promise<void>;
  /** Makes sure the server knows this browser controls `wallet`, asking for the passkey if needed. */
  ensureProven: (wallet: string) => Promise<void>;
  refreshProven: () => Promise<string[]>;
  connectStellar: () => Promise<string | null>;
  disconnectStellar: () => void;
};

const WalletContext = createContext<WalletState | null>(null);

async function me(): Promise<string[]> {
  const res = await fetch("/api/me");
  return res.ok ? ((await res.json()) as { wallets: string[] }).wallets : [];
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<string | null>(null);
  const [stellar, setStellar] = useState<string | null>(stellarWallets.remembered());
  const [restoring, setRestoring] = useState(true);
  const [proven, setProven] = useState<string[]>([]);

  const refreshProven = useCallback(async (): Promise<string[]> => {
    const wallets = await me().catch((): string[] => []);
    setProven(wallets);
    return wallets;
  }, []);

  useEffect(() => {
    Promise.all([
      getKit()
        .connectWallet()
        .then((r) => setWallet(r?.contractId ?? null))
        .catch(() => setWallet(null)),
      refreshProven(),
    ]).finally(() => setRestoring(false));
  }, [refreshProven]);

  const create = useCallback(async (label?: string) => {
    const { contractId } = await getKit().createWallet("Paperstall", label || "Paperstall wallet", { autoSubmit: true });
    setWallet(contractId);
    return contractId;
  }, []);

  const signIn = useCallback(async () => {
    const w = await passkeySignIn();
    setWallet(w);
    await refreshProven();
    return w;
  }, [refreshProven]);

  const ensureProven = useCallback(
    async (w: string) => {
      if ((await refreshProven()).includes(w)) return;
      const signedIn = await passkeySignIn();
      await refreshProven();
      if (signedIn !== w) throw new Error("That passkey belongs to a different wallet.");
    },
    [refreshProven],
  );

  const disconnectStellar = useCallback(() => {
    stellarWallets.forget();
    setStellar(null);
  }, []);

  const signOut = useCallback(async () => {
    await getKit().disconnect();
    await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => {});
    disconnectStellar();
    setWallet(null);
    setProven([]);
  }, [disconnectStellar]);

  const connectStellar = useCallback(async () => {
    const address = await stellarWallets.connect();
    setStellar(address);
    return address;
  }, []);

  return (
    <WalletContext.Provider
      value={{
        wallet,
        stellar,
        restoring,
        proven,
        create,
        signIn,
        signOut,
        ensureProven,
        refreshProven,
        connectStellar,
        disconnectStellar,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet outside WalletProvider");
  return ctx;
}

export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
