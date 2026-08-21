import { randomBytes } from "node:crypto";

export type RegisteredClient = { clientId: string; redirectUris: string[]; createdAt: number };
export type PendingCode = {
  redirectUri: string;
  clientId: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  splitwiseAccessToken: string;
  expiresAt: number;
};
export type Session = { splitwiseAccessToken: string; scope: string; resource: string; expiresAt: number };

// Development store. Replace with Redis or a database before multi-instance production deployment.
export class MemoryStore {
  readonly clients = new Map<string, RegisteredClient>();
  readonly codes = new Map<string, PendingCode>();
  readonly sessions = new Map<string, Session>();

  id(bytes = 32) { return randomBytes(bytes).toString("base64url"); }
  purge() {
    const now = Date.now();
    for (const [key, value] of this.codes) if (value.expiresAt <= now) this.codes.delete(key);
    for (const [key, value] of this.sessions) if (value.expiresAt <= now) this.sessions.delete(key);
  }
}
