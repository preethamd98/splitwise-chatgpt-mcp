import assert from "node:assert/strict";
import test from "node:test";
import { signState, verifyState } from "../src/oauth.js";

const secret = "a-secure-test-secret-that-is-long-enough";

test("signed OAuth bridge state round trips", () => {
  const state = { clientId: "c", redirectUri: "https://chatgpt.com/callback", state: "s", challenge: "p", resource: "https://example.com/mcp", scope: "splitwise:read", exp: Date.now() + 1000 };
  assert.deepEqual(verifyState(signState(state, secret), secret), state);
});

test("tampered OAuth bridge state is rejected", () => {
  const token = signState({ clientId: "c", redirectUri: "https://chatgpt.com/callback", state: "s", challenge: "p", resource: "r", scope: "s", exp: Date.now() + 1000 }, secret);
  assert.throws(() => verifyState(`${token}x`, secret));
});
