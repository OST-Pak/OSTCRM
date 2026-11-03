/**
 * Where the API access token comes from.
 * Production: Microsoft Entra ID through MSAL (redirect sign-in, tokens kept in session storage only).
 * End-to-end tests (`vite build --mode e2e`): a token the test harness signed with its fake tenant key and
 * placed on the window. That branch is removed from production builds because MODE is a build-time constant.
 */
import { PublicClientApplication, InteractionRequiredAuthError, type AccountInfo } from "@azure/msal-browser";

export interface Auth {
  getToken(): Promise<string>;
  signOut(): Promise<void>;
}

declare global { interface Window { __E2E_TOKEN__?: string } }

function e2eAuth(): Auth {
  return {
    async getToken() {
      if (!window.__E2E_TOKEN__) throw new Error("No test token");
      return window.__E2E_TOKEN__;
    },
    async signOut() { window.__E2E_TOKEN__ = undefined; }
  };
}

async function msalAuth(): Promise<Auth> {
  const env = import.meta.env;
  const clientId = env.VITE_ENTRA_CLIENT_ID as string | undefined;
  const tenantId = env.VITE_ENTRA_TENANT_ID as string | undefined;
  const scope = env.VITE_API_SCOPE as string | undefined;
  if (!clientId || !tenantId || !scope) throw new Error("Sign-in is not configured (VITE_ENTRA_CLIENT_ID, VITE_ENTRA_TENANT_ID, VITE_API_SCOPE)");
  const msal = new PublicClientApplication({
    auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}`, redirectUri: window.location.origin },
    cache: { cacheLocation: "sessionStorage" }
  });
  await msal.initialize();
  const result = await msal.handleRedirectPromise();
  let account: AccountInfo | null = result?.account ?? msal.getAllAccounts()[0] ?? null;
  if (!account) {
    await msal.loginRedirect({ scopes: [scope] });
    // The browser navigates away; this promise never settles.
    return new Promise(() => undefined);
  }
  msal.setActiveAccount(account);
  return {
    async getToken() {
      try {
        return (await msal.acquireTokenSilent({ scopes: [scope], account: account! })).accessToken;
      } catch (e) {
        if (e instanceof InteractionRequiredAuthError) { await msal.acquireTokenRedirect({ scopes: [scope] }); }
        throw e;
      }
    },
    async signOut() { await msal.logoutRedirect({ account: account! }); account = null; }
  };
}

export async function createAuth(): Promise<Auth> {
  if (import.meta.env.MODE === "e2e") return e2eAuth();
  return msalAuth();
}
