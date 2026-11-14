import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { api } from "../api";
import { formatUsdc, parseUsdc, read } from "../chain";
import { STORE_ID } from "../config";
import { useWallet } from "../useWallet";
import { callStore } from "../wallet";

type CoCreator = { to: string; pct: string };

function useStoreFee(): number | null {
  const [fee, setFee] = useState<number | null>(null);
  useEffect(() => {
    read<{ fee_bps: number }>(STORE_ID, "config")
      .then((c) => setFee(c.fee_bps))
      .catch(() => setFee(null));
  }, []);
  return fee;
}

const pctToBps = (pct: string) => Math.round(Number(pct || 0) * 100);

export function Sell() {
  const { wallet, restoring, create, signIn } = useWallet();
  const [, navigate] = useLocation();
  const feeBps = useStoreFee();
  const [price, setPrice] = useState("5");
  const [affiliatePct, setAffiliatePct] = useState("10");
  const [coCreators, setCoCreators] = useState<CoCreator[]>([]);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  let priceUnits: bigint | null = null;
  try {
    priceUnits = parseUsdc(price);
  } catch {
    priceUnits = null;
  }
  const coBps = coCreators.reduce((sum, c) => sum + pctToBps(c.pct), 0);
  const affBps = pctToBps(affiliatePct);
  const cut = (bps: number) => (priceUnits ? (priceUnits * BigInt(bps)) / 10_000n : 0n);
  const youGet = priceUnits && feeBps !== null ? priceUnits - cut(feeBps) - cut(coBps) : null;

  async function start(kind: "create" | "signin") {
    setError(null);
    try {
      setStep(kind === "create" ? "Creating your wallet…" : "Signing in…");
      if (kind === "create") await create("Creator");
      else await signIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStep(null);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!wallet || !priceUnits) return;
    setError(null);
    const form = new FormData(e.currentTarget);
    form.set("creator", wallet);
    try {
      setStep("Uploading your file…");
      const { draftId } = await api.draft(form);
      setStep("Confirm with your passkey to list it…");
      const shares = coCreators.filter((c) => c.to.trim()).map((c) => ({ to: c.to.trim(), bps: pctToBps(c.pct) }));
      const { result } = await callStore("create_product", {
        creator: wallet,
        price: priceUnits,
        shares,
        affiliate_bps: affBps,
      });
      const productId = Number(result);
      if (!Number.isSafeInteger(productId) || productId < 1) throw new Error("Listing did not return a product id");
      setStep("Publishing…");
      await api.publish(draftId, productId);
      navigate(`/p/${productId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep(null);
    }
  }

  if (restoring) return <p className="muted">Loading…</p>;

  if (!wallet) {
    return (
      <section className="narrow">
        <h1>Start selling</h1>
        <p>
          Your store wallet is secured by a passkey: your fingerprint or face. No seed phrase, and you never need XLM
          for fees. Sales land in it as USDC.
        </p>
        <div className="row">
          <button className="button primary" onClick={() => start("create")} disabled={!!step}>
            Create my wallet
          </button>
          <button className="button" onClick={() => start("signin")} disabled={!!step}>
            I already have one
          </button>
        </div>
        {step && <p className="muted">{step}</p>}
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="narrow">
      <h1>List a product</h1>
      <form onSubmit={submit} className="form">
        <label>
          Title
          <input name="title" required maxLength={120} placeholder="Lagos Nights beat pack" />
        </label>
        <label>
          Description
          <textarea name="description" rows={5} maxLength={5000} placeholder="What buyers get, and who it's for" />
        </label>
        <label>
          File buyers download <span className="muted">(up to 50 MB)</span>
          <input name="file" type="file" required />
        </label>
        <label>
          Cover image <span className="muted">(optional)</span>
          <input name="cover" type="file" accept="image/*" />
        </label>
        <label>
          Price in USDC
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" required />
        </label>
        <label>
          Affiliate share, %
          <input value={affiliatePct} onChange={(e) => setAffiliatePct(e.target.value)} inputMode="decimal" />
          <span className="hint">Paid to whoever shares the link that brought the buyer. 0 turns affiliates off.</span>
        </label>

        <fieldset>
          <legend>Co-creators</legend>
          {coCreators.map((c, i) => (
            <div className="row" key={i}>
              <input
                placeholder="Wallet address (C… or G…)"
                value={c.to}
                onChange={(e) => setCoCreators(coCreators.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}
              />
              <input
                className="pct"
                placeholder="%"
                value={c.pct}
                onChange={(e) => setCoCreators(coCreators.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))}
              />
              <button type="button" className="link-button" onClick={() => setCoCreators(coCreators.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          {coCreators.length < 5 && (
            <button type="button" className="link-button" onClick={() => setCoCreators([...coCreators, { to: "", pct: "" }])}>
              + Add a co-creator
            </button>
          )}
          <span className="hint">Each co-creator is paid their share of every sale automatically. Shares can't change after listing.</span>
        </fieldset>

        {priceUnits && feeBps !== null && (
          <div className="split" data-testid="split">
            <div>
              Buyer pays <strong>${formatUsdc(priceUnits)}</strong>
            </div>
            <div>
              Platform fee {feeBps / 100}%: ${formatUsdc(cut(feeBps))}
            </div>
            {coBps > 0 && <div>Co-creators {coBps / 100}%: ${formatUsdc(cut(coBps))}</div>}
            {affBps > 0 && <div>Affiliate {affBps / 100}%, only when someone refers the buyer: ${formatUsdc(cut(affBps))}</div>}
            {youGet !== null && (
              <div>
                You get <strong>${formatUsdc(youGet)}</strong>
                {affBps > 0 && <> per sale, or ${formatUsdc(youGet - cut(affBps))} on a referred sale</>}
              </div>
            )}
          </div>
        )}

        <button className="button primary" type="submit" disabled={!!step || !priceUnits}>
          List it
        </button>
        {step && <p className="muted" data-testid="step">{step}</p>}
        {error && <p className="error" data-testid="error">{error}</p>}
      </form>
    </section>
  );
}
