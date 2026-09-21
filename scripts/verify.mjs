#!/usr/bin/env node
// 第三者検証スクリプト。誰でも実行できる(このスクリプトが「他者から呼べる設計」の中身)。
// Arweave上の履歴書を取ってきて指紋を計算し直し、Solana上に刻まれた指紋と一致するか確認する。
//
// 使い方: node scripts/verify.mjs <data/フォルダ名>
// 例:    node scripts/verify.mjs data/001-miho

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createSolanaRpc } from "@solana/kit";
import { canonicalize, sha256Hex } from "./lib/canonical.mjs";

export async function verify(manifest) {
  const rpcUrl = manifest.network === "devnet"
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet-beta.solana.com";

  // 1. Arweave(Irys)から履歴書本文を取得
  const res = await fetch(manifest.chronicle_url);
  if (!res.ok) throw new Error(`履歴書の取得に失敗しました: ${res.status}`);
  const chronicle = await res.json();

  // 2. 指紋を計算し直す
  const recomputedHash = await sha256Hex(canonicalize(chronicle));

  // 3. Solana上の取引を取得し、メモの中身を見る
  const rpc = createSolanaRpc(rpcUrl);
  const tx = await rpc.getTransaction(manifest.solana_signature, {
    maxSupportedTransactionVersion: 0,
    encoding: "jsonParsed",
  }).send();

  if (!tx) throw new Error("指定された取引がチェーン上に見つかりません");

  // jsonParsed encoding では、メモ命令は { program: "spl-memo", parsed: "<テキスト>" } という形で返る
  // (Kit純正のInstruction型とは形が異なるため、getMemosFromInstructionsは使わずここで直接読む)
  const instructions = tx.transaction.message.instructions;
  const memoIx = instructions.find(
    (ix) => ix.program === "spl-memo" || ix.programId === "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
  );
  if (!memoIx) throw new Error("この取引にメモが見つかりません");

  const onChainPayload = JSON.parse(memoIx.parsed);
  const onChainHash = onChainPayload.sha256;

  const match = recomputedHash === onChainHash;

  return {
    match,
    recomputedHash,
    onChainHash,
    chronicle,
  };
}

async function main() {
  const [, , folderArg] = process.argv;
  if (!folderArg) {
    console.error("使い方: node scripts/verify.mjs <data/フォルダ名>");
    process.exit(1);
  }
  const folder = folderArg.startsWith("data/") ? folderArg : `data/${folderArg}`;
  const manifest = JSON.parse(await readFile(path.join(folder, "manifest.json"), "utf8"));

  console.log("検証中...\n");
  const result = await verify(manifest);

  console.log(`Arweaveから再計算した指紋: ${result.recomputedHash}`);
  console.log(`Solana上に刻まれている指紋: ${result.onChainHash}`);
  console.log(result.match ? "\n✅ 一致しました。この履歴書は届け出時点から改ざんされていません。" : "\n❌ 一致しません。内容が変更されている可能性があります。");
}

// このファイルが直接実行されたときだけmain()を動かす
// (site/側から import して使い回せるようにするため)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("\n❌ エラー:", err.message);
    process.exit(1);
  });
}
