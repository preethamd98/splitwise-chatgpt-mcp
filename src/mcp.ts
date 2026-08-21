import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SplitwiseClient } from "./splitwise.js";
import { summarizeExpenseDetails, summarizeExpenses, summarizeFriends, summarizeGroups } from "./views.js";

const readSecurity = [{ type: "oauth2" as const, scopes: ["splitwise:read"] }];
const writeSecurity = [{ type: "oauth2" as const, scopes: ["splitwise:write"] }];
const result = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data as Record<string, unknown> });
// securitySchemes is in the MCP tool descriptor; _meta mirrors it for older ChatGPT clients.
const secured = <T extends object>(definition: T, securitySchemes: typeof readSecurity | typeof writeSecurity) => ({
  ...definition, securitySchemes, _meta: { securitySchemes },
}) as T;

export function createMcpServer(client: SplitwiseClient, grantedScopes = new Set(["splitwise:read", "splitwise:write"]), requestId?: string) {
  const server = new McpServer({ name: "splitwise", version: "1.0.0" }, {
    instructions: "Use read tools to resolve IDs before writes. List tools return compact paginated records; use get_expense for full details. Creating an expense changes the user's Splitwise account; summarize the exact amount, currency, group, payer, and shares before calling it.",
  });

  const run = async (tool: string, operation: () => Promise<unknown>) => {
    const startedAt = Date.now();
    try {
      const data = await operation();
      console.log(JSON.stringify({ event: "tool_call", request_id: requestId, tool, ok: true, duration_ms: Date.now() - startedAt }));
      return result(data);
    } catch (error) {
      console.error(JSON.stringify({ event: "tool_call", request_id: requestId, tool, ok: false, duration_ms: Date.now() - startedAt, error: error instanceof Error ? error.name : "UnknownError" }));
      throw error;
    }
  };

  const pageSchema = {
    limit: z.number().int().min(1).max(100).default(20).describe("Maximum records to return."),
    offset: z.number().int().min(0).default(0).describe("Zero-based offset for pagination."),
  };

  server.registerTool("list_groups", secured({
    title: "List Splitwise groups", description: "Use this when you need Splitwise group IDs, member IDs, or group balances. Returns compact paginated records; continue with next_offset when has_more is true.",
    inputSchema: pageSchema, annotations: { readOnlyHint: true, openWorldHint: true },
  }, readSecurity), async ({ limit, offset }) => {
    requireScope(grantedScopes, "splitwise:read");
    return run("list_groups", async () => summarizeGroups(await client.listGroups(), { limit, offset }));
  });

  server.registerTool("list_friends", secured({
    title: "List Splitwise friends and balances", description: "Use this when you need Splitwise friend IDs or balances. Returns compact paginated records; continue with next_offset when has_more is true.",
    inputSchema: pageSchema, annotations: { readOnlyHint: true, openWorldHint: true },
  }, readSecurity), async ({ limit, offset }) => {
    requireScope(grantedScopes, "splitwise:read");
    return run("list_friends", async () => summarizeFriends(await client.listFriends(), { limit, offset }));
  });

  server.registerTool("list_expenses", secured({
    title: "List Splitwise expenses", description: "List expenses, optionally filtered by group, friend, date/update range, limit, and offset. A group filter takes precedence over a friend filter.",
    inputSchema: {
      group_id: z.number().int().optional(), friend_id: z.number().int().optional(),
      dated_after: z.string().datetime().optional(), dated_before: z.string().datetime().optional(),
      updated_after: z.string().datetime().optional(), updated_before: z.string().datetime().optional(),
      limit: z.number().int().min(1).max(100).default(10), offset: z.number().int().min(0).default(0),
    }, annotations: { readOnlyHint: true, openWorldHint: true },
  }, readSecurity), async (args) => {
    requireScope(grantedScopes, "splitwise:read");
    return run("list_expenses", async () => summarizeExpenses(await client.listExpenses(args), { limit: args.limit, offset: args.offset }));
  });

  server.registerTool("get_expense", secured({
    title: "Get Splitwise expense details", description: "Get one expense by its Splitwise expense ID, including users, shares, repayments, and comments.",
    inputSchema: { expense_id: z.number().int().positive() },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, readSecurity), async ({ expense_id }) => {
    requireScope(grantedScopes, "splitwise:read");
    return run("get_expense", async () => summarizeExpenseDetails(await client.getExpense(expense_id)));
  });

  const share = z.object({ user_id: z.number().int().positive(), paid_share: z.string().regex(/^\d+(\.\d{1,2})?$/), owed_share: z.string().regex(/^\d+(\.\d{1,2})?$/) });
  server.registerTool("create_expense", secured({
    title: "Create a Splitwise expense",
    description: "Create an expense. Use split_equally=true for an equal group split, or provide every participant's paid_share and owed_share. Amounts are decimal strings with at most two decimal places.",
    inputSchema: {
      cost: z.string().regex(/^\d+(\.\d{1,2})?$/), description: z.string().min(1).max(255), details: z.string().optional(),
      date: z.string().datetime().optional(), currency_code: z.string().length(3).default("USD"), category_id: z.number().int().positive().optional(),
      group_id: z.number().int().min(0), split_equally: z.boolean().optional(), shares: z.array(share).min(2).optional(),
    }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, writeSecurity), async (args) => {
    requireScope(grantedScopes, "splitwise:write");
    if (Boolean(args.split_equally) === Boolean(args.shares)) throw new Error("Provide exactly one split method: split_equally=true or shares");
    const owed = args.shares?.reduce((sum, x) => sum + Number(x.owed_share), 0);
    const paid = args.shares?.reduce((sum, x) => sum + Number(x.paid_share), 0);
    if (args.shares && (Math.abs((owed ?? 0) - Number(args.cost)) > 0.005 || Math.abs((paid ?? 0) - Number(args.cost)) > 0.005)) throw new Error("Both paid_share and owed_share totals must equal cost");
    return run("create_expense", async () => client.createExpense(args));
  });

  server.registerTool("update_expense", secured({
    title: "Update an existing Splitwise expense",
    description: "Use this only after get_expense confirms the exact expense ID and current shares. Updates the existing expense and overwrites every participant share; provide the complete participant list. Omit group_id to preserve the existing group. Paid and owed totals must each equal cost.",
    inputSchema: {
      expense_id: z.number().int().positive(), cost: z.string().regex(/^\d+(\.\d{1,2})?$/), description: z.string().min(1).max(255),
      details: z.string().optional(), date: z.string().datetime().optional(), currency_code: z.string().length(3).default("USD"),
      category_id: z.number().int().positive().optional(), group_id: z.number().int().min(0).optional(), shares: z.array(share).min(2),
    }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, writeSecurity), async ({ expense_id, ...args }) => {
    requireScope(grantedScopes, "splitwise:write");
    const owed = args.shares.reduce((sum, x) => sum + Number(x.owed_share), 0);
    const paid = args.shares.reduce((sum, x) => sum + Number(x.paid_share), 0);
    if (Math.abs(owed - Number(args.cost)) > 0.005 || Math.abs(paid - Number(args.cost)) > 0.005) throw new Error("Both paid_share and owed_share totals must equal cost");
    return run("update_expense", async () => client.updateExpense(expense_id, args));
  });
  return server;
}

function requireScope(granted: Set<string>, required: string) {
  if (!granted.has(required)) throw new Error(`OAuth token is missing required scope: ${required}`);
}
