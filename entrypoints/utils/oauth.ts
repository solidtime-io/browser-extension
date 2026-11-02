import { computed, ref, watch } from "vue";
import { createApiClient } from "@solidtime/api";

// Backed by browser.storage.local so content scripts see the same values as
// the popup (localStorage is per origin and would not be shared)
function useExtensionStorage(key: string, defaultValue: string) {
  const state = ref(defaultValue);
  let known = defaultValue;

  const isExtensionPage = location.href.startsWith(browser.runtime.getURL(""));

  browser.storage.local.get(key).then((result) => {
    let value = result[key] as string | undefined;
    // One-time migration of values saved in the popup's localStorage
    if (value === undefined && isExtensionPage) {
      const legacy = localStorage.getItem(key);
      if (legacy) {
        value = legacy;
        browser.storage.local.set({ [key]: legacy });
      }
    }
    if (value) {
      known = value;
      state.value = value;
    }
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[key]) {
      const value =
        (changes[key].newValue as string | undefined) || defaultValue;
      known = value;
      state.value = value;
    }
  });

  watch(state, (value) => {
    if (value !== known) {
      known = value;
      browser.storage.local.set({ [key]: value });
    }
  });

  return state;
}

export const endpoint = useExtensionStorage(
  "instance_endpoint",
  "https://app.solidtime.io",
);
export const clientId = useExtensionStorage(
  "instance_client_id",
  "019b27e8-a52a-71d8-8d67-071cff97f315",
);

// Use chrome.storage for tokens (survives popup closing)
export const accessToken = ref("");
export const refreshToken = ref("");
// "api_token" for a personal API token, empty for OAuth
export const authMode = ref("");

// Load tokens from chrome.storage on init
async function loadTokens() {
  const result = await browser.storage.local.get([
    "access_token",
    "refresh_token",
    "auth_mode",
  ]);
  accessToken.value = result.access_token || "";
  refreshToken.value = result.refresh_token || "";
  authMode.value = (result.auth_mode as string | undefined) || "";
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
    if (changes.auth_mode) {
      authMode.value = (changes.auth_mode.newValue as string | undefined) || "";
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

  if (authMode.value === "api_token") {
    // API tokens cannot be refreshed
    await logout();
    throw new Error("Token is invalid or expired, enter a new one");
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

export async function loginWithApiToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("Enter an API token");
  }

  // Validate against the configured endpoint before saving anything
  const client = createApiClient(endpoint.value + "/api", {
    validate: "none",
    axiosConfig: { headers: { Authorization: `Bearer ${trimmed}` } },
  });
  try {
    await client.getMyMemberships({});
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response
      ?.status;
    throw new Error(
      status === 401
        ? "Token is invalid or expired, enter a new one"
        : "Could not verify the token, check the instance URL",
    );
  }

  await browser.storage.local.remove("refresh_token");
  await browser.storage.local.set({
    access_token: trimmed,
    auth_mode: "api_token",
  });
  refreshToken.value = "";
  authMode.value = "api_token";
  accessToken.value = trimmed;
}

export async function logout() {
  accessToken.value = "";
  refreshToken.value = "";
  authMode.value = "";
  await browser.storage.local.remove([
    "access_token",
    "refresh_token",
    "auth_mode",
  ]);
}
