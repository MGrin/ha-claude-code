#!/usr/bin/env bun
/**
 * Home Assistant MCP Server
 * Exposes HA API as tools for Claude Code via the Model Context Protocol.
 * Uses the Supervisor API with SUPERVISOR_TOKEN for authentication.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const HA_URL = "http://supervisor/core/api";
const SUPERVISOR_URL = "http://supervisor";
const TOKEN = process.env.SUPERVISOR_TOKEN || "";

async function haFetch(
  path: string,
  options: { method?: string; body?: unknown; supervisor?: boolean } = {},
) {
  const base = options.supervisor ? SUPERVISOR_URL : HA_URL;
  const res = await fetch(`${base}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HA API ${res.status}: ${text}`);
  }
  return res.json();
}

const server = new McpServer({
  name: "home-assistant",
  version: "0.3.0",
});

// ── States ─────────────────────────────────────────────────

server.tool(
  "ha_get_states",
  "Get all entity states from Home Assistant. Returns entity_id, state, and attributes for every entity. Can filter by domain (e.g. 'light', 'sensor', 'automation').",
  { domain: z.string().optional().describe("Filter by entity domain (e.g. 'light', 'sensor', 'climate', 'automation')") },
  async ({ domain }) => {
    const states = await haFetch("/states");
    const filtered = domain
      ? states.filter((s: any) => s.entity_id.startsWith(domain + "."))
      : states;
    const summary = filtered.map((s: any) => ({
      entity_id: s.entity_id,
      state: s.state,
      friendly_name: s.attributes?.friendly_name,
      attributes: s.attributes,
    }));
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  },
);

server.tool(
  "ha_get_state",
  "Get the state and attributes of a specific entity.",
  { entity_id: z.string().describe("Entity ID (e.g. 'light.kitchen', 'sensor.temperature_sensor')") },
  async ({ entity_id }) => {
    const state = await haFetch(`/states/${entity_id}`);
    return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
  },
);

// ── Services ───────────────────────────────────────────────

server.tool(
  "ha_call_service",
  "Call a Home Assistant service. IMPORTANT: Always use entity_id to target specific entities, NOT area_id. Use ha_get_states to find the right entity_ids first. Examples: entity_id='light.kitchen_switch_switch_2' to control a specific light.",
  {
    domain: z.string().describe("Service domain (e.g. 'light', 'switch', 'climate', 'vacuum', 'automation')"),
    service: z.string().describe("Service name (e.g. 'turn_on', 'turn_off', 'toggle', 'start', 'trigger')"),
    entity_id: z.union([z.string(), z.array(z.string())]).describe("Target entity ID or array of entity IDs. REQUIRED — always specify which entity to control. Use ha_get_states to find entity IDs."),
    data: z.record(z.unknown()).optional().describe("Additional service data (e.g. {brightness: 255, color_temp: 400}). Do NOT put entity_id or area_id here."),
  },
  async ({ domain, service, entity_id, data }) => {
    const body: Record<string, unknown> = { ...(data || {}) };
    // Ensure entity_id is in the body, not nested in data
    body.entity_id = entity_id;
    // Remove area_id if accidentally passed — REST API doesn't support it
    delete body.area_id;
    const result = await haFetch(`/services/${domain}/${service}`, {
      method: "POST",
      body,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "ha_get_services",
  "List all available services in Home Assistant, optionally filtered by domain.",
  { domain: z.string().optional().describe("Filter by domain (e.g. 'light', 'climate')") },
  async ({ domain }) => {
    const services = await haFetch("/services");
    const filtered = domain
      ? services.filter((s: any) => s.domain === domain)
      : services;
    return { content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }] };
  },
);

// ── Automations ────────────────────────────────────────────

server.tool(
  "ha_create_automation",
  "Create a new automation in Home Assistant.",
  {
    automation_id: z.string().describe("Unique automation ID (snake_case, e.g. 'morning_lights')"),
    config: z.object({
      alias: z.string().describe("Human-readable name"),
      description: z.string().optional(),
      triggers: z.array(z.record(z.unknown())),
      conditions: z.array(z.record(z.unknown())).optional(),
      actions: z.array(z.record(z.unknown())),
      mode: z.string().optional(),
    }),
  },
  async ({ automation_id, config }) => {
    const result = await haFetch(
      `/config/automation/config/${automation_id}`,
      { method: "POST", body: config },
    );
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Dashboards ─────────────────────────────────────────────

server.tool(
  "ha_get_dashboard",
  "Get the Lovelace dashboard configuration. Use url_path for specific dashboards (null for default).",
  { url_path: z.string().nullable().optional().describe("Dashboard URL path (null for default, or e.g. 'guest-home', 'dashboard-development')") },
  async ({ url_path }) => {
    // Dashboard config requires WebSocket, use supervisor proxy
    // Actually we can use the REST API indirectly by fetching from HA
    // For now, return a helpful message about using WebSocket
    return {
      content: [{
        type: "text",
        text: "Dashboard configuration requires the WebSocket API. Use the Bash tool to run a Python script with websockets to fetch/update dashboard configs. The SUPERVISOR_TOKEN env var is available for authentication. Example endpoint: wss://localhost:8123/api/websocket",
      }],
    };
  },
);

// ── Config ─────────────────────────────────────────────────

server.tool(
  "ha_get_config",
  "Get Home Assistant configuration (version, location, units, components, etc.).",
  {},
  async () => {
    const config = await haFetch("/config");
    return { content: [{ type: "text", text: JSON.stringify(config, null, 2) }] };
  },
);

// ── Events ─────────────────────────────────────────────────

server.tool(
  "ha_fire_event",
  "Fire a Home Assistant event.",
  {
    event_type: z.string().describe("Event type to fire"),
    event_data: z.record(z.unknown()).optional().describe("Event data"),
  },
  async ({ event_type, event_data }) => {
    const result = await haFetch(`/events/${event_type}`, {
      method: "POST",
      body: event_data || {},
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Supervisor ─────────────────────────────────────────────

server.tool(
  "ha_addon_info",
  "Get information about a Home Assistant add-on.",
  { slug: z.string().describe("Add-on slug (e.g. 'core_ssh', '67c731ca_claude-code')") },
  async ({ slug }) => {
    const info = await haFetch(`/addons/${slug}/info`, { supervisor: true });
    return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
  },
);

server.tool(
  "ha_supervisor_info",
  "Get Home Assistant Supervisor and host system information.",
  {},
  async () => {
    const [host, supervisor] = await Promise.all([
      haFetch("/host/info", { supervisor: true }),
      haFetch("/supervisor/info", { supervisor: true }),
    ]);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ host, supervisor }, null, 2),
      }],
    };
  },
);

// ── Start ──────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("HA MCP server error:", err);
  process.exit(1);
});
