// Add money to a passkey wallet through a Stellar anchor: the buyer signs in to
// the anchor with their passkey (SEP-45), pays it by bank or card in the
// anchor's own form (SEP-24 deposit), and the anchor sends USDC to the wallet.
// No exchange account and no crypto needed.

import { ExternalLink, Landmark } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { anchorSignIn, anchorTransaction, DEPOSIT_STATUS_TEXT, startDeposit, type AnchorTx } from "./anchor";
import { ANCHOR_DOMAIN, NETWORK } from "./config";
import { explorerTx, Receipt, Status } from "./ui";

type Step = { at: "idle" } | { at: "open"; token: string; id: string; url: string; tx?: AnchorTx };

const DONE = new Set(["completed", "refunded", "expired", "error"]);

/** Whole dollars to ask the anchor for: what's missing, rounded up, within the test anchor's 1 to 10. */
function suggestedAmount(short: bigint | null | undefined): string | undefined {
  if (!short || short <= 0n) return undefined;
  const dollars = Number((short + 9_999_999n) / 10_000_000n);
  return String(NETWORK === "testnet" ? Math.min(10, Math.max(1, dollars)) : dollars);
}

export function AddMoney({ wallet, short, onAdded }: { wallet: string; short?: bigint | null; onAdded: () => void }) {
  const [step, setStep] = useState<Step>({ at: "idle" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const credited = useRef<string | null>(null);
  const added = useRef(onAdded);
  added.current = onAdded;

  // Follow the deposit until the anchor finishes it; refresh the balance once it lands.
  const openId = step.at === "open" ? step.id : null;
  const openToken = step.at === "open" ? step.token : null;
  useEffect(() => {
    if (!openId || !openToken) return;
    let stopped = false;
    const tick = async () => {
      try {
        const tx = await anchorTransaction(openToken, openId);
        if (stopped) return;
        setStep((s) => (s.at === "open" && s.id === tx.id ? { ...s, tx } : s));
        if (tx.status === "completed" && credited.current !== tx.id) {
          credited.current = tx.id;
          added.current();
        }
        if (DONE.has(tx.status)) stopped = true;
      } catch {}
    };
    tick();
    const timer = setInterval(() => !stopped && tick(), 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [openId, openToken]);

  if (!ANCHOR_DOMAIN) return null;

  async function start() {
    setError(null);
    setBusy(`Sign in to ${ANCHOR_DOMAIN} with your passkey`);
    try {
      const token = await anchorSignIn(wallet);
      setBusy("Opening the anchor's form");
      const { id, url } = await startDeposit(token, wallet, suggestedAmount(short));
      setStep({ at: "open", token, id, url });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const tx = step.at === "open" ? step.tx : undefined;

  return (
    <div className="add-money" data-testid="add-money">
      {step.at === "idle" ? (
        <button className="ghost" onClick={start} disabled={!!busy} data-testid="add-money-start">
          <Landmark size={14} /> Add money by bank or card
        </button>
      ) : (
        <Receipt className="anchor-receipt">
          <div className="receipt-head">
            <span>{ANCHOR_DOMAIN}</span>
            <span className="verified" data-testid="add-money-status">
              {tx ? (DEPOSIT_STATUS_TEXT[tx.status] ?? tx.status) : "Opening"}
            </span>
          </div>
          {tx?.status === "completed" ? (
            <p>
              {tx.amount_out ? `$${tx.amount_out} USDC` : "USDC"} is in your wallet.
              {tx.stellar_transaction_id && (
                <>
                  {" "}
                  <a href={explorerTx(tx.stellar_transaction_id)} target="_blank" rel="noreferrer">
                    View the transfer
                  </a>
                </>
              )}
            </p>
          ) : tx && DONE.has(tx.status) ? (
            <p data-testid="add-money-problem">
              {/Error\(Contract, #10\)/.test(tx.message ?? "")
                ? "The anchor took the order but doesn't have enough USDC to send right now. Nothing was charged on Stellar. Try again later."
                : `The anchor stopped this deposit${tx.message ? `: ${tx.message}` : "."}`}
              {tx.more_info_url && (
                <>
                  {" "}
                  <a href={tx.more_info_url} target="_blank" rel="noreferrer">
                    Its receipt
                  </a>
                </>
              )}
            </p>
          ) : (
            <>
              <p>Pay the anchor in its own form, then come back here. This page follows the deposit until the USDC arrives.</p>
              <a className="tag" href={step.url} target="_blank" rel="noreferrer" data-testid="add-money-form">
                Open the anchor's form
                <span className="tile" aria-hidden="true">
                  <ExternalLink size={16} />
                </span>
              </a>
            </>
          )}
          <button className="text-link" onClick={() => setStep({ at: "idle" })}>
            Start over
          </button>
        </Receipt>
      )}
      {busy && <Status>{busy}</Status>}
      {error && <p className="error">{error}</p>}
      <p className="hint">
        A Stellar anchor takes your bank or card payment and sends USDC to this wallet. You sign in to it with your passkey.
        {NETWORK === "testnet" && " On testnet this is Stellar's test anchor: it plays the bank, and the USDC it sends is test money."}
      </p>
    </div>
  );
}
