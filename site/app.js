// 戸籍ページの中身。フレームワークなし、そのままブラウザで動く。

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const RPC_URLS = {
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

async function fetchOnChainMemo(network, signature) {
  const res = await fetch(RPC_URLS[network], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
    }),
  });
  const { result } = await res.json();
  if (!result) throw new Error("チェーン上に取引が見つかりません");
  const memoIx = result.transaction.message.instructions.find(
    (ix) => ix.program === "spl-memo" || ix.programId === "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
  );
  if (!memoIx) throw new Error("メモ命令が見つかりません");
  const memoText = memoIx.parsed ?? memoIx.memo ?? "";
  return JSON.parse(memoText);
}

async function loadChronicle(manifestUrl) {
  const manifest = await (await fetch(manifestUrl)).json();
  const chronicle = await (await fetch(manifest.chronicle_url)).json();
  return { manifest, chronicle };
}

function renderChronicle(chronicle, manifest) {
  const root = document.getElementById("chronicle");
  const photosHtml = (chronicle.photos || [])
    .map((url) => `<img src="${url}" alt="着物の写真" class="photo" />`)
    .join("");

  root.innerHTML = `
    <div class="photos">${photosHtml}</div>
    <dl>
      <dt>種類・格(専門家の見立て)</dt><dd>${chronicle.classification?.category ?? "—"}</dd>
      <dt>年代(推定)</dt><dd>${chronicle.era_estimate?.period ?? "—"}</dd>
      <dt>寸法</dt><dd>身丈 ${chronicle.measurements?.mitake_cm ?? "—"}cm / 裄 ${chronicle.measurements?.yuki_cm ?? "—"}cm</dd>
      <dt>持ち主の語り</dt><dd>${chronicle.owner_narrative_summary ?? "—"}</dd>
      <dt>届け出日付</dt><dd>${chronicle.filing_date ?? "—"}</dd>
    </dl>
    <p><a href="${manifest.explorer_url}" target="_blank" rel="noopener">Solanaエクスプローラーで確認する →</a></p>
  `;
}

async function runVerification(manifestUrl) {
  const status = document.getElementById("verify-status");
  status.textContent = "検証中…";
  try {
    const manifest = await (await fetch(manifestUrl)).json();
    const chronicleRes = await fetch(manifest.chronicle_url);
    const chronicleText = await chronicleRes.text();
    const chronicle = JSON.parse(chronicleText);

    const recomputed = await sha256Hex(canonicalize(chronicle));
    const onChain = await fetchOnChainMemo(manifest.network, manifest.solana_signature);

    if (recomputed === onChain.sha256) {
      status.textContent = "✅ 一致しました。この履歴書は届け出時点から改ざんされていません。";
      status.className = "ok";
    } else {
      status.textContent = "❌ 一致しません。内容が変更されている可能性があります。";
      status.className = "ng";
    }
  } catch (e) {
    status.textContent = `検証エラー: ${e.message}`;
    status.className = "ng";
  }
}

async function init() {
  const params = new URLSearchParams(location.search);
  const manifestUrl = params.get("manifest") || "../data/001-miho/manifest.json";

  const { manifest, chronicle } = await loadChronicle(manifestUrl);
  renderChronicle(chronicle, manifest);

  document.getElementById("verify-button").addEventListener("click", () => runVerification(manifestUrl));
}

init();
