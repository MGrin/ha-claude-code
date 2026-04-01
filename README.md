# Claude Code for Home Assistant

A Home Assistant add-on that provides a chat interface to Claude Code, accessible from the HA sidebar and Companion App.

## Installation

1. Add this repository to your Home Assistant:
   - Go to **Settings** → **Add-ons** → **Add-on Store** → **⋮** → **Repositories**
   - Add: `https://github.com/MGrin/ha-claude-code`
2. Install **Claude Code** from the add-on store
3. Start the add-on
4. Authenticate: run `claude login` in the add-on terminal
5. Click **Claude Code** in the sidebar

## Features

- Chat with Claude Code from your HA dashboard
- Streaming responses with markdown and code highlighting
- Multi-session support
- Subscription usage meter
- Mobile-friendly (works from HA Companion App)
- Remote access via Cloudflare Tunnel or Nabu Casa
