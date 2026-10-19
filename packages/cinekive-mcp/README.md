# Cinekive MCP (Pro)

Connect Cursor, Claude Desktop, OpenClaw, or any MCP client to your **local** Cinekive API.

## Requirements

- Cinekive API running (`http://127.0.0.1:8000`)
- **Pro** license (or `CINEKIVE_TIER=pro` for self-built)

## Install

From the repo root (ships with Pro / source):

```bash
pip install -e packages/cinekive-mcp
```

## Cursor / Claude Desktop

Add to MCP config (`mcp.json`):

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

| Tool | What it does |
|------|----------------|
| `library_summary` | Projects + frame counts |
| `list_projects` | Project ids / kinds |
| `search_shots` | Hybrid craft search |
| `agent_query` | Agent API NL → filters + search |
| `craft_chat` | Same tool-router as in-app Craft chat |
| `create_moodboard` | Pitch → canvas board on a project |

## In-app chat

Free/Pro: left sidebar **Craft chat** talks to your local VLM (Ollama) and can search / summarize / build moodboards. MCP is the Pro bridge for *external* agents.
