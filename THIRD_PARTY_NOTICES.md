# Third-party notices

The MIT license in this repository covers Cinekive's own source code. It does not cover the items below. Shipping a build means shipping these too, under their own terms.

| Piece | Role | Terms |
|-------|------|--------|
| PyTorch, torchvision | Embeddings and local models | BSD-style / PyTorch license |
| Transformers (Hugging Face) | SigLIP and related loaders | Apache-2.0 |
| SigLIP weights | Visual search | Model card on Hugging Face — downloaded on first search, not vendored in git |
| Qdrant | Vector index | Apache-2.0 |
| FastAPI, SQLAlchemy, httpx | API | MIT / BSD |
| yt-dlp | Optional URL ingest | Unlicense |
| FFmpeg | Frames and previews | System binary; LGPL/GPL build depending on how it was compiled. Do not static-link a GPL ffmpeg into a proprietary bundle without checking that build |
| Electron | Desktop shell | MIT |
| Next.js, React | UI | MIT |
| Ollama models (optional) | Local tagging | Each model's license, pulled by the user |
| Public-domain stills in the app | Offline archive-card placeholders | Wikimedia Commons public-domain items. Not a film-still library |
| Lemon Squeezy | License checkout | Their merchant terms. Keys are checked at api.lemonsqueezy.com |

Cinekive does not grant rights in anyone else's footage, stills, or trademarks. Use only media you are authorized to use.
