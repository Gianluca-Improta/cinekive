"""Seed starter GitHub Discussions for Cinekive. Run: python scripts/seed_discussions.py"""
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

REPO_ID = "R_kgDOTU_Snw"
CATEGORIES = {
    "announcements": "DIC_kwDOTU_Sn84DA8XI",
    "general": "DIC_kwDOTU_Sn84DA8XJ",
    "ideas": "DIC_kwDOTU_Sn84DA8XL",
    "q-a": "DIC_kwDOTU_Sn84DA8XK",
    "show-and-tell": "DIC_kwDOTU_Sn84DA8XM",
    "polls": "DIC_kwDOTU_Sn84DA8XN",
}

POSTS = [
    {
        "category": "announcements",
        "title": "Welcome to Cinekive — local cinematic archive",
        "body": """\
## Hey

Cinekive is a **local-first** cinematic visual archive: own your frames, search by look/mood/technique, ingest files or yt-dlp URLs, and build moodboards — without renting someone else's library.

### Start here

1. **Download** → https://github.com/Gianluca-Improta/cinekive/releases/latest  
2. Install **Docker Desktop**, start it, open the app  
3. Read the **[FAQ](https://github.com/Gianluca-Improta/cinekive/blob/main/docs/FAQ.md)** if anything is unclear  

### How we use Discussions

| Category | For |
|----------|-----|
| **Ideas** | Product direction, v2 bets |
| **Q&A** | Setup / Docker / search help |
| **Show and tell** | Moodboards & workflows (no private client work) |
| **Announcements** | Releases & project news |

Stars, shares, and honest feedback all help. Glad you're here.
""",
    },
    {
        "category": "announcements",
        "title": "v0.3.3 — languages, taxonomy labels, inspector layout",
        "body": """\
## What's new in v0.3.3

- Full language sweep: search/filters/shot types; **497 Chinese taxonomy labels**
- Inspector open → grid reserves space and drops to ≤3 columns
- Desktop installers for **Windows / macOS (arm64 + Intel) / Linux**

**Download:** https://github.com/Gianluca-Improta/cinekive/releases/tag/v0.3.3

Questions or bugs after upgrading? Drop them in Q&A or open an Issue.
""",
    },
    {
        "category": "ideas",
        "title": "Vote: what should we prioritize next?",
        "body": """\
Nothing here is locked — react with emojis so we can see demand:

| React | Priority |
|-------|----------|
| 🐳 | **No-Docker desktop** (biggest install unlock) |
| ✍️ | Signed builds + auto-update |
| 🎨 | Richer moodboard (resize, video loops, PDF refs) |
| 📋 | Brief → auto-laid moodboard |
| 🔌 | Resolve / Premiere panel |
| 🌐 | More UI languages / translations |

Comment with your workflow (editor? commercial? student?) so we don't optimize for the wrong person.

Roadmap doc: https://github.com/Gianluca-Improta/cinekive/blob/main/docs/ROADMAP.md
""",
    },
    {
        "category": "q-a",
        "title": "Getting started — Docker, Gatekeeper, first search",
        "body": """\
## Common blockers

**Docker must be running** before Start. That's the search engine for now.

**macOS:** unsigned build → right-click the app → Open (once).

**Windows SmartScreen:** More info → Run anyway (unsigned).

**First search downloads SigLIP (~800 MB)** — one-time.

More answers: [FAQ](https://github.com/Gianluca-Improta/cinekive/blob/main/docs/FAQ.md)

Reply here with OS + version if you're stuck — screenshots of the error help.
""",
    },
    {
        "category": "show-and-tell",
        "title": "Show your board / archive setup",
        "body": """\
Share a moodboard, shelf layout, or filter recipe that worked for a job (or a personal lookbook).

### Rules of the road

- No private client work  
- No dumping copyrighted still archives  
- Optional: OS, GPU, whether you use Ollama / OpenRouter for craft tags  

Looking forward to seeing how you use it.
""",
    },
    {
        "category": "ideas",
        "title": "Wildcard: Framechain bridge, mobile companion, public shelf?",
        "body": """\
From the README wildcards — which of these would you actually use?

1. **Framechain bridge** — send a board concept → AI video draft on [framechain.ai](https://framechain.ai)  
2. **Mobile companion** — on-set stills capture into the library  
3. **Opt-in public shelf** — share *your* cleared stills only  
4. Something else (comment)

Thumbs / comments welcome. Soft ideas stay here; concrete specs can become Issues later.
""",
    },
]


def create(category: str, title: str, body: str) -> str:
    mutation = """
    mutation($repo:ID!,$cat:ID!,$title:String!,$body:String!){
      createDiscussion(input:{repositoryId:$repo,categoryId:$cat,title:$title,body:$body}){
        discussion{ url number }
      }
    }
    """
    payload = {
        "query": mutation,
        "variables": {
            "repo": REPO_ID,
            "cat": CATEGORIES[category],
            "title": title,
            "body": body,
        },
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(payload, f)
        path = f.name
    try:
        out = subprocess.check_output(["gh", "api", "graphql", "--input", path], text=True)
    finally:
        Path(path).unlink(missing_ok=True)
    data = json.loads(out)
    if data.get("errors"):
        raise RuntimeError(data["errors"])
    d = data["data"]["createDiscussion"]["discussion"]
    return f"#{d['number']} {d['url']}"


def main() -> None:
    for post in POSTS:
        url = create(post["category"], post["title"], post["body"])
        print(url)


if __name__ == "__main__":
    main()
