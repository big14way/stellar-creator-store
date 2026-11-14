import { useState } from "react";
import { getKit, buildBuy } from "./wallet";

// First slice of the app: create a passkey wallet, then buy a product from the
// store contract with it. The relayer pays the network fee.

type Status = { kind: "idle" } | { kind: "busy"; what: string } | { kind: "ok"; text: string } | { kind: "error"; text: string };

export function App() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [productId, setProductId] = useState("1");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [saleHash, setSaleHash] = useState<string | null>(null);

  async function createWallet() {
    setStatus({ kind: "busy", what: "Creating your wallet…" });
    try {
      const kit = getKit();
      const { contractId } = await kit.createWallet("Creator Store", "buyer", { autoSubmit: true });
      setWallet(contractId);
      setStatus({ kind: "ok", text: "Wallet ready" });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  }

  async function buy() {
    if (!wallet) return;
    setStatus({ kind: "busy", what: "Paying…" });
    try {
      const tx = await buildBuy(wallet, BigInt(productId));
      const result = await getKit().signAndSubmit(tx);
      if (!result.success) {
        setStatus({ kind: "error", text: `${result.error.code}: ${result.error.message}` });
        return;
      }
      setSaleHash(result.hash ?? null);
      setStatus({ kind: "ok", text: "Paid" });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  }

  const busy = status.kind === "busy";
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 560, margin: "48px auto", padding: "0 16px" }}>
      <h1>Creator Store</h1>
      <p>Pay with a passkey wallet. No seed phrase, no XLM needed.</p>

      <section>
        <button onClick={createWallet} disabled={busy || !!wallet}>
          Create wallet with a passkey
        </button>
        {wallet && (
          <p>
            Wallet: <code data-testid="wallet">{wallet}</code>
          </p>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <label>
          Product{" "}
          <input data-testid="product" value={productId} onChange={(e) => setProductId(e.target.value)} size={6} />
        </label>{" "}
        <button data-testid="buy" onClick={buy} disabled={busy || !wallet}>
          Buy
        </button>
      </section>

      <p data-testid="status" data-kind={status.kind} style={{ marginTop: 24 }}>
        {status.kind === "busy" ? status.what : status.kind === "idle" ? "" : status.text}
      </p>
      {saleHash && (
        <p>
          Sale: <code data-testid="sale">{saleHash}</code>
        </p>
      )}
    </main>
  );
}
