import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./mcp.js";
import { installOAuthRoutes, openAccessToken } from "./oauth.js";
import { SplitwiseClient } from "./splitwise.js";

const config = loadConfig();
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false }));
installOAuthRoutes(app, config);

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/docs", (_req, res) => res.type("text/plain").send("Splitwise MCP connector. See the project README for usage and privacy details."));

async function mcpHandler(req: Request, res: Response) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  let session: ReturnType<typeof openAccessToken> | undefined;
  try { session = token ? openAccessToken(token, config.sessionSecret) : undefined; } catch { session = undefined; }
  if (!session || session.resource !== config.resource) {
    const metadata = `${config.publicBaseUrl}/.well-known/oauth-protected-resource`;
    res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${metadata}", scope="splitwise:read splitwise:write"`);
    return res.status(401).json({ error: "unauthorized" });
  }
  const server = createMcpServer(new SplitwiseClient(session.splitwiseAccessToken, config.splitwiseApiBaseUrl), new Set(session.scope.split(/\s+/).filter(Boolean)));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  // Some ChatGPT connector clients qualify calls with the MCP server name even
  // though tools/list returns unqualified names. Accept both wire formats while
  // keeping discovery clean and portable for other MCP clients.
  if (req.body?.method === "tools/call" && typeof req.body?.params?.name === "string" && req.body.params.name.startsWith("splitwise.")) {
    req.body.params.name = req.body.params.name.slice("splitwise.".length);
  }
  res.on("close", () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

app.all("/mcp", (req, res) => { void mcpHandler(req, res).catch((error) => {
  console.error(error);
  if (!res.headersSent) res.status(500).json({ error: "internal_server_error" });
}); });

app.listen(config.port, () => console.log(`Splitwise MCP listening on port ${config.port}`));
