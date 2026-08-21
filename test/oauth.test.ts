import assert from "node:assert/strict";
import test from "node:test";
import { signState, verifyState } from "../src/oauth.js";
import { seal, unseal } from "../src/stateless.js";

const secret = "a-secure-test-secret-that-is-long-enough";

test("signed OAuth bridge state round trips", () => {
  const state = { clientId: "c", redirectUri: "https://chatgpt.com/callback", state: "s", challenge: "p", resource: "https://example.com/mcp", scope: "splitwise:read", exp: Date.now() + 1000 };
  assert.deepEqual(verifyState(signState(state, secret), secret), state);
});

test("tampered OAuth bridge state is rejected", () => {
  const token = signState({ clientId: "c", redirectUri: "https://chatgpt.com/callback", state: "s", challenge: "p", resource: "r", scope: "s", exp: Date.now() + 1000 }, secret);
  assert.throws(() => verifyState(`${token}x`, secret));
});

test("encrypted tokens survive a simulated process restart", () => {
  const value = { kind: "access" as const, splitwiseAccessToken: "upstream-secret", scope: "splitwise:read", resource: "https://example.com/mcp", exp: Date.now() + 1000 };
  const token = seal(value, secret);
  assert.deepEqual(unseal(token, "access", secret), value);
});

test("encrypted tokens reject tampering, wrong purpose, wrong secret, and expiry", () => {
  const token = seal({ kind: "code" as const, value: "secret", exp: Date.now() + 1000 }, secret);
  assert.throws(() => unseal(`${token}x`, "code", secret));
  assert.throws(() => unseal(token, "access", secret));
  assert.throws(() => unseal(token, "code", `${secret}-different`));
  const expired = seal({ kind: "code" as const, exp: Date.now() - 1 }, secret);
  assert.throws(() => unseal(expired, "code", secret), /expired/);
});
