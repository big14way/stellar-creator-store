// Wraps a signed call in a transaction whose fee our sponsor account pays.
// The sponsor signs only as the transaction source; `policy.ts` decides what
// it will pay for.

import { BASE_FEE, Keypair, Operation, TransactionBuilder, rpc, type Transaction, type xdr } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, RPC_URL } from "../src/config";
import { MAX_RESOURCE_FEE, type Decoded } from "./policy";

export type Submitted =
  | { ok: true; hash: string; ledger: number; returnValue?: xdr.ScVal }
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
    if (BigInt(sim.minResourceFee) > MAX_RESOURCE_FEE) {
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
    return send(tx);
  }

  /**
   * Pays the fee for a transaction a classic Stellar wallet signed as its
   * own source, by wrapping it in a fee-bump transaction. `policy.ts`
   * decides which transactions qualify.
   */
  async function feeBump(inner: Transaction): Promise<Submitted> {
    const sim = await server.simulateTransaction(inner);
    if (rpc.Api.isSimulationError(sim)) return { ok: false, error: `simulation failed: ${sim.error}` };
    const outer = TransactionBuilder.buildFeeBumpTransaction(keypair, BASE_FEE, inner, NETWORK_PASSPHRASE);
    outer.sign(keypair);
    return send(outer);
  }

  async function send(tx: Parameters<rpc.Server["sendTransaction"]>[0]): Promise<Submitted> {
    const sent = await server.sendTransaction(tx);
    if (sent.status !== "PENDING") return { ok: false, error: `rejected by the network: ${sent.status}`, hash: sent.hash };
    const done = await server.pollTransaction(sent.hash, { attempts: 30, sleepStrategy: () => 1000 });
    if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      return { ok: false, error: `transaction ${done.status}`, hash: sent.hash };
    }
    return { ok: true, hash: sent.hash, ledger: done.ledger, returnValue: done.returnValue };
  }

  return { address: keypair.publicKey(), submit, feeBump };
}
