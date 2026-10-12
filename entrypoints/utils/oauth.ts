import { computed, ref } from "vue";

const defaultEndpoint = "https://app.solidtime.io";
const defaultClientId = "019b27e8-a52a-71d8-8d67-071cff97f315";
export const endpoint = ref(defaultEndpoint);
export const clientId = ref(defaultClientId);

// Use chrome.storage for tokens (survives popup closing)
export const accessToken = ref("");
export const refreshToken = ref("");

const sessionKeys = [
  "instance_endpoint",
  "instance_client_id",
  "access_token",
  "refresh_token",
];

async function loadSession() {
  const result = await browser.storage.local.get(sessionKeys);
  // Only extension pages may migrate settings; content scripts share the website's localStorage.
  if (
    !result.instance_endpoint &&
    ["chrome-extension:", "moz-extension:"].includes(window.location.protocol)
  ) {
    result.instance_endpoint = localStorage.getItem("instance_endpoint") || defaultEndpoint;
    result.instance_client_id = localStorage.getItem("instance_client_id") || defaultClientId;
    await browser.storage.local.set({
      instance_endpoint: result.instance_endpoint,
      instance_client_id: result.instance_client_id,
    });
  }

  endpoint.value = typeof result.instance_endpoint === "string" ? result.instance_endpoint : defaultEndpoint;
  clientId.value = typeof result.instance_client_id === "string" ? result.instance_client_id : defaultClientId;
  refreshToken.value = typeof result.refresh_token === "string" ? result.refresh_token : "";
  // Wait for the popup to migrate settings before exposing existing tokens to content scripts.
  accessToken.value = result.instance_endpoint && typeof result.access_token === "string" ? result.access_token : "";
}

// Watch for storage changes (from background script)
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && sessionKeys.some((key) => key in changes)) {
    void loadSession().catch(console.error);
  }
});

// Initialize
export const authReady = loadSession();

export async function saveInstanceSettings(newEndpoint: string, newClientId: string) {
  await authReady;
  const changed = newEndpoint !== endpoint.value || newClientId !== clientId.value;
  await browser.storage.local.set({
    instance_endpoint: newEndpoint,
    instance_client_id: newClientId,
    ...(changed ? { access_token: "", refresh_token: "" } : {}),
  });
  await loadSession();
}

// Use browser.identity.getRedirectURL() which works for both Firefox and Chrome
export const getRedirectUrl = () => browser.identity.getRedirectURL();

export const isLoggedIn = computed(() => !!accessToken.value);

let refreshPromise: Promise<void> | null = null;

export async function refreshAccessToken(): Promise<void> {
  await authReady;
  if (refreshPromise) {
    return refreshPromise;
  }

  const currentRefreshToken = refreshToken.value;
  if (!currentRefreshToken) {
    accessToken.value = "";
    refreshToken.value = "";
    await browser.storage.local.remove(["access_token", "refresh_token"]);
    throw new Error("No refresh token available - user logged out");
  }

  refreshPromise = (async () => {
    try {
      const response = await browser.runtime.sendMessage({
        type: "REFRESH_TOKEN",
        payload: {
          endpoint: endpoint.value,
          clientId: clientId.value,
          refreshToken: currentRefreshToken,
        },
      });

      if (!response.success) {
        throw new Error(response.error || "Failed to refresh token");
      }

      // Update tokens
      await browser.storage.local.set({
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
      });

      accessToken.value = response.data.access_token;
      refreshToken.value = response.data.refresh_token;
    } catch (error) {
      accessToken.value = "";
      refreshToken.value = "";
      await browser.storage.local.remove(["access_token", "refresh_token"]);
      throw error;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function startOAuthFlow(): Promise<void> {
  await authReady;
  return new Promise((resolve, reject) => {
    browser.runtime.sendMessage(
      {
        type: "START_OAUTH_FLOW",
        payload: {
          endpoint: endpoint.value,
          clientId: clientId.value,
        },
      },
      (response) => {
        if (browser.runtime.lastError) {
          reject(new Error(browser.runtime.lastError.message));
          return;
        }

        if (!response.success) {
          reject(new Error(response.error || "OAuth failed"));
          return;
        }

        resolve();
      },
    );
  });
}

export async function logout() {
  accessToken.value = "";
  refreshToken.value = "";
  await browser.storage.local.remove(["access_token", "refresh_token"]);
}
