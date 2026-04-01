# Claude Code for Home Assistant

## Overview

This add-on provides a chat interface to Claude Code directly from your Home Assistant dashboard. Access it from the sidebar on desktop or the Companion App on mobile.

## Setup

### 1. Install the add-on

Add this repository to your Home Assistant add-on store, then install "Claude Code".

### 2. Authenticate

After starting the add-on for the first time, open the add-on's terminal (via SSH or the Terminal & SSH add-on) and run:

```bash
docker exec -it addon_local_claude-code claude login
```

Follow the prompts to authenticate with your Anthropic account (Pro/Max subscription).

### 3. Use it

Click "Claude Code" in the HA sidebar. Start chatting!

## Features

- **Chat UI**: Send messages and get streaming responses with markdown rendering
- **Multi-session**: Create and switch between multiple conversations
- **Tool use**: Claude can read/edit files, run commands — tool usage is shown as collapsible blocks
- **Usage meter**: See your 5-hour and 7-day subscription usage in the header
- **Mobile-friendly**: Works from the HA Companion App on your phone
- **Remote access**: Works through Cloudflare Tunnel or any HA remote access method

## Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `working_directory` | Directory Claude Code works in | `/config` |

## Working Directory

By default, Claude Code operates on your Home Assistant `/config` directory. This means it can read and modify your HA configuration files, automations, scripts, etc.
