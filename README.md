# Splitwise connector for ChatGPT

A data-only MCP server that connects ChatGPT to Splitwise's official API. It supports:

- `list_groups`
- `list_friends` (including balances)
- `list_expenses`
- `get_expense`
- `create_expense` (equal group split or explicit shares)

The server uses Streamable HTTP at `/mcp`. It also acts as a small OAuth 2.1 authorization bridge: ChatGPT completes PKCE with this server, while this server completes Splitwise OAuth and keeps the Splitwise token out of ChatGPT.

## Prerequisites

- Node.js 20 or newer
- A stable public HTTPS URL for deployment (or a development tunnel while testing)
- A Splitwise account and Splitwise OAuth application

## 1. Register the Splitwise application

1. Open <https://secure.splitwise.com/apps> and create an OAuth application.
2. Set its callback URL to `https://YOUR-CONNECTOR-HOST/oauth/splitwise/callback`.
3. Copy the client ID and client secret. Never commit them.

Splitwise must redirect to the connector, not directly to ChatGPT. The connector resumes ChatGPT's separate PKCE flow afterward.

## 2. Configure and run

```bash
cp .env.example .env
# Fill in .env, then:
npm install
npm run dev
```

Required variables:

| Variable | Purpose |
| --- | --- |
| `PUBLIC_BASE_URL` | Public HTTPS origin, without a trailing slash |
| `SPLITWISE_CLIENT_ID` | Splitwise OAuth app client ID |
| `SPLITWISE_CLIENT_SECRET` | Splitwise OAuth app secret |
| `SESSION_SECRET` | Stable random secret, at least 32 characters, used to authenticate and encrypt OAuth artifacts |

Optional variables: `PORT`, `SPLITWISE_AUTHORIZE_URL`, `SPLITWISE_TOKEN_URL`, and `SPLITWISE_API_BASE_URL`.

Generate a session secret with `openssl rand -hex 32`. For a container:

```bash
docker build -t splitwise-mcp .
docker run --env-file .env -p 3000:3000 splitwise-mcp
```

## 3. OAuth flow

1. ChatGPT discovers `/.well-known/oauth-protected-resource` from the MCP server.
2. It discovers this connector's OAuth metadata at `/.well-known/oauth-authorization-server` and dynamically registers a public client at `/register`.
3. ChatGPT starts authorization-code + PKCE at `/authorize`, including the MCP `resource` value.
4. The connector redirects the user to Splitwise and receives the result at `/oauth/splitwise/callback`.
5. The connector exchanges Splitwise's code server-side, creates a five-minute encrypted connector code, and redirects to ChatGPT.
6. ChatGPT exchanges that code at `/token` using its PKCE verifier. The connector returns an authenticated, encrypted access token containing the minimum session context.
7. Every `/mcp` request decrypts and validates the token, expiry, scope context, and resource before calling Splitwise.

Dynamic client registrations, connector codes, and 30-day access tokens are stateless AES-256-GCM envelopes derived from `SESSION_SECRET`. They survive sleeping, restarts, redeploys, and multiple replicas as long as every instance keeps the same secret. Rotating `SESSION_SECRET` intentionally invalidates every existing registration and connection. This sample does not issue refresh tokens, so relinking is required after 30 days.

## 4. Test and connect to ChatGPT

Run:

```bash
npm run build
npm test
npx @modelcontextprotocol/inspector@latest
```

In the Inspector choose **Streamable HTTP** and use `https://YOUR-CONNECTOR-HOST/mcp`.

In ChatGPT, enable Developer mode under **Settings → Security and login**. In the Plugins page, add a connection, choose the public endpoint option, and enter `https://YOUR-CONNECTOR-HOST/mcp`. Review the five discovered tools, then invoke a read tool to start account linking.

Suggested checks:

- “List my Splitwise groups.”
- “Show balances with my Splitwise friends.”
- “List the latest five expenses in group 123.”
- “Get full details for expense 456.”
- “Create a $24 USD dinner expense in group 123, split equally.”

## Production notes

The runnable server stores no OAuth session state. Before a larger multi-user deployment:

- Keep `SESSION_SECRET` stable, secret, and identical across replicas. For stronger key management, derive or retrieve the encryption key from a managed KMS; never log tokens or secrets.
- Stateless authorization codes cannot be marked consumed without storage. PKCE, exact client/redirect/resource binding, authenticated encryption, and the five-minute lifetime limit replay exposure. If strict single-use enforcement is required, add a short-lived shared replay cache keyed by a code identifier.
- Restrict dynamic-registration redirect URIs to the exact ChatGPT callback URLs shown by the app management page (plus explicitly configured development callbacks).
- Add rate limiting, structured security logs, secret rotation, a privacy policy, and token revocation/account unlinking.
- Preserve the `resource` binding, PKCE verification, short code lifetime, and exact redirect-URI matching.
- Run behind HTTPS. Do not expose this development server directly to the internet.

The `create_expense` tool is marked as a non-idempotent write. Its instructions tell the model to summarize the exact amount, currency, group, payer, and shares before calling it. Splitwise can return HTTP 200 with an application-level `errors` object, so the connector checks that object before reporting success.
