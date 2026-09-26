---
name: youtube-downloader
description: Download or extract audio from YouTube videos using the local yt-dlp CLI — format selection, quality caps, subtitles, and safety rules.
category: Media
version: 1.0.0
---

# YouTube Downloader

Use this skill when asked to save a YouTube video or its audio locally. The
workstation never runs downloads itself — you drive the user's local `yt-dlp`
installation.

## Preconditions

1. Check the tool exists: `yt-dlp --version`. If missing, tell the user to install it (`pipx install yt-dlp` or `brew install yt-dlp`) — do not silently download binaries.
2. Resolve the video first with the `yt_video_info` MCP tool (works with watch/youtu.be/shorts URLs) so you have the exact title and ID for the filename.

## Recipes

- Best MP4 video+audio: `yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]" -o "%(title)s.%(ext)s" URL`
- Audio only (mp3): `yt-dlp -x --audio-format mp3 URL` (requires ffmpeg; check `ffmpeg -version` first)
- Subtitles only: `yt-dlp --write-subs --sub-langs en --skip-download URL`
- Specific range: `yt-dlp --download-sections "*00:01:00-00:05:00" URL`
- Playlist, numbered: `yt-dlp -o "%(playlist_index)02d-%(title)s.%(ext)s" PLAYLIST_URL`

## Safety rules

- Cap quality when the user is vague: `-f "b[height<=720]"` — never pull 4K without being asked.
- Respect the terms of service: personal, offline use of freely accessible content. Decline to bypass paid/DRM protection or private content the user cannot access.
- Put files where the user expects: ask for a target directory if none is obvious; default to `~/Downloads`.
- After each download, report the saved filename and size (`ls -lh` the output), not just exit codes.
