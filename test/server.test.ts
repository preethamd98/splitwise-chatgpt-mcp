import assert from "node:assert/strict";
import test from "node:test";
import { normalizeToolName } from "../src/tool-names.js";

test("normalizes ChatGPT-qualified Splitwise tool names", () => {
  assert.equal(normalizeToolName("splitwise.list_expenses"), "list_expenses");
  assert.equal(normalizeToolName("Splitwise_Stateless.list_expenses"), "list_expenses");
  assert.equal(normalizeToolName("splitwise_stateless.get_expense"), "get_expense");
  assert.equal(normalizeToolName("other.list_expenses"), "other.list_expenses");
});
