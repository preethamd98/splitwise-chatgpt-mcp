import assert from "node:assert/strict";
import test from "node:test";
import { summarizeExpenseDetails, summarizeExpenses, summarizeFriends, summarizeGroups } from "../src/views.js";

test("group summaries paginate and remove pictures, email, and invite links", () => {
  const raw = { groups: [
    { id: 1, name: "Trip", invite_link: "secret", members: [{ id: 2, first_name: "A", email: "a@example.test", picture: { large: "url" }, balance: [{ amount: "3.00", currency_code: "USD" }] }] },
    { id: 3, name: "Home", members: [] },
  ] };
  const result = summarizeGroups(raw, { limit: 1, offset: 0 });
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.pagination, { limit: 1, offset: 0, returned: 1, total: 2, has_more: true, next_offset: 1 });
  assert.equal(JSON.stringify(result).includes("example.test"), false);
  assert.equal(JSON.stringify(result).includes("invite_link"), false);
  assert.equal(JSON.stringify(result).includes("picture"), false);
});

test("default-sized group pages stay within a practical transport budget", () => {
  const groups = Array.from({ length: 40 }, (_, groupIndex) => ({
    id: groupIndex,
    name: `Group ${groupIndex}`,
    members: Array.from({ length: 5 }, (_, memberIndex) => ({
      id: groupIndex * 10 + memberIndex,
      first_name: `Member ${memberIndex}`,
      email: `private-${groupIndex}-${memberIndex}@example.test`,
      picture: { large: "https://example.test/a/very/large/image/url" },
      balance: [{ amount: "1.25", currency_code: "USD" }],
    })),
  }));
  const result = summarizeGroups({ groups }, { limit: 20, offset: 0 });
  assert.ok(JSON.stringify(result).length < 15_000);
});

test("friend summaries keep useful balances while removing contact data", () => {
  const result = summarizeFriends({ friends: [{ id: 2, first_name: "A", email: "a@example.test", balance: [{ amount: "0.00", currency_code: "USD" }], groups: [] }] }, { limit: 20, offset: 0 });
  assert.ok(result.friends[0]);
  assert.deepEqual(result.friends[0].balances, []);
  assert.equal(JSON.stringify(result).includes("example.test"), false);
});

test("expense list is compact and full expense details retain comments", () => {
  const raw = { expenses: [{ id: 9, description: "Dinner", cost: "20.00", currency_code: "USD", details: "Full note", receipt: { large: "url" }, users: [{ user: { id: 2, first_name: "A", email: "a@example.test" }, paid_share: "20.00", owed_share: "10.00" }], comments: [{ id: 4, content: "Thanks", user: { id: 2, first_name: "A" } }] }] };
  const list = summarizeExpenses(raw, { limit: 10, offset: 0 });
  assert.equal(JSON.stringify(list).includes("Full note"), false);
  assert.equal(JSON.stringify(list).includes("example.test"), false);
  assert.equal(JSON.stringify(list).includes("receipt"), false);
  const details = summarizeExpenseDetails(raw);
  assert.ok(details.expense);
  assert.equal(details.expense?.details, "Full note");
  const comments = details.expense.comments as Array<{ content: string }>;
  assert.equal(comments[0]?.content, "Thanks");
});
