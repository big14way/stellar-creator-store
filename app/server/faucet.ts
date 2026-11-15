// Testnet only: sends test USDC to a new wallet so anyone can try a purchase.
// The faucet account holds Circle's testnet USDC bought with testnet XLM.

import { BASE_FEE, Contract, Keypair, TransactionBuilder, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { address } from "../src/chain";
import { NETWORK_PASSPHRASE, RPC_URL, USDC_ID } from "../src/config";
import { serial } from "./serial";

export function faucet(secret: string) {
  const keypair = Keypair.fromSecret(secret);
  const server = new rpc.Server(RPC_URL);
  const queue = serial();

  type Sent = { ok: true; hash: string } | { ok: false; error: string };
  const send = (to: string, amount: bigint): Promise<Sent> =>
    queue(() =>
      sendNow(to, amount).catch((err): Sent => ({
        ok: false,
        error: `faucet could not send: ${err instanceof Error ? err.message : String(err)}`,
      })),
    );

  async function sendNow(to: string, amount: bigint): Promise<Sent> {
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
      const message = err instanceof Error ? err.message : String(err);
      if (/trustline/i.test(message)) return { ok: false, error: "Add USDC to this wallet first, then try again." };
      return { ok: false, error: `faucet could not send: ${message}` };
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
