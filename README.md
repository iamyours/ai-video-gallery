# AI 视频画廊

Roger 的 AI 短片静态站。页面地址：[https://iamyours.github.io/ai-video-gallery/](https://iamyours.github.io/ai-video-gallery/)

站点是纯 HTML、CSS 和 JavaScript。唯一要改的数据文件是 [`data/manifest.json`](data/manifest.json)。分类标签、卡片和「按顺序播放」都从这份 JSON 生成。

播放用的是本站上的 mp4（GitHub Pages 路径，例如 `videos/dango-ep1-01-koi-pond.mp4`）。每条片子另有「复制视频链接」，复制的是 raw 地址：

`https://raw.githubusercontent.com/iamyours/ai-video-gallery/main/videos/<slug>.mp4`

## 本地预览

在仓库根目录开一个静态服务器：

```bash
python3 -m http.server 8080
```

然后打开 <http://127.0.0.1:8080/>。不要直接双击 `index.html`，浏览器不允许在 `file://` 下读取 JSON。

提交前可以检查文件是否齐全：

```bash
python3 scripts/check_gallery.py
```

## 新增一条视频

1. 选一个英文 slug，只用小写字母、数字和连字符，例如 `night-market`。
2. 把视频放到 `videos/<slug>.mp4`。编码用 H.264 + AAC，浏览器才能直接播。建议把 moov 放在文件头，方便点开就播：

   ```bash
   ffmpeg -i input.mp4 -c copy -movflags +faststart videos/<slug>.mp4
   ```

3. 做一张封面，放到 `covers/<slug>.jpg`。
4. 在 `data/manifest.json` 的 `videos` 数组末尾追加一条。`prompt` 只能填生成时的原文；没有记录就写 `null`，页面会显示「提示词未记录」，不要编。
5. 提交并推到 `main`。GitHub Actions 会部署到 GitHub Pages。

示例：

```json
{
  "slug": "night-market",
  "title_zh": "夜市",
  "title_en": "Night Market",
  "category": "动物",
  "episode": null,
  "order": null,
  "model": "Gemini / Veo",
  "prompt": null,
  "prompt_source": null,
  "source_url": null,
  "notes": "",
  "duration_s": 8,
  "width": 1280,
  "height": 720,
  "aspect": "16:9",
  "created": "2026-10-21T12:00:00+08:00",
  "video": "videos/night-market.mp4",
  "cover": "covers/night-market.jpg"
}
```

## 新增一个分类

在 `categories` 里加一项，`id` 与视频的 `category` 用同一个字符串：

```json
{
  "id": "夜景",
  "description": "这一分类的一句话介绍。",
  "banner": null,
  "banner_alt": null
}
```

`banner` 可以是一张已经放进仓库的图片路径，例如团子系列用的 `covers/dango-ref-sheet.jpg`。就算忘了加 `categories` 条目，只要某条视频写了新的 `category`，筛选里也会出现这个名字。

## 系列与按顺序播放

团子第 1 集的合集 `dango-ep1-full` 自己没有提示词（`prompt` 为 `null`）。它的 `segments` 按顺序写下三段 slug。页面会：

- 在合集里链接到这三段的提示词
- 在团子系列上提供「按顺序播放第 1 集片段」，只播这三段，不重复播合集

以后要给别的分类做连播，在该分类里挑一条片子（通常是合集），加上按顺序排列的 `segments` 即可。

## 提示词和灵感链接

- `prompt` 是原文。页面用等宽换行原样展示，并提供「复制提示词」。`null` 时只显示「提示词未记录」，没有复制按钮。
- `prompt_source` 是给人看的出处说明，页面只当文字显示，不会把它做成链接。
- `source_url` 有公开地址时，页面显示「灵感来源」。没有就写 `null`。

Gemini 私人对话地址不要写进 `source_url`，也不要写进公开的 manifest。页面会忽略 `gemini.google.com` 上的链接，避免把私人聊天当成灵感来源。

## 字段

| 字段 | 作用 |
| --- | --- |
| `slug` | 唯一短名，对应 `videos/<slug>.mp4` 和 `covers/<slug>.jpg` |
| `title_zh` / `title_en` | 中文标题，以及播放器里的英文副标题 |
| `category` | 分类名 |
| `episode` / `order` | 系列编号。合集用 `order: 0`，片段从 1 递增 |
| `segments` | 写在合集上，按播放顺序列出片段 slug |
| `model` | 卡片上的模型名 |
| `prompt` | 提示词原文，或 `null` |
| `prompt_source` | 出处说明，不是链接 |
| `source_url` | 可公开的灵感链接，或 `null` |
| `duration_s` / `aspect` / `width` / `height` / `created` | 时长、画幅、尺寸、日期 |
| `video` / `cover` | 仓库内相对路径 |
| `notes` | 只放在数据文件里，页面不展示 |

`raw_base` 不要改，除非仓库或分支变了。复制按钮会把它和 `video` 拼成 raw 链接。

## 部署

推送到 `main` 会跑 [`.github/workflows/pages.yml`](.github/workflows/pages.yml)：检查数据、用 `actions/upload-pages-artifact` 上传站点、再用 `actions/deploy-pages` 发布。

仓库的 Pages 来源需要是 **GitHub Actions**。如果 Actions 没有出现在 Pages 设置里，打开仓库的 Settings → Pages → Build and deployment，把 Source 选成 GitHub Actions。
