import assert from "node:assert/strict";
import test from "node:test";
import { SplitwiseClient } from "../src/splitwise.js";

test("createExpense flattens explicit shares for Splitwise", async () => {
  const originalFetch = globalThis.fetch;
  let captured = "";
  globalThis.fetch = async (_url, init) => {
    captured = String(init?.body);
    return new Response(JSON.stringify({ expenses: [{ id: 1 }], errors: {} }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const client = new SplitwiseClient("token", "https://example.test/api");
    await client.createExpense({ cost: "12.50", description: "Lunch", group_id: 3, shares: [
      { user_id: 1, paid_share: "12.50", owed_share: "6.25" }, { user_id: 2, paid_share: "0", owed_share: "6.25" },
    ] });
    const form = new URLSearchParams(captured);
    assert.equal(form.get("users__1__owed_share"), "6.25");
    assert.equal(form.get("users__0__paid_share"), "12.50");
  } finally { globalThis.fetch = originalFetch; }
});

test("updateExpense posts the full replacement split to the expense endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody = "";
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedBody = String(init?.body);
    return new Response(JSON.stringify({ expenses: [{ id: 9 }], errors: {} }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const client = new SplitwiseClient("token", "https://example.test/api");
    await client.updateExpense(9, { cost: "130.00", description: "Costco Membership", shares: [
      { user_id: 1, paid_share: "130.00", owed_share: "65.00" }, { user_id: 2, paid_share: "0.00", owed_share: "65.00" },
    ] });
    const form = new URLSearchParams(capturedBody);
    assert.equal(capturedUrl, "https://example.test/api/update_expense/9");
    assert.equal(form.get("cost"), "130.00");
    assert.equal(form.has("group_id"), false);
    assert.equal(form.get("users__1__owed_share"), "65.00");
    assert.equal(form.get("users__0__paid_share"), "130.00");
  } finally { globalThis.fetch = originalFetch; }
});
