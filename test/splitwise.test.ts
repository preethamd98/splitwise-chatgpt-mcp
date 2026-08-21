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
