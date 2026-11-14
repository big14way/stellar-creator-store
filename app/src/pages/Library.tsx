import { Download, Fingerprint, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { api, fileSize, type LibraryItem } from "../api";
import { formatUsdc } from "../chain";
import { explorerTx, Eyebrow, Receipt, Status, TagButton } from "../ui";
import { short, useWallet } from "../useWallet";
import { stellarSignIn } from "../stellarWallet";

/** Everything bought with the wallets this browser has signed in with, on any device. */
export function Library() {
  const { restoring, signIn, connectStellar, refreshProven } = useWallet();
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [wallets, setWallets] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const lib = await api.library();
    setItems(lib.items);
    setWallets(lib.wallets);
  }, []);

  useEffect(() => {
    if (!restoring) load().catch((e) => setError(String(e)));
  }, [restoring, load]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await refreshProven();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const signInOptions = (
    <div className="actions">
      <TagButton onClick={() => run("Confirm with your passkey", signIn)} disabled={!!busy} icon={<Fingerprint size={16} />}>
        Sign in with a passkey
      </TagButton>
      <button
        className="ghost"
        disabled={!!busy}
        onClick={() =>
          run("Approve the sign-in in your wallet", async () => {
            const address = await connectStellar();
            if (address) await stellarSignIn(address);
          })
        }
      >
        <Wallet size={14} /> Stellar wallet
      </button>
    </div>
  );

  return (
    <>
      <section className="band dark lined tight">
        <div className="container">
          <Eyebrow>Library</Eyebrow>
          <h1>Your purchases.</h1>
          <p className="lead">
            Everything you bought, on any device. Sign in with the passkey or Stellar wallet you paid with; each receipt
            is checked on chain before the download unlocks.
          </p>
          {wallets.length > 0 && (
            <p className="hint mono" style={{ marginTop: 18 }}>
              Signed in as {wallets.map(short).join(", ")}
            </p>
          )}
        </div>
      </section>

      <section className="band cream tight">
        <div className="container">
          {items === null ? (
            <Status>Loading your library</Status>
          ) : items.length === 0 ? (
            <div className="empty">
              <p>{wallets.length ? "Nothing bought with these wallets yet." : "Sign in to see what you bought."}</p>
              {signInOptions}
              {wallets.length > 0 && (
                <Link href="/#shelf" className="text-link">
                  Browse the shelf
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="library" data-testid="library">
                {items.map((item) => (
                  <Receipt key={`${item.productId}:${item.buyer}`} className="library-item">
                    <div className="receipt-head">
                      <span>{new Date(item.at).toLocaleDateString()}</span>
                      <a className="verified" href={explorerTx(item.txHash)} target="_blank" rel="noreferrer">
                        Verified on Stellar
                      </a>
                    </div>
                    <Link href={`/p/${item.productId}`} className="receipt-title">
                      {item.title}
                    </Link>
                    <p className="mono muted">
                      {item.file.name} · {fileSize(item.file.size)}
                      {item.paid ? ` · paid $${formatUsdc(BigInt(item.paid))}` : ""} · {short(item.buyer)}
                    </p>
                    <a className="tag" href={item.download} data-testid="library-download">
                      Download
                      <span className="tile" aria-hidden="true">
                        <Download size={16} />
                      </span>
                    </a>
                  </Receipt>
                ))}
              </div>
              <div style={{ marginTop: 32 }}>
                <p className="hint">Bought with another wallet? Sign in with it too.</p>
                {signInOptions}
              </div>
            </>
          )}
          {busy && <Status>{busy}</Status>}
          {error && (
            <p className="error" data-testid="error">
              {error}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
