import type { ToolDef } from "../registry.js";
import { jsonResult } from "../result.js";
import { fetchJson, str } from "../utils.js";

/**
 * YouTube module — public oEmbed metadata, no API key.
 * Downloading is deliberately left to the youtube-downloader skill,
 * which wraps the user's local yt-dlp install; the hub never runs it.
 */

const OEMBED = "https://www.youtube.com/oembed";

/** Extract an 11-char video ID from a URL or return the ID if already bare. */
export function videoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[0-9A-Za-z_-]{11}$/.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[0-9A-Za-z_-]{11}$/.test(id) ? id : null;
  }
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return null;
  const v = url.searchParams.get("v");
  if (v && /^[0-9A-Za-z_-]{11}$/.test(v)) return v;
  const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([0-9A-Za-z_-]{11})/);
  return m ? m[1] : null;
}

interface OEmbedResult {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
  html?: string;
}

export const youtubeDefs: ToolDef[] = [
  {
    name: "yt_video_info",
    description:
      "Look up a YouTube video's metadata by URL or ID. Returns title, channel name, thumbnail, and embed dimensions — no API key required.",
    inputSchema: {
      type: "object",
      properties: {
        video: {
          type: "string",
          description: "Video URL (watch, youtu.be, shorts, or embed) or the bare 11-character ID",
        },
      },
      required: ["video"],
    },
    handler: async (args) => {
      const id = videoId(str(args.video));
      if (!id) {
        return jsonResult({
          found: false,
          error: `Could not read a YouTube video ID from "${str(args.video)}" — pass a watch/youtu.be/shorts URL or an 11-character ID`,
        });
      }
      const data = (await fetchJson(
        `${OEMBED}?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`,
        "YouTube oEmbed",
      )) as OEmbedResult;
      return jsonResult({
        found: true,
        id,
        title: data.title ?? null,
        channel: data.author_name ?? null,
        channelUrl: data.author_url ?? null,
        thumbnail: data.thumbnail_url ?? null,
        watchUrl: `https://www.youtube.com/watch?v=${id}`,
        embed: { width: data.width ?? 480, height: data.height ?? 270 },
      });
    },
  },
];
