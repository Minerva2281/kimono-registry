#!/usr/bin/env node
// 今日(9/19)の最小限の動作確認用: devnetに「テスト用のメモ」を一つ送るだけ。
// これが動けば、戸籍を刻む仕組みの核はもう動いている、ということ。

import { createClient } from "@solana/kit";
import { solanaDevnetRpc } from "@solana/kit-plugin-rpc";
import { signerFromFile } from "@solana/kit-plugin-signer";
import { getAddMemoInstruction } from "@solana-program/memo";
import { explorerTxUrl, resolveNetwork } from "./lib/network.mjs";

const network = resolveNetwork("devnet");

const client = await createClient()
  .use(signerFromFile("./devnet-keypair.json"))
  .use(solanaDevnetRpc());

console.log(`送信元アドレス: ${client.payer.address}`);

const memoInstruction = getAddMemoInstruction({
  memo: "kimono-registry: hello from 9/19 着工初日",
});

console.log("devnetに送信中...");
const result = await client.sendTransaction([memoInstruction]);
const signature = result.context.signature;

console.log(`\n✅ 送信できました。`);
console.log(`取引署名: ${signature}`);
console.log(`エクスプローラーで確認: ${explorerTxUrl(network, signature)}`);
