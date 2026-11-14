import { Fingerprint, Plus, Tag, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { api, type Config } from "../api";
import { formatUsdc, parseUsdc, read } from "../chain";
import { STORE_ID } from "../config";
import { Eyebrow, Receipt, Spec, Status, TagButton } from "../ui";
import { short, useWallet } from "../useWallet";
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
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => {
    api.config().then(setConfig).catch(() => {});
  }, []);
  const maxMb = config?.maxFileMb ?? 50;
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("5");
  const [affiliatePct, setAffiliatePct] = useState("10");
  const [coCreators, setCoCreators] = useState<CoCreator[]>([]);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  let priceUnits: bigint | null = null;
  try {
    priceUnits = parseUsdc(price);
    if (priceUnits <= 0n) priceUnits = null;
  } catch {
    priceUnits = null;
  }
  const coBps = coCreators.reduce((sum, c) => sum + pctToBps(c.pct), 0);
  const affBps = pctToBps(affiliatePct);
  const cut = (bps: number) => (priceUnits ? (priceUnits * BigInt(bps)) / 10_000n : 0n);
  const youGet = priceUnits && feeBps !== null ? priceUnits - cut(feeBps) - cut(coBps) : null;
  const overHundred = feeBps !== null && feeBps + coBps + affBps > 10_000;

  async function start(kind: "create" | "signin") {
    setError(null);
    try {
      setStep(kind === "create" ? "Creating your wallet with a passkey" : "Signing in");
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
      setStep("Uploading your file");
      const { draftId } = await api.draft(form);
      setStep("Confirm with your passkey to list it");
      const shares = coCreators.filter((c) => c.to.trim()).map((c) => ({ to: c.to.trim(), bps: pctToBps(c.pct) }));
      const { result } = await callStore("create_product", {
        creator: wallet,
        price: priceUnits,
        shares,
        affiliate_bps: affBps,
      });
      const productId = Number(result);
      if (!Number.isSafeInteger(productId) || productId < 1) throw new Error("Listing did not return a product id");
      setStep("Putting it on the shelf");
      await api.publish(draftId, productId);
      navigate(`/p/${productId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep(null);
    }
  }

  if (restoring) {
    return (
      <section className="band dark">
        <div className="container">
          <Status>Loading</Status>
        </div>
      </section>
    );
  }

  if (!wallet) {
    return (
      <section className="band dark lined hero">
        <div className="container two-col">
          <div>
            <Eyebrow>Start selling</Eyebrow>
            <h1 className="display">
              Your store,
              <br />
              <span className="accent">on your fingerprint.</span>
            </h1>
            <p className="lead">
              Your wallet is secured by a passkey, your fingerprint or face. No seed phrase, and you never need XLM for
              fees. Every sale lands in it as USDC.
            </p>
            <div className="actions">
              <TagButton onClick={() => start("create")} disabled={!!step} icon={<Fingerprint size={16} />}>
                Create my wallet
              </TagButton>
              <button className="ghost" onClick={() => start("signin")} disabled={!!step}>
                I already have one
              </button>
            </div>
            <div style={{ marginTop: 18 }}>
              {step && <Status testId="step">{step}</Status>}
              {error && (
                <p className="error" data-testid="error">
                  {error}
                </p>
              )}
            </div>
          </div>
          <Receipt className="tilt">
            <div className="receipt-head">
              <span>What you need</span>
              <span className="verified">2 minutes</span>
            </div>
            <Spec
              rows={[
                { label: "Your file", value: `Up to ${maxMb} MB` },
                { label: "A price", value: "In USDC" },
                { label: "A passkey", value: "Fingerprint or face" },
                { label: "XLM", value: "None" },
                { label: "Seed phrase", value: "None" },
              ]}
            />
          </Receipt>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="band dark lined tight">
        <div className="container">
          <Eyebrow>Sell · wallet {short(wallet)}</Eyebrow>
          <h1>List a product.</h1>
          <p className="lead">Upload the file, set the price and the shares. Your passkey signs the listing.</p>
        </div>
      </section>

      <section className="band cream tight">
        <div className="container sell-layout">
          <form onSubmit={submit} className="form">
            <label>
              Title
              <input name="title" required maxLength={120} placeholder="Lagos Nights beat pack" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              Description
              <textarea name="description" rows={5} maxLength={5000} placeholder="What buyers get, and who it's for" />
            </label>
            <div className="field-row">
              <label>
                File buyers download
                <input name="file" type="file" required />
                <span className="hint">Up to {maxMb} MB. Only buyers can download it.</span>
              </label>
              <label>
                Cover image
                <input name="cover" type="file" accept="image/*" />
                <span className="hint">Optional. Shown on the shelf.</span>
              </label>
            </div>
            <div className="field-row">
              <label>
                Price in USDC
                <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" required />
              </label>
              <label>
                Affiliate share, %
                <input value={affiliatePct} onChange={(e) => setAffiliatePct(e.target.value)} inputMode="decimal" />
                <span className="hint">Paid to whoever shares the link that brought the buyer. 0 turns it off.</span>
              </label>
            </div>

            <fieldset>
              <legend>Co-creators</legend>
              {coCreators.map((c, i) => (
                <div className="co-row" key={i}>
                  <input
                    aria-label={`Co-creator ${i + 1} wallet`}
                    placeholder="Wallet address (C… or G…)"
                    value={c.to}
                    onChange={(e) => setCoCreators(coCreators.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}
                  />
                  <input
                    aria-label={`Co-creator ${i + 1} share, %`}
                    placeholder="%"
                    value={c.pct}
                    onChange={(e) => setCoCreators(coCreators.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))}
                  />
                  <button
                    type="button"
                    className="text-link"
                    aria-label={`Remove co-creator ${i + 1}`}
                    onClick={() => setCoCreators(coCreators.filter((_, j) => j !== i))}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {coCreators.length < 5 && (
                <button type="button" className="text-link" onClick={() => setCoCreators([...coCreators, { to: "", pct: "" }])}>
                  <Plus size={14} /> Add a co-creator
                </button>
              )}
              <span className="hint">Each is paid their share of every sale. Shares can't change after listing.</span>
            </fieldset>

            <div className="actions" style={{ marginTop: 0 }}>
              <TagButton type="submit" disabled={!!step || !priceUnits || overHundred} icon={<Tag size={16} />}>
                List it
              </TagButton>
            </div>
            {step && <Status testId="step">{step}</Status>}
            {error && (
              <p className="error" data-testid="error">
                {error}
              </p>
            )}
          </form>

          <div className="sticky">
            <Receipt>
              <div className="receipt-head">
                <span>{title.trim() || "Your product"}</span>
                <span className="verified">Split preview</span>
              </div>
              {priceUnits && feeBps !== null ? (
                <div data-testid="split">
                  <Spec
                    rows={[
                      { label: "Buyer pays", value: `$${formatUsdc(priceUnits)}` },
                      ...(coBps > 0 ? [{ label: "Co-creators", value: `$${formatUsdc(cut(coBps))}`, note: `${coBps / 100}%` }] : []),
                      ...(affBps > 0
                        ? [{ label: "Affiliate", value: `$${formatUsdc(cut(affBps))}`, note: `${affBps / 100}%, only on referred sales` }]
                        : []),
                      { label: "Platform fee", value: `$${formatUsdc(cut(feeBps))}`, note: `${feeBps / 100}%, fixed at listing` },
                      { label: "Network fee", value: "$0.00", note: "paid by the store" },
                      {
                        label: "You get",
                        value: youGet !== null ? `$${formatUsdc(youGet)}` : "–",
                        note: affBps > 0 && youGet !== null ? `$${formatUsdc(youGet - cut(affBps))} on a referred sale` : undefined,
                        total: true,
                      },
                    ]}
                  />
                  {overHundred && <p className="error" style={{ marginTop: 12 }}>The shares add up to more than 100%.</p>}
                </div>
              ) : (
                <p className="muted">Enter a price to see the split.</p>
              )}
              <div className="receipt-foot">Settled by the contract in the same transaction as each sale</div>
            </Receipt>
          </div>
        </div>
      </section>
    </>
  );
}
