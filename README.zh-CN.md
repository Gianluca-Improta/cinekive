# Cinekive

**你的电影视觉档案。本地。可搜。属于你。**

拖入一部电影、静帧文件夹，或粘贴链接。Cinekive 找出英雄帧、标注技法，
让你按画面感、导演、手法或情绪找到那一帧——不用 scrub 时间线，也不用租别人的片库。

灵感来自 FilmGrab、EyeCandy、Flim & Kive。跑在**你自己的机器**上。

<p align="center">
  <img src="docs/showcase/frame-6.jpg" width="32%" alt="电影静帧" />
  <img src="docs/showcase/frame-3.jpg" width="32%" alt="档案静帧" />
  <img src="docs/showcase/frame-1.jpg" width="32%" alt="档案静帧" />
</p>

<p align="center">
  <a href="https://github.com/Gianluca-Improta/cinekive/releases"><img src="https://img.shields.io/github/v/release/Gianluca-Improta/cinekive?label=release" alt="Release" /></a>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License" />
  <img src="https://img.shields.io/badge/data-stays%20on%20your%20disk-success" alt="Local" />
  <a href="https://github.com/Gianluca-Improta/cinekive/discussions"><img src="https://img.shields.io/badge/discussions-加入讨论-purple" alt="Discussions" /></a>
  <a href="README.md"><img src="https://img.shields.io/badge/docs-English-informational" alt="English README" /></a>
</p>

<p align="center">
  <a href="#下载">下载</a> ·
  <a href="#三步安装">三步安装</a> ·
  <a href="#界面语言">界面语言</a> ·
  <a href="#功能概览">功能概览</a> ·
  <a href="docs/FAQ.md">FAQ（英文）</a> ·
  <a href="docs/COMPARE.md">对比其他工具</a> ·
  <a href="#加入讨论">加入讨论</a>
</p>

---

## 下载

**[→ 下载 Windows / Mac / Linux 桌面版](https://github.com/Gianluca-Improta/cinekive/releases/latest)**

| 平台 | 下载哪个文件 |
|------|----------------|
| **Windows** | `Cinekive-*-win-x64.exe`（安装包）或 `*-portable.exe`（绿色版） |
| **macOS** | `Cinekive-*-mac-arm64.dmg`（Apple Silicon）或 `*-mac-x64.dmg`（Intel） |
| **Linux** | `Cinekive-*.AppImage`（直接运行）或 `.deb` |

## 三步安装

1. 从 [Releases](https://github.com/Gianluca-Improta/cinekive/releases/latest) 下载对应系统的安装包  
2. 打开 Cinekive → 选择片库文件夹 → **Start / 启动**  
3. **Windows 无 Docker：** 首次启动自动下载原生引擎（约 2 GB）。**有 Docker：** 可先安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)

日常使用不需要敲命令行。

> **macOS：** 首次打开可能需要右键 → 打开（未签名构建）。  
> **Linux AppImage：** `chmod +x Cinekive-*.AppImage && ./Cinekive-*.AppImage`

无 Docker 的引擎方案还在推进中（见 [docs/PACKAGING.md](docs/PACKAGING.md)）。目前 Docker Desktop 是唯一额外依赖。

### 更想用浏览器？

```powershell
.\scripts\bootstrap.ps1   # Windows
```

```bash
./scripts/bootstrap.sh    # macOS / Linux
```

然后打开 http://localhost:3000

---

## 界面语言

应用内置多语言界面（顶栏语言按钮，或 **设置 → 语言**）：

| 语言 | 覆盖程度 |
|------|----------|
| English | 完整 |
| **中文** | 强（导航、发现、收藏、检视器、筛选、回收站、导览、设置等） |
| Español | 强 |
| Français / Deutsch / 日本語 | 部分（缺的键回退英文） |

打开 **自动翻译内容** 后，镜头的情绪、备注、对白、标签等会尽量翻成你选的语言。

浏览器首次访问若系统语言是中文，会自动选中中文。

---

## 截图

<p align="center">
  <img src="docs/showcase/ui-library.png" width="90%" alt="档案网格" />
</p>
<p align="center"><em>浏览档案 — 英雄帧、技法筛选、FilmGrab / ShotDeck / 自有导入</em></p>

<p align="center">
  <img src="docs/showcase/ui-discovery.png" width="90%" alt="发现页" />
</p>
<p align="center"><em>发现 — 按画面、技法、情绪找帧</em></p>

<p align="center">
  <img src="docs/showcase/ui-moodboard.png" width="90%" alt="情绪板" />
</p>
<p align="center"><em>情绪板 — 拖入项目素材、便利贴、文字、堆叠、命名概念</em></p>

---

## 功能概览（v0.4）

- **Windows 可无 Docker** — 自动模式在无 Docker 时下载原生引擎包
- **GHCR 预构建镜像** — Docker 用户优先拉取镜像，减少本地构建

- **叙事 / 广告 / 社媒** — 导入自有素材（拖文件或任意 yt-dlp 链接）
- **档案库** — FilmGrab、EyeCandy、ShotDeck、MovieStillsDB、StillsLab 镜像 + 发现更多来源
- **搜索** — 片名、导演、技法、年代、画面感（SigLIP + 元数据）
- **多语言** — 界面 EN / 中文 / ES / FR / DE / JA；景别与技法等中文标签
- **检视器 + 全屏面板** — 默认侧栏检视；点击画面进入大舞台
- **情绪板** — 无限画布、项目素材轨、文字/便利贴/音视频链接、概念组、堆叠
- **桌面或浏览器** — Win / Mac / Linux 应用，或 `:3000` 网页
- **本地优先** — 无需云账号；可选临时分享链接

---

## 为什么做这个

| 以前 | 用 Cinekive |
|------|-------------|
| 永远收藏 FilmGrab | 静帧落在自己硬盘上 |
| 在 Resolve 里 scrub「那一晚霓虹」 | 直接搜。SigLIP + 技法筛选 |
| Brief 写在 AI 看不见的文档里 | Brief 挂在项目上 |
| 一个终端 yt-dlp，另一个终端导入 | 粘贴链接 → 下载 → 导入 |
| 情绪板散落各工具 | 按项目画布：堆叠、概念、备注、音频 |

---

## 快速开始（开发者）

```powershell
git clone https://github.com/Gianluca-Improta/cinekive.git
cd cinekive
.\scripts\bootstrap.ps1
```

```bash
git clone https://github.com/Gianluca-Improta/cinekive.git
cd cinekive
./scripts/bootstrap.sh
```

打开 **http://localhost:3000**。需要 Docker Desktop。首次搜索可能下载 SigLIP（约 800 MB）。

媒体从不进仓库。`data/` 已 gitignore。把 `LIBRARY_HOST_PATH` 指到任意盘即可。

完整英文文档：[README.md](README.md) · 桌面说明：[docs/DESKTOP.md](docs/DESKTOP.md) · 指南：[docs/GUIDE.md](docs/GUIDE.md)

---

## 路线图 / v2

欢迎在 [Discussions](https://github.com/Gianluca-Improta/cinekive/discussions) 投票与讨论。可能方向包括：无 Docker 桌面、更强画布、Brief → 自动铺板、签名安装包与自动更新等。完整列表：[docs/ROADMAP.md](docs/ROADMAP.md)。

---

## 加入讨论

这是给电影人、剪辑师用的开源本地工具。**欢迎你。**

- **想法与反馈** → [Discussions](https://github.com/Gianluca-Improta/cinekive/discussions)
- **Bug** → [Issues](https://github.com/Gianluca-Improta/cinekive/issues)
- **代码** → [Contributing](CONTRIBUTING.md)
- **展示你的板** → 在 Discussions 发截图（勿发客户隐私素材）
- **常见问题** → [docs/FAQ.md](docs/FAQ.md) · **对比** → [docs/COMPARE.md](docs/COMPARE.md)

请尊重版权：镜像脚本仅供你有权访问的内容；仓库不附带他人静帧。

行为准则：[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) · 安全：[SECURITY.md](SECURITY.md) · 支持：[SUPPORT.md](SUPPORT.md)

---

## 创作者与支持

由 **[Gianluca Improta](https://gianlucaimprota.com)** 构建。

| 链接 | 用途 |
|------|------|
| [framechain.ai](https://framechain.ai) | 低成本画布 AI 视频生成 |
| [gianlucaimprota.com](https://gianlucaimprota.com) | 导演 / 创作者作品集 |
| [gemimedia.cn](https://gemimedia.cn) | 视频制作 |
| [GitHub Sponsors](https://github.com/sponsors/Gianluca-Improta) | **欢迎捐赠** — 让 Cinekive 保持本地优先并持续前进 |

应用内：**设置 → 创作者与支持**，以及侧栏链接。

---

## 许可证

MIT — 随便用、随便 fork，片库留在你自己机器上。

```
Copyright (c) 2026 Cinekive contributors
```
