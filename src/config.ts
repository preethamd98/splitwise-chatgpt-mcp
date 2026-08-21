import "dotenv/config";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const publicBaseUrl = required("PUBLIC_BASE_URL").replace(/\/$/, "");
  const sessionSecret = required("SESSION_SECRET");
  if (sessionSecret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");

  return {
    port: Number(process.env.PORT ?? "3000"),
    publicBaseUrl,
    resource: `${publicBaseUrl}/mcp`,
    splitwiseClientId: required("SPLITWISE_CLIENT_ID"),
    splitwiseClientSecret: required("SPLITWISE_CLIENT_SECRET"),
    sessionSecret,
    splitwiseAuthorizeUrl: process.env.SPLITWISE_AUTHORIZE_URL ?? "https://secure.splitwise.com/oauth/authorize",
    splitwiseTokenUrl: process.env.SPLITWISE_TOKEN_URL ?? "https://secure.splitwise.com/oauth/token",
    splitwiseApiBaseUrl: (process.env.SPLITWISE_API_BASE_URL ?? "https://secure.splitwise.com/api/v3.0").replace(/\/$/, ""),
  };
}
