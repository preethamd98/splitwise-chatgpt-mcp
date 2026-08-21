import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import type { Config } from "./config.js";
import type { MemoryStore } from "./store.js";

type State = { clientId: string; redirectUri: string; state: string; challenge: string; resource: string; scope: string; exp: number };
const b64 = (value: string) => Buffer.from(value).toString("base64url");

export function signState(value: State, secret: string) {
  const payload = b64(JSON.stringify(value));
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyState(token: string, secret: string): State {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new Error("Invalid OAuth state");
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid OAuth state signature");
  const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as State;
  if (value.exp < Date.now()) throw new Error("OAuth state expired");
  return value;
}

function validRedirect(uri: string) {
  const url = new URL(uri);
  return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
}

export function installOAuthRoutes(app: import("express").Express, config: Config, store: MemoryStore) {
  app.get("/.well-known/oauth-protected-resource", (_req, res) => res.json({
    resource: config.resource,
    authorization_servers: [config.publicBaseUrl],
    scopes_supported: ["splitwise:read", "splitwise:write"],
    resource_documentation: `${config.publicBaseUrl}/docs`,
  }));

  app.get("/.well-known/oauth-authorization-server", (_req, res) => res.json({
    issuer: config.publicBaseUrl,
    authorization_endpoint: `${config.publicBaseUrl}/authorize`,
    token_endpoint: `${config.publicBaseUrl}/token`,
    registration_endpoint: `${config.publicBaseUrl}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["splitwise:read", "splitwise:write"],
  }));

  app.post("/register", (req: Request, res: Response) => {
    const redirectUris = req.body?.redirect_uris;
    if (!Array.isArray(redirectUris) || !redirectUris.length || !redirectUris.every((x) => typeof x === "string" && validRedirect(x))) {
      return res.status(400).json({ error: "invalid_redirect_uri" });
    }
    const clientId = store.id(24);
    store.clients.set(clientId, { clientId, redirectUris, createdAt: Date.now() });
    return res.status(201).json({ client_id: clientId, redirect_uris: redirectUris, token_endpoint_auth_method: "none" });
  });

  app.get("/authorize", (req: Request, res: Response) => {
    const { client_id, redirect_uri, state, code_challenge, code_challenge_method, resource } = req.query;
    const requestedClientId = typeof client_id === "string" ? client_id : "";
    const client = store.clients.get(requestedClientId);
    if (!client || typeof redirect_uri !== "string" || !client.redirectUris.includes(redirect_uri)) return res.status(400).send("Invalid OAuth client or redirect URI");
    if (typeof state !== "string" || typeof code_challenge !== "string" || code_challenge_method !== "S256") return res.status(400).send("PKCE S256 and state are required");
    if (resource !== config.resource) return res.status(400).send("Invalid resource");
    const scope = typeof req.query.scope === "string" ? req.query.scope : "splitwise:read splitwise:write";
    const bridgeState = signState({ clientId: requestedClientId, redirectUri: redirect_uri, state, challenge: code_challenge, resource, scope, exp: Date.now() + 10 * 60_000 }, config.sessionSecret);
    const url = new URL(config.splitwiseAuthorizeUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", config.splitwiseClientId);
    url.searchParams.set("redirect_uri", `${config.publicBaseUrl}/oauth/splitwise/callback`);
    url.searchParams.set("state", bridgeState);
    return res.redirect(url.toString());
  });

  app.get("/oauth/splitwise/callback", async (req: Request, res: Response) => {
    try {
      if (typeof req.query.error === "string") throw new Error(`Splitwise authorization failed: ${req.query.error}`);
      if (typeof req.query.code !== "string" || typeof req.query.state !== "string") throw new Error("Missing authorization response");
      const state = verifyState(req.query.state, config.sessionSecret);
      const tokenResponse = await fetch(config.splitwiseTokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code", code: req.query.code, client_id: config.splitwiseClientId,
          client_secret: config.splitwiseClientSecret, redirect_uri: `${config.publicBaseUrl}/oauth/splitwise/callback`,
        }),
      });
      const upstream = await tokenResponse.json() as { access_token?: string; error?: string };
      if (!tokenResponse.ok || !upstream.access_token) throw new Error(upstream.error ?? "Splitwise token exchange failed");
      const code = store.id();
      store.codes.set(code, { redirectUri: state.redirectUri, clientId: state.clientId, codeChallenge: state.challenge, resource: state.resource, scope: state.scope, splitwiseAccessToken: upstream.access_token, expiresAt: Date.now() + 5 * 60_000 });
      const redirect = new URL(state.redirectUri);
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", state.state);
      return res.redirect(redirect.toString());
    } catch (error) { return res.status(400).send(error instanceof Error ? error.message : "OAuth callback failed"); }
  });

  app.post("/token", (req: Request, res: Response) => {
    store.purge();
    const { grant_type, code, client_id, redirect_uri, code_verifier, resource } = req.body ?? {};
    const pending = typeof code === "string" ? store.codes.get(code) : undefined;
    if (grant_type !== "authorization_code" || !pending || pending.clientId !== client_id || pending.redirectUri !== redirect_uri || pending.resource !== resource || typeof code_verifier !== "string") return res.status(400).json({ error: "invalid_grant" });
    const challenge = createHash("sha256").update(code_verifier).digest("base64url");
    if (challenge !== pending.codeChallenge) return res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
    store.codes.delete(code);
    const accessToken = store.id(32);
    store.sessions.set(accessToken, { splitwiseAccessToken: pending.splitwiseAccessToken, scope: pending.scope, resource: pending.resource, expiresAt: Date.now() + 8 * 60 * 60_000 });
    return res.json({ access_token: accessToken, token_type: "Bearer", expires_in: 28_800, scope: pending.scope });
  });
}
