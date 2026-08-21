import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

type Envelope = { kind: string; exp: number };

function keyFromSecret(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export function seal<T extends Envelope>(value: T, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  cipher.setAAD(Buffer.from(`splitwise-mcp:${value.kind}:v1`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["st1", value.kind, iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function unseal<T extends Envelope>(token: string, kind: T["kind"], secret: string): T {
  const [version, tokenKind, encodedIv, encodedCiphertext, encodedTag, extra] = token.split(".");
  if (version !== "st1" || tokenKind !== kind || !encodedIv || !encodedCiphertext || !encodedTag || extra) throw new Error("Invalid encrypted token");
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), Buffer.from(encodedIv, "base64url"));
    decipher.setAAD(Buffer.from(`splitwise-mcp:${kind}:v1`));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, "base64url")), decipher.final()]);
    const value = JSON.parse(plaintext.toString("utf8")) as T;
    if (value.kind !== kind || typeof value.exp !== "number" || value.exp <= Date.now()) throw new Error("Encrypted token expired");
    return value;
  } catch (error) {
    if (error instanceof Error && error.message === "Encrypted token expired") throw error;
    throw new Error("Invalid encrypted token");
  }
}
