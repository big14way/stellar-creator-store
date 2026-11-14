// Fee sponsor. The browser signs a call with the buyer's passkey and posts
// { func, auth } here; this server wraps it in a transaction whose fee is paid
// by our sponsor account. The buyer's wallet needs no XLM.
//
// The sponsor signs only as the transaction source (the fee). It sponsors two
// things: deploying a passkey wallet from the approved wallet code, and `buy`
// on our store by a smart wallet. Anything that would make the sponsor
// authorize a call itself is refused.

import { serve } from "@hono/node-server";
import { BASE_FEE, Keypair, Operation, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { Hono } from "hono";
import { NETWORK_PASSPHRASE, RPC_URL, STORE_ID } from "../src/config";
import { decode, refusal, type Decoded } from "./policy";

const PORT = Number(process.env.RELAYER_PORT ?? 8790);
// Most a single sponsored transaction may cost us in resource fees: 0.5 XLM.
const MAX_RESOURCE_FEE = 5_000_000;

const secret = process.env.SPONSOR_SECRET;
if (!secret) {
  console.error("SPONSOR_SECRET is not set");
  process.exit(1);
}
const sponsor = Keypair.fromSecret(secret);
const server = new rpc.Server(RPC_URL);

async function submit({ func, auth }: Decoded) {
  const source = await server.getAccount(sponsor.publicKey());
  const draft = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.invokeHostFunction({ func, auth }))
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(draft);
  if (rpc.Api.isSimulationError(sim)) return { ok: false as const, error: `simulation failed: ${sim.error}` };
  if (rpc.Api.isSimulationRestore(sim)) return { ok: false as const, error: "ledger entries need restoring first" };
  if (Number(sim.minResourceFee) > MAX_RESOURCE_FEE) {
    return { ok: false as const, error: `resource fee ${sim.minResourceFee} is above the sponsor's cap` };
  }

  const tx = rpc.assembleTransaction(draft, sim).build();
  // assembleTransaction must not have swapped in simulated (source-account) auth.
  const op = tx.operations[0] as Operation.InvokeHostFunction;
  const finalAuth = op.auth ?? [];
  if (finalAuth.length !== auth.length || finalAuth.some((a, i) => a.toXDR("base64") !== auth[i].toXDR("base64"))) {
    return { ok: false as const, error: "authorization changed during assembly" };
  }

  tx.sign(sponsor);
  const sent = await server.sendTransaction(tx);
  if (sent.status !== "PENDING") {
    return { ok: false as const, error: `rejected by the network: ${sent.status}`, hash: sent.hash };
  }
  const done = await server.pollTransaction(sent.hash, { attempts: 30, sleepStrategy: () => 1000 });
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    return { ok: false as const, error: `transaction ${done.status}`, hash: sent.hash };
  }
  return { ok: true as const, hash: sent.hash };
}

const app = new Hono();

app.get("/api/relay/info", (c) => c.json({ sponsor: sponsor.publicKey(), store: STORE_ID }));

app.post("/api/relay", async (c) => {
  const decoded = decode(await c.req.json().catch(() => null));
  if (typeof decoded === "string") return c.json({ success: false, error: decoded }, 400);

  const why = refusal(decoded, sponsor.publicKey());
  if (why) return c.json({ success: false, error: why }, 403);

  try {
    const result = await submit(decoded);
    if (!result.ok) return c.json({ success: false, error: result.error, hash: result.hash }, 422);
    return c.json({ success: true, hash: result.hash, status: "SUCCESS" });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, () => {
  console.log(`relayer on http://127.0.0.1:${PORT}, sponsor ${sponsor.publicKey()}`);
});
