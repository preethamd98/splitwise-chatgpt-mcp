import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp.js";
import { SplitwiseClient } from "../src/splitwise.js";

class FakeSplitwiseClient extends SplitwiseClient {
  constructor() { super("unused", "https://example.test"); }
  override async listGroups() {
    return { groups: [{ id: 1, name: "Trip", members: [{ id: 2, first_name: "A", email: "private@example.test", picture: { large: "url" }, balance: [] }] }] };
  }
  override async listFriends() { return { friends: [] }; }
  override async listExpenses() { return { expenses: [] }; }
  override async getExpense() { return { expenses: [] }; }
}

test("MCP discovery and compact read call work end to end", async () => {
  const server = createMcpServer(new FakeSplitwiseClient());
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["create_expense", "get_expense", "list_expenses", "list_friends", "list_groups", "update_expense"]);
    const groupTool = listed.tools.find((tool) => tool.name === "list_groups");
    const limitSchema = groupTool?.inputSchema.properties?.limit as { default?: number } | undefined;
    assert.equal(limitSchema?.default, 20);
    const called = await client.callTool({ name: "list_groups", arguments: { limit: 1, offset: 0 } });
    const serialized = JSON.stringify(called);
    assert.equal(called.isError, undefined);
    assert.equal(serialized.includes("private@example.test"), false);
    assert.equal(serialized.includes("picture"), false);
  } finally {
    await client.close();
    await server.close();
  }
});
