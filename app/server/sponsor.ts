// Wraps a signed call in a transaction whose fee our sponsor account pays.
// The sponsor signs only as the transaction source; `policy.ts` decides what
// it will pay for.

import { BASE_FEE, Keypair, Operation, TransactionBuilder, rpc, type xdr } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, RPC_URL } from "../src/config";
import type { Decoded } from "./policy";

// Most a single sponsored transaction may cost us in resource fees: 0.5 XLM.
const MAX_RESOURCE_FEE = 5_000_000;

export type Submitted =
  | { ok: true; hash: string; returnValue?: xdr.ScVal }
  | { ok: false; error: string; hash?: string };

export function sponsor(secret: string) {
  const keypair = Keypair.fromSecret(secret);
  const server = new rpc.Server(RPC_URL);

  async function submit({ func, auth }: Decoded): Promise<Submitted> {
    const source = await server.getAccount(keypair.publicKey());
    const draft = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(Operation.invokeHostFunction({ func, auth }))
      .setTimeout(60)
      .build();

    const sim = await server.simulateTransaction(draft);
    if (rpc.Api.isSimulationError(sim)) return { ok: false, error: `simulation failed: ${sim.error}` };
    if (rpc.Api.isSimulationRestore(sim)) return { ok: false, error: "ledger entries need restoring first" };
    if (Number(sim.minResourceFee) > MAX_RESOURCE_FEE) {
      return { ok: false, error: `resource fee ${sim.minResourceFee} is above the sponsor's cap` };
    }

    const tx = rpc.assembleTransaction(draft, sim).build();
    // assembleTransaction must not have swapped in simulated (source-account) auth.
    const op = tx.operations[0] as Operation.InvokeHostFunction;
    const finalAuth = op.auth ?? [];
    if (finalAuth.length !== auth.length || finalAuth.some((a, i) => a.toXDR("base64") !== auth[i].toXDR("base64"))) {
      return { ok: false, error: "authorization changed during assembly" };
    }

    tx.sign(keypair);
    const sent = await server.sendTransaction(tx);
    if (sent.status !== "PENDING") return { ok: false, error: `rejected by the network: ${sent.status}`, hash: sent.hash };
    const done = await server.pollTransaction(sent.hash, { attempts: 30, sleepStrategy: () => 1000 });
    if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      return { ok: false, error: `transaction ${done.status}`, hash: sent.hash };
    }
    return { ok: true, hash: sent.hash, returnValue: done.returnValue };
  }

  return { address: keypair.publicKey(), submit };
}
