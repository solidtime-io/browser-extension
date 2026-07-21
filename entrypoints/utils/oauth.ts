import { computed, ref, watch } from "vue";

const DEFAULT_ENDPOINT = "https://app.solidtime.io";
const DEFAULT_CLIENT_ID = "019b27e8-a52a-71d8-8d67-071cff97f315";

// Instance settings must live in extension storage (browser.storage), NOT in
// localStorage: content scripts share localStorage with the host page (e.g.
// *.atlassian.net), where these keys never exist — so API calls made from
// injected buttons would silently go to the default cloud endpoint instead of
// the configured self-hosted instance.
export const endpoint = ref(DEFAULT_ENDPOINT);
export const clientId = ref(DEFAULT_CLIENT_ID);

// Resolves once the persisted settings have been read; contexts that make API
// calls right after startup (content scripts) should await this.
export const settingsLoaded = (async () => {
  const result = await browser.storage.local.get([
    "instance_endpoint",
    "instance_client_id",
  ]);
  let storedEndpoint =
    typeof result.instance_endpoint === "string" ? result.instance_endpoint : "";
  let storedClientId =
    typeof result.instance_client_id === "string"
      ? result.instance_client_id
      : "";

  // Migrate settings that a previous version stored in the extension page's
  // localStorage. Only extension pages (popup) may do this — a content
  // script's localStorage belongs to the host page.
  if (
    !storedEndpoint &&
    !storedClientId &&
    (location.protocol === "chrome-extension:" ||
      location.protocol === "moz-extension:")
  ) {
    storedEndpoint = window.localStorage.getItem("instance_endpoint") || "";
    storedClientId = window.localStorage.getItem("instance_client_id") || "";
    if (storedEndpoint || storedClientId) {
      await browser.storage.local.set({
        instance_endpoint: storedEndpoint || DEFAULT_ENDPOINT,
        instance_client_id: storedClientId || DEFAULT_CLIENT_ID,
      });
    }
  }

  if (storedEndpoint) {
    endpoint.value = storedEndpoint;
  }
  if (storedClientId) {
    clientId.value = storedClientId;
  }
})();

// Persist settings whenever they are changed (e.g. from the settings modal)
watch([endpoint, clientId], async ([newEndpoint, newClientId]) => {
  await browser.storage.local.set({
    instance_endpoint: newEndpoint,
    instance_client_id: newClientId,
  });
});

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

// Watch for storage changes (from background script or other contexts)
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.access_token) {
      accessToken.value = changes.access_token.newValue || "";
    }
    if (changes.refresh_token) {
      refreshToken.value = changes.refresh_token.newValue || "";
    }
    if (changes.instance_endpoint) {
      const newEndpoint = changes.instance_endpoint.newValue;
      endpoint.value =
        typeof newEndpoint === "string" && newEndpoint
          ? newEndpoint
          : DEFAULT_ENDPOINT;
    }
    if (changes.instance_client_id) {
      const newClientId = changes.instance_client_id.newValue;
      clientId.value =
        typeof newClientId === "string" && newClientId
          ? newClientId
          : DEFAULT_CLIENT_ID;
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
