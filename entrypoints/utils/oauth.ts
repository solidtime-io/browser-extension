import { computed, ref, watch } from "vue";

const DEFAULT_ENDPOINT = "https://app.solidtime.io";
const DEFAULT_CLIENT_ID = "019b27e8-a52a-71d8-8d67-071cff97f315";

export const endpoint = ref(DEFAULT_ENDPOINT);
export const clientId = ref(DEFAULT_CLIENT_ID);
export const accessToken = ref("");
export const refreshToken = ref("");

let loaded = false;

// Load instance config + tokens from chrome.storage on init. Exported so
// callers can await it before making the first authenticated request.
export const ready = (async function loadTokens() {
  const result = await browser.storage.local.get([
    "instance_endpoint",
    "instance_client_id",
    "access_token",
    "refresh_token",
  ]);
  endpoint.value = (result.instance_endpoint as string) || DEFAULT_ENDPOINT;
  clientId.value = (result.instance_client_id as string) || DEFAULT_CLIENT_ID;
  accessToken.value = (result.access_token as string) || "";
  refreshToken.value = (result.refresh_token as string) || "";
  loaded = true;
})();

// Persist instance config changes (made in the popup settings modal) back to
// the shared storage so content scripts pick them up.
watch(endpoint, (value) => {
  if (loaded) browser.storage.local.set({ instance_endpoint: value });
});
watch(clientId, (value) => {
  if (loaded) browser.storage.local.set({ instance_client_id: value });
});

// Watch for storage changes (from other contexts / background script)
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.instance_endpoint) {
      endpoint.value =
        (changes.instance_endpoint.newValue as string) || DEFAULT_ENDPOINT;
    }
    if (changes.instance_client_id) {
      clientId.value =
        (changes.instance_client_id.newValue as string) || DEFAULT_CLIENT_ID;
    }
    if (changes.access_token) {
      accessToken.value = (changes.access_token.newValue as string) || "";
    }
    if (changes.refresh_token) {
      refreshToken.value = (changes.refresh_token.newValue as string) || "";
    }
  }
});

// Use browser.identity.getRedirectURL() which works for both Firefox and Chrome
export const getRedirectUrl = () => browser.identity.getRedirectURL();

export const isLoggedIn = computed(() => !!accessToken.value);

let refreshPromise: Promise<void> | null = null;

export async function refreshAccessToken(): Promise<void> {
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
