# Solidtime Browser Extension

The official browser extension for [Solidtime](https://www.solidtime.io) - the modern open-source time tracker.

Track time directly from your project management tools with seamless integration into Linear, Jira, and Plane.

## Download

- **Chrome/Edge/Brave:** [Chrome Web Store](https://chromewebstore.google.com/detail/solidtime/hpanifeankiobmgbemnhjmhpjeebdhdd)
- **Firefox:** [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/solidtime/)

## Features

- ⏱️ **Quick Time Tracking** - Start and stop timers directly from issue pages
- 🔗 **Platform Integration** - Works seamlessly with Linear, Jira, and Plane
- 🎯 **Issue Context** - Automatically captures issue IDs and titles in your time entries
- 🏢 **Organization Management** - Switch between multiple organizations
- 🔒 **Secure OAuth** - Safe authentication with PKCE
- 🌐 **Self-Hosted Support** - Connect to your own Solidtime instance

## Supported Platforms

| Platform | Tracker Position |
| --- | ----------- |
| Linear |<img  alt="Screenshot 2025-12-17 at 16 13 10" src="https://github.com/user-attachments/assets/3324196b-61f7-4b66-b2af-b7007de7e3a6" /> |
| Jira | <img alt="Screenshot 2025-12-17 at 16 22 20" src="https://github.com/user-attachments/assets/d3d24ff0-6a87-44cc-a7f6-0fce459a5456" /> |
| Plane | <img alt="Screenshot 2025-12-17 at 16 23 54" src="https://github.com/user-attachments/assets/716570b8-7f30-4475-9f42-403ae5894b2e" /> |


More coming soon!

## Setup

### For Self-Hosted Instances

If you're using a self-hosted Solidtime instance, see the [Docker setup guide](https://docs.solidtime.io/self-hosting/guides/docker) for instructions on configuring browser extension access.

## Development

### Prerequisites

- Node.js 18+
- npm or pnpm

### Installation

```bash
npm install
```

### Development

```bash
# Chrome
npm run dev

# Firefox
npm run dev:firefox
```

### Build

```bash
# Chrome
npm run build

# Firefox
npm run build:firefox
```

## License

See the main [Solidtime repository](https://github.com/solidtime-io/solidtime) for license information.
