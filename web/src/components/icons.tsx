import {
  Blocks, Briefcase, ChartColumn, Clock, Cloud, Code2, Cpu, Database, FileText,
  Folder, Gauge, GitBranch, Globe, Hash, Hexagon, Lightbulb, MessageCircle, Newspaper, Package,
  PenLine, Pin, Play, Search, Shield, Sparkles, Target, TrendingUp, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";
import { CATEGORY_ICONS } from "../lib/catalog";

const ICON_MAP: Record<string, LucideIcon> = {
  clock: Clock, hash: Hash, globe: Globe, chip: Cpu, folder: Folder, search: Search,
  branch: GitBranch, target: Target, database: Database, pen: PenLine, chat: MessageCircle,
  hex: Hexagon, news: Newspaper, cloud: Cloud, bulb: Lightbulb, gauge: Gauge, wrench: Wrench,
  code: Code2, briefcase: Briefcase, shield: Shield, package: Package, chart: ChartColumn,
  pin: Pin, blocks: Blocks, bolt: Zap, spark: Sparkles, play: Play, key: FileText,
  trend: TrendingUp,
};

function Tile({ sm = false, children }: { sm?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`flex flex-none items-center justify-center rounded-md border border-border bg-surface text-secondary ${
        sm ? "h-[22px] w-[22px]" : "h-9 w-9"
      }`}
    >
      {children}
    </span>
  );
}

export function ModuleIcon({ name, sm = false }: { name: string; sm?: boolean }) {
  const Icon = ICON_MAP[name] || Pin;
  return (
    <Tile sm={sm}>
      <Icon className={sm ? "h-3 w-3" : "h-[17px] w-[17px]"} strokeWidth={1.9} />
    </Tile>
  );
}

export function CategoryIcon({ name }: { name: string }) {
  const icon = CATEGORY_ICONS[name] || "pin";
  const Icon = ICON_MAP[icon] || Pin;
  return (
    <span className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-border bg-surface text-secondary">
      <Icon className="h-[15px] w-[15px]" strokeWidth={1.9} />
    </span>
  );
}

export function catalogIcon(name: string): LucideIcon {
  const by: Record<string, LucideIcon> = {
    OpenAI: Zap, Anthropic: Lightbulb, "Hugging Face": Sparkles, OpenRouter: Globe,
    GitHub: GitBranch, Git: GitBranch, Linear: Target, Sentry: Shield, Everything: Blocks,
    "Brave Search": Search, Exa: Search, Tavily: Search, Firecrawl: Globe, Fetch: Globe,
    PostgreSQL: Database, SQLite: Database, Supabase: Database, Neon: Database,
    MongoDB: Database, DuckDB: Database, Prisma: Database,
    Slack: MessageCircle, Discord: MessageCircle, Gmail: PenLine,
    Notion: PenLine, Obsidian: PenLine, Atlassian: Briefcase,
    Figma: PenLine, FFmpeg: Play, ImageMagick: Pin,
    AWS: Cloud, Docker: Package, Cloudflare: Cloud, Grafana: ChartColumn,
    Playwright: Search, Puppeteer: Search, "Chrome DevTools": Code2, Browserbase: Globe,
    Semgrep: Shield, Memory: Cpu, "Sequential Thinking": Lightbulb,
    Stripe: Hexagon, CoinGecko: Hexagon,
  };
  return by[name] || Pin;
}
