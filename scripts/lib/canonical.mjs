// 同じ内容なら、常に同じハッシュになるようにするための「並べ替え」
// (JSONはキーの順番が変わっても中身は同じだが、文字列にすると別物になるため)
export function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(digest).toString("hex");
}
