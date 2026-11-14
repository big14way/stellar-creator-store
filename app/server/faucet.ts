// Testnet only: sends test USDC to a new wallet so anyone can try a purchase.
// The faucet account holds Circle's testnet USDC bought with testnet XLM.

import { BASE_FEE, Contract, Keypair, TransactionBuilder, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { address } from "../src/chain";
import { NETWORK_PASSPHRASE, RPC_URL, USDC_ID } from "../src/config";

export function faucet(secret: string) {
  const keypair = Keypair.fromSecret(secret);
  const server = new rpc.Server(RPC_URL);

  async function send(to: string, amount: bigint): Promise<{ ok: true; hash: string } | { ok: false; error: string }> {
    const source = await server.getAccount(keypair.publicKey());
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(
        new Contract(USDC_ID).call(
          "transfer",
          address(keypair.publicKey()),
          address(to),
          nativeToScVal(amount, { type: "i128" }),
        ),
      )
      .setTimeout(60)
      .build();
    let prepared;
    try {
      prepared = await server.prepareTransaction(tx);
    } catch (err) {
      return { ok: false, error: `faucet could not send: ${err instanceof Error ? err.message : err}` };
    }
    prepared.sign(keypair);
    const sent = await server.sendTransaction(prepared);
    if (sent.status !== "PENDING") return { ok: false, error: `faucet transfer ${sent.status}` };
    const done = await server.pollTransaction(sent.hash, { attempts: 30, sleepStrategy: () => 1000 });
    if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) return { ok: false, error: `faucet transfer ${done.status}` };
    return { ok: true, hash: sent.hash };
  }

  return { address: keypair.publicKey(), send };
}
