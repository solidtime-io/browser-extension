export default defineBackground(() => {
  // OAuth state
  let oauthState = "";
  let oauthVerifier = "";
  let oauthChallenge = "";

  // Helper functions
  function sha256(plain: string) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return crypto.subtle.digest("SHA-256", data);
  }

  function base64urlencode(a: ArrayBuffer) {
    let str = "";
    const bytes = new Uint8Array(a);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function createRandomString(num: number) {
    return [...Array(num)].map(() => Math.random().toString(36)[2]).join("");
  }

  // Listen for messages from popup or content scripts
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "START_OAUTH_FLOW") {
      // Handle entire OAuth flow in background
      const { endpoint, clientId } = message.payload;

      (async () => {
        try {
          // Initialize PKCE
          oauthState = createRandomString(40);
          oauthVerifier = createRandomString(128);
          const hashed = await sha256(oauthVerifier);
          oauthChallenge = base64urlencode(hashed);

          const redirectUrl = browser.identity.getRedirectURL();
          const loginUrl =
            endpoint +
            "/oauth/authorize?client_id=" +
            clientId +
            "&redirect_uri=" +
            encodeURIComponent(redirectUrl) +
            "&response_type=code&state=" +
            oauthState +
            "&code_challenge=" +
            oauthChallenge +
            "&code_challenge_method=S256&scope=*";

          // Launch OAuth flow
          browser.identity.launchWebAuthFlow(
            {
              url: loginUrl,
              interactive: true,
            },
            async (responseUrl) => {
              if (browser.runtime.lastError) {
                console.error("OAuth error:", browser.runtime.lastError);
                sendResponse({
                  success: false,
                  error: browser.runtime.lastError.message || "OAuth failed",
                });
                return;
              }

              if (!responseUrl) {
                sendResponse({ success: false, error: "No response URL" });
                return;
              }

              try {
                const url = new URL(responseUrl);
                const code = url.searchParams.get("code");
                const responseState = url.searchParams.get("state");
                const error = url.searchParams.get("error");

                if (error) {
                  throw new Error(`OAuth error: ${error}`);
                }

                if (responseState !== oauthState || !code) {
                  throw new Error("Invalid state or missing code");
                }

                // Exchange code for tokens
                const tokenResponse = await fetch(endpoint + "/oauth/token", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                  },
                  body: new URLSearchParams({
                    grant_type: "authorization_code",
                    client_id: clientId,
                    redirect_uri: redirectUrl,
                    code_verifier: oauthVerifier,
                    code: code,
                  }),
                });

                if (!tokenResponse.ok) {
                  throw new Error("Token exchange failed");
                }

                const tokens = await tokenResponse.json();

                // Store tokens in chrome.storage
                await browser.storage.local.set({
                  access_token: tokens.access_token,
                  refresh_token: tokens.refresh_token,
                });

                sendResponse({
                  success: true,
                  data: {
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                  },
                });
              } catch (error) {
                console.error("OAuth error:", error);
                sendResponse({
                  success: false,
                  error:
                    error instanceof Error ? error.message : "Unknown error",
                });
              }
            },
          );
        } catch (error) {
          console.error("OAuth initialization error:", error);
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      })();

      return true; // Will respond asynchronously
    }

    if (message.type === "REFRESH_TOKEN") {
      const { endpoint, clientId, refreshToken } = message.payload;

      fetch(endpoint + "/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: refreshToken,
        }),
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error("Failed to refresh token");
          }
          return response.json();
        })
        .then((data) => {
          sendResponse({ success: true, data });
        })
        .catch((error) => {
          console.error("Token refresh error:", error);
          sendResponse({ success: false, error: error.message });
        });

      return true;
    }

    return false;
  });
});
