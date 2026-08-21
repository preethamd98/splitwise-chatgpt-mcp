import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./mcp.js";
import { installOAuthRoutes } from "./oauth.js";
import { SplitwiseClient } from "./splitwise.js";
import { MemoryStore } from "./store.js";

const config = loadConfig();
const store = new MemoryStore();
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false }));
installOAuthRoutes(app, config, store);

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/docs", (_req, res) => res.type("text/plain").send("Splitwise MCP connector. See the project README for usage and privacy details."));

async function mcpHandler(req: Request, res: Response) {
  store.purge();
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const session = token ? store.sessions.get(token) : undefined;
  if (!session || session.expiresAt <= Date.now() || session.resource !== config.resource) {
    const metadata = `${config.publicBaseUrl}/.well-known/oauth-protected-resource`;
    res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${metadata}", scope="splitwise:read splitwise:write"`);
    return res.status(401).json({ error: "unauthorized" });
  }
  const server = createMcpServer(new SplitwiseClient(session.splitwiseAccessToken, config.splitwiseApiBaseUrl), new Set(session.scope.split(/\s+/).filter(Boolean)));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

app.all("/mcp", (req, res) => { void mcpHandler(req, res).catch((error) => {
  console.error(error);
  if (!res.headersSent) res.status(500).json({ error: "internal_server_error" });
}); });

app.listen(config.port, () => console.log(`Splitwise MCP listening on port ${config.port}`));
