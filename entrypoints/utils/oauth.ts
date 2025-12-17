import { computed, ref } from "vue";
import { useStorage } from "@vueuse/core";

export const endpoint = useStorage(
  "instance_endpoint",
  "https://app.solidtime.io",
);
export const clientId = useStorage(
  "instance_client_id",
  "019b27e8-a52a-71d8-8d67-071cff97f315",
);

// Use chrome.storage for tokens (survives popup closing)
export const accessToken = ref("");
export const refreshToken = ref("");

// Load tokens from chrome.storage on init
async function loadTokens() {
  const result = await browser.storage.local.get([
    "access_token",
    "refresh_token",
  ]);
  accessToken.value = result.access_token || "";
  refreshToken.value = result.refresh_token || "";
}

// Watch for storage changes (from background script)
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.access_token) {
      accessToken.value = changes.access_token.newValue || "";
    }
    if (changes.refresh_token) {
      refreshToken.value = changes.refresh_token.newValue || "";
    }
  }
});

// Initialize
loadTokens();

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
