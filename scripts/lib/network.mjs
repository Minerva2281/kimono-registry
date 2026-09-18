// devnet(練習・無料)とmainnet(本番・本物)の設定をここでまとめて管理する。
// 「今どちらに接続しているか」を必ず表示することで、取り違え事故を防ぐ。

const NETWORKS = {
  devnet: {
    solanaRpcUrl: "https://api.devnet.solana.com",
    explorerCluster: "?cluster=devnet",
    label: "🧪 devnet(練習用・お金はかかりません)",
  },
  mainnet: {
    solanaRpcUrl: "https://api.mainnet-beta.solana.com",
    explorerCluster: "",
    label: "💴 mainnet(本番・本物のお金がかかります)",
  },
};

export function resolveNetwork(argOrEnv) {
  const name = (argOrEnv || "devnet").toLowerCase();
  if (name !== "devnet" && name !== "mainnet") {
    throw new Error(`network は "devnet" か "mainnet" のどちらかにしてください(渡された値: ${name})`);
  }
  const config = NETWORKS[name];
  console.log(`\n=== 接続先: ${config.label} ===\n`);
  return { name, ...config };
}

export function explorerTxUrl(network, signature) {
  return `https://explorer.solana.com/tx/${signature}${network.explorerCluster}`;
}
