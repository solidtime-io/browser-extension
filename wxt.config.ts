import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-vue"],
  manifest: {
    permissions: ["storage", "identity"],
    host_permissions: ["<all_urls>"],
    name: "Solidtime",
    description:
      "Browser extension for Solidtime - the modern open-source time tracker",
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
    browser_specific_settings: {
      gecko: {
        id: "hello@solidtime.io",
        data_collection_permissions: {
          required: [
            "personallyIdentifyingInfo",
            "authenticationInfo",
            "websiteContent",
          ],
          optional: ["technicalAndInteraction"],
        },
      },
    },
  },
  webExt: {
    disabled: false,
  },
});
