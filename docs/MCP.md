# Cinekive MCP (Pro)

External AI agents (Cursor, Claude Desktop, OpenClaw, …) can drive your **local** archive through the Model Context Protocol.

In-app **Craft chat** (left sidebar) is available to everyone with a local VLM — MCP is the Pro bridge for your own agents.

## Install (ships with Pro / source)

```bash
pip install -e packages/cinekive-mcp
```

Ensure the API is up (`http://127.0.0.1:8000`) and Pro is active — activate a Gumroad
or trial key under **Settings → Cinekive Pro**. For local development only, you can
set `CINEKIVE_TIER=pro` together with `CINEKIVE_ALLOW_DEV_LICENSE=true`; packaged
builds disable that path.

## Client config

```json
{
  "mcpServers": {
    "cinekive": {
      "command": "cinekive-mcp",
      "env": {
        "CINEKIVE_API_URL": "http://127.0.0.1:8000"
      }
    }
  }
}
```

## Tools

- `library_summary` — inventory
- `list_projects` — ids / kinds
- `search_shots` — hybrid search
- `agent_query` — Agent API NL routing
- `craft_chat` — same tool router as the sidebar
- `create_moodboard` — pitch → canvas board

Package readme: [packages/cinekive-mcp/README.md](../packages/cinekive-mcp/README.md)

Related: [AGENT_API.md](AGENT_API.md)
