import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getKit } from "./wallet";

type WalletState = {
  wallet: string | null;
  /** True until the stored session has been checked. */
  restoring: boolean;
  create: (label?: string) => Promise<string>;
  signIn: () => Promise<string | null>;
  signOut: () => Promise<void>;
};

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    getKit()
      .connectWallet()
      .then((r) => setWallet(r?.contractId ?? null))
      .catch(() => setWallet(null))
      .finally(() => setRestoring(false));
  }, []);

  const create = useCallback(async (label?: string) => {
    const { contractId } = await getKit().createWallet("Creator Store", label || "Creator Store wallet", { autoSubmit: true });
    setWallet(contractId);
    return contractId;
  }, []);

  const signIn = useCallback(async () => {
    const r = await getKit().connectWallet({ prompt: true });
    setWallet(r?.contractId ?? null);
    return r?.contractId ?? null;
  }, []);

  const signOut = useCallback(async () => {
    await getKit().disconnect();
    setWallet(null);
  }, []);

  return <WalletContext.Provider value={{ wallet, restoring, create, signIn, signOut }}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet outside WalletProvider");
  return ctx;
}

export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
