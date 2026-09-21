#!/usr/bin/env node
// 戸籍を刻むメインスクリプト。
// 使い方: node scripts/anchor.mjs <devnet|mainnet> <data/フォルダ名>
// 例:    node scripts/anchor.mjs devnet data/001-miho

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { createClient } from "@solana/kit";
import { solanaDevnetRpc, solanaMainnetRpc } from "@solana/kit-plugin-rpc";
import { signerFromFile } from "@solana/kit-plugin-signer";
import { getAddMemoInstruction } from "@solana-program/memo";
import { Uploader } from "@irys/upload";
import { Solana } from "@irys/upload-solana";
import { resolveNetwork, explorerTxUrl } from "./lib/network.mjs";
import { canonicalize, sha256Hex } from "./lib/canonical.mjs";

async function main() {
  const [, , networkArg, folderArg] = process.argv;
  if (!folderArg) {
    console.error("使い方: node scripts/anchor.mjs <devnet|mainnet> <data/フォルダ名>");
    process.exit(1);
  }
  const network = resolveNetwork(networkArg);
  const keypairPath = `./${network.name}-keypair.json`;

  const folder = folderArg.startsWith("data/") ? folderArg : `data/${folderArg}`;
  const chroniclePath = path.join(folder, "chronicle.json");
  const photosDir = path.join(folder, "photos");

  console.log(`履歴書を読み込み中: ${chroniclePath}`);
  const chronicle = JSON.parse(await readFile(chroniclePath, "utf8"));

  // --- 1. Irys(Arweave)への接続 ---
  const irysUploader = network.name === "devnet"
    ? await Uploader(Solana).withWallet(await readFile(keypairPath, "utf8").then((t) => new Uint8Array(JSON.parse(t)))).withRpc(network.solanaRpcUrl).devnet()
    : await Uploader(Solana).withWallet(await readFile(keypairPath, "utf8").then((t) => new Uint8Array(JSON.parse(t)))).withRpc(network.solanaRpcUrl);

  const startedAt = Date.now();
  const balanceBefore = await irysUploader.getLoadedBalance();
  console.log(`Irysの残高(開始時): ${balanceBefore} atomic units`);

  // --- 1.5 必要な費用を見積もり、不足分だけ入金する ---
  let photoFiles = [];
  try {
    photoFiles = (await readdir(photosDir)).filter((f) => !f.startsWith("."));
  } catch {
    console.log("(photos フォルダが見つかりません。写真なしで進めます)");
  }
  const { statSync } = await import("node:fs");
  let totalBytes = 0;
  for (const file of photoFiles) totalBytes += statSync(path.join(photosDir, file)).size;
  totalBytes += Buffer.byteLength(JSON.stringify(chronicle)) + 2048; // 履歴書本体の概算+余裕分

  const priceAtomic = await irysUploader.getPrice(totalBytes);
  console.log(`見積もりサイズ: ${totalBytes} bytes / 見積もり費用: ${priceAtomic} atomic units`);

  if (priceAtomic.isGreaterThan(balanceBefore)) {
    const need = priceAtomic.minus(balanceBefore);
    console.log(`残高不足のため入金します: ${need} atomic units`);
    await irysUploader.fund(need);
    console.log(`入金後の残高: ${await irysUploader.getLoadedBalance()} atomic units`);
  }

  // --- 2. 写真をアップロード ---
  const photoUrls = [];
  for (const file of photoFiles) {
    const filePath = path.join(photosDir, file);
    console.log(`写真をアップロード中: ${file}`);
    const receipt = await irysUploader.uploadFile(filePath);
    const url = `https://gateway.irys.xyz/${receipt.id}`;
    console.log(`  → ${url}`);
    photoUrls.push(url);
  }
  chronicle.photos = photoUrls;

  // --- 3. 履歴書(最終版)をアップロード ---
  const chronicleText = JSON.stringify(chronicle, null, 2);
  console.log("履歴書本体をアップロード中...");
  const chronicleReceipt = await irysUploader.upload(chronicleText, {
    tags: [{ name: "Content-Type", value: "application/json" }],
  });
  const chronicleUrl = `https://gateway.irys.xyz/${chronicleReceipt.id}`;
  console.log(`  → ${chronicleUrl}`);

  const balanceAfter = await irysUploader.getLoadedBalance();
  const irysElapsedMs = Date.now() - startedAt;
  console.log(`\nIrys側の所要時間: ${(irysElapsedMs / 1000).toFixed(1)}秒`);
  console.log(`Irys残高(終了時): ${balanceAfter} atomic units`);
  console.log(`実際に使われた費用: ${balanceBefore.minus(balanceAfter).abs()} atomic units(入金分含む差引は入金額を参照)`);

  // --- 4. 指紋(ハッシュ)を計算 ---
  const hash = await sha256Hex(canonicalize(chronicle));
  console.log(`指紋(SHA-256): ${hash}`);

  // --- 5. Solanaに刻む ---
  const memoPayload = JSON.stringify({
    schema: chronicle.schema_version,
    sha256: hash,
    filing_date: chronicle.filing_date,
    chronicle_url: chronicleUrl,
  });

  console.log("\nSolanaに刻む内容:");
  console.log(memoPayload);
  console.log(`\n接続先: ${network.label}`);

  if (network.name === "mainnet") {
    console.log("\n⚠️  これは本番網(mainnet)への書き込みです。本物のお金がかかります。取り消せません。");
    console.log(`刻む相手: ${keypairPath} の鍵`);
    console.log(`刻む内容: ${memoPayload}`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('\n本当に本番網に刻みますか? よければ "刻む" と入力してください: ');
    rl.close();
    if (answer.trim() !== "刻む") {
      console.log("中止しました。何も送信していません。");
      process.exit(0);
    }
  }

  const client = await createClient()
    .use(signerFromFile(keypairPath))
    .use(network.name === "devnet" ? solanaDevnetRpc() : solanaMainnetRpc({ rpcUrl: network.solanaRpcUrl }));

  const memoInstruction = getAddMemoInstruction({ memo: memoPayload });
  const result = await client.sendTransaction([memoInstruction]);
  const signature = result.context.signature;

  console.log(`\n✅ 刻みました。取引署名: ${signature}`);
  console.log(`エクスプローラーで確認: ${explorerTxUrl(network, signature)}`);

  // --- 6. 戸籍ページ用のmanifestを保存 ---
  const manifest = {
    network: network.name,
    chronicle_url: chronicleUrl,
    solana_signature: signature,
    explorer_url: explorerTxUrl(network, signature),
    sha256: hash,
  };
  const manifestPath = path.join(folder, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nmanifestを保存しました: ${manifestPath}`);

  const totalElapsedMs = Date.now() - startedAt;
  console.log(`\n=== まとめ ===`);
  console.log(`合計所要時間: ${(totalElapsedMs / 1000).toFixed(1)}秒`);
  console.log(`アップロードサイズ: ${totalBytes} bytes`);
  console.log(`Irys残高 開始時→終了時: ${balanceBefore} → ${balanceAfter} atomic units`);
}

main().catch((err) => {
  console.error("\n❌ エラーが発生しました:", err.message);
  process.exit(1);
});
