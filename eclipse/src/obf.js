const K = Buffer.from([59, 113, 22, 77, 42, 104]);

export function obf(s) {
  const b = Buffer.from(String(s), "utf8");
  const o = Buffer.allocUnsafe(b.length);
  for (let i = 0; i < b.length; i++) o[i] = b[i] ^ K[i % K.length];
  return o.toString("base64");
}

export function deobf(b64) {
  try {
    const b = Buffer.from(String(b64), "base64");
    const o = Buffer.allocUnsafe(b.length);
    for (let i = 0; i < b.length; i++) o[i] = b[i] ^ K[i % K.length];
    return o.toString("utf8");
  } catch {
    return "";
  }
}

export function sendObf(res, payload, maxAge = 600) {
  res
    .set("Cache-Control", `public, max-age=${maxAge}`)
    .type("text/plain; charset=utf-8")
    .send(obf(JSON.stringify(payload)));
}
