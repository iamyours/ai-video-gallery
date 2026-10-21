#!/usr/bin/env python3
"""Check that the gallery manifest matches the files on disk."""

import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data" / "manifest.json"
RAW_BASE = "https://raw.githubusercontent.com/iamyours/ai-video-gallery/main/"
PRIVATE_CHAT = re.compile(r"gemini\.google\.com/app/", re.I)
TREEHOUSE_PROMPT = (
    "A hyper-realistic cinematic miniature construction scene deep inside a misty tropical rainforest. "
    "Tiny workers use tweezers, hammers, ropes and pulleys to build a luxurious treehouse between enormous moss-covered trees. "
    "Extreme macro shots of hands assembling wooden beams and installing tiny glass windows, with rain droplets and wet leaves. "
    "End with a wide reveal of the completed treehouse glowing warmly above the canopy, surrounded by mist and a distant waterfall. "
    "Photorealistic miniature diorama, shallow depth of field, no text."
)
SNAIL_PROMPT = (
    "A macro nature documentary shot of a snail slowly gliding across a dewy green leaf at dawn, "
    "extreme close-up of its glistening body and eye stalks, soft golden backlight, shallow depth of field, "
    "gentle camera push-in, BBC nature documentary style, photorealistic, no text."
)

errors = []


def fail(message):
    errors.append(message)


def moov_before_mdat(path):
    position = 0
    with path.open("rb") as handle:
        while position < path.stat().st_size:
            handle.seek(position)
            header = handle.read(8)
            if len(header) < 8:
                return False
            size, kind = struct.unpack(">I4s", header)
            kind = kind.decode("latin1")
            if size == 1:
                size = struct.unpack(">Q", handle.read(8))[0]
            elif size < 8:
                return False
            if kind == "moov":
                return True
            if kind == "mdat":
                return False
            position += size
    return False


def main():
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".json", ".html", ".md", ".js", ".css", ".yml", ".py", ".svg", ".txt"}:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        if PRIVATE_CHAT.search(text):
            fail(f"{path.relative_to(ROOT)} contains a private Gemini chat URL")

    try:
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot read manifest: {exc}")
        return finish()

    blob = MANIFEST.read_text(encoding="utf-8") + (ROOT / "index.html").read_text(encoding="utf-8")
    if "gemini.google.com" in blob:
        fail("public manifest or index.html contains a Gemini chat host")

    if data.get("raw_base") != RAW_BASE:
        fail(f"raw_base must be {RAW_BASE}")

    videos = data.get("videos")
    if not isinstance(videos, list) or not videos:
        fail("videos must be a non-empty list")
        return finish()

    slugs = [item.get("slug") for item in videos]
    if len(slugs) != len(set(slugs)):
        fail("duplicate slug")
    by_slug = {item.get("slug"): item for item in videos}

    expected = {
        "miniature-treehouse-tweezers": TREEHOUSE_PROMPT,
        "macro-snail-dewdrops": SNAIL_PROMPT,
    }
    for slug, prompt in expected.items():
        item = by_slug.get(slug)
        if not item:
            fail(f"missing {slug}")
            continue
        if item.get("prompt") != prompt:
            fail(f"{slug} prompt does not match the recorded original")
        if item.get("source_url") not in (None, ""):
            fail(f"{slug} source_url must stay empty")

    full = by_slug.get("dango-ep1-full")
    if not full or full.get("prompt") is not None:
        fail("dango-ep1-full prompt must stay null")
    elif full.get("segments") != [
        "dango-ep1-01-koi-pond",
        "dango-ep1-02-clover-forest",
        "dango-ep1-03-snowy-mailbox",
    ]:
        fail("dango-ep1-full segments are out of order")

    for item in videos:
        slug = item.get("slug") or ""
        if not slug:
            fail("video is missing slug")
            continue
        video_path = ROOT / "videos" / f"{slug}.mp4"
        cover_path = ROOT / "covers" / f"{slug}.jpg"
        if item.get("video") != f"videos/{slug}.mp4":
            fail(f"{slug} video path must be videos/{slug}.mp4")
        if item.get("cover") != f"covers/{slug}.jpg":
            fail(f"{slug} cover path must be covers/{slug}.jpg")
        if not video_path.is_file() or video_path.stat().st_size < 1000:
            fail(f"missing video file for {slug}")
        elif not moov_before_mdat(video_path):
            fail(f"{slug}.mp4 is not fast-start; remux with ffmpeg -c copy -movflags +faststart")
        if not cover_path.is_file():
            fail(f"missing cover for {slug}")
        prompt = item.get("prompt", None)
        if prompt is not None and (not isinstance(prompt, str) or not prompt.strip()):
            fail(f"{slug} prompt must be a non-empty string or null")
        tags = item.get("tags")
        if not isinstance(tags, list):
            fail(f"{slug} tags must be an array")
        else:
            for tag in tags:
                if not isinstance(tag, str) or not tag.strip():
                    fail(f"{slug} has an empty tag")
        if "segments" in item:
            orders = []
            for segment in item["segments"]:
                if segment not in by_slug:
                    fail(f"{slug} segment {segment} does not exist")
                    continue
                if segment == slug:
                    fail(f"{slug} lists itself as a segment")
                orders.append(by_slug[segment].get("order"))
            if orders and any(order is None for order in orders):
                fail(f"{slug} segments need numeric order")
            elif orders != sorted(orders):
                fail(f"{slug} segments are not in order")

    banner = ROOT / "covers" / "dango-ref-sheet.jpg"
    if not banner.is_file():
        fail("missing covers/dango-ref-sheet.jpg")

    app = (ROOT / "js" / "app.js").read_text(encoding="utf-8")
    if "提示词未记录" not in app or "gemini.google.com" not in app:
        fail("player is missing the empty-prompt label or the private-host guard")
    if "raw_base" not in app:
        fail("player does not build the raw video URL from raw_base")

    return finish()


def finish():
    if errors:
        print("gallery check failed:")
        for message in errors:
            print(f"- {message}")
        return 1
    print("gallery check ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
