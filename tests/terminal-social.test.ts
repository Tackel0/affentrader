import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRedditAtom, parseXRecent, terminalSocialRequest } from "@/lib/server/terminalSocial";
import { normalizeSocialTicker, socialTickers, summarizeSocial, type SocialPost } from "@/lib/terminal/social";
import { parseTerminalCommand } from "@/lib/terminal/commands";
import { POST } from "@/app/api/terminal-social/route";

const now = Date.UTC(2026, 10, 22, 10);
const posted = new Date(now - 60 * 60_000).toISOString();
const atom = (community: string, text: string, link = `https://www.reddit.com/r/${community}/comments/abcd/test/`) => `
  <feed xmlns="http://www.w3.org/2005/Atom"><entry><id>t3_abcd</id><title>Analyse</title>
  <updated>${posted}</updated><link href="${link}"/><content type="html">&lt;p&gt;${text}&lt;/p&gt;</content></entry></feed>`;

afterEach(() => vi.unstubAllEnvs());

describe("terminal social research", () => {
  it("extracts exact symbols and counts at most one hit per post and ticker", () => {
    expect(normalizeSocialTicker(" $brk.b ")).toBe("BRK.B");
    expect(normalizeSocialTicker('" OR BTC')).toBeNull();
    expect(socialTickers("$nvda, $NVDA. MSFT, NVDAX und CEO; 300$ sind kein Ticker.", new Set(["MSFT", "NVDA", "CEO"]))).toEqual(["NVDA", "MSFT"]);
    const reddit: SocialPost = { source: "mauerstrassenwetten", id: "t3_abcd", title: "NVDA $NVDA $NVDA", text: "MSFT", at: now - 5000, url: "" };
    const x: SocialPost = { ...reddit, source: "x", id: "1234567", title: "$NVDA", text: "", at: now - 2000 };
    const sample = summarizeSocial([reddit, reddit, x, { ...x, id: "1234568", at: now + 5000 }, { ...x, id: "1234569", at: now - 90_000_000 }], [], null, 24, now);
    expect(sample.trends.map(({ ticker, count, x, reddit }) => ({ ticker, count, x, reddit }))).toEqual([
      { ticker: "NVDA", count: 2, x: 1, reddit: 1 }, { ticker: "MSFT", count: 1, x: 0, reddit: 1 },
    ]);
    expect(summarizeSocial([reddit, x], [], "MSFT", 24, now).posts).toHaveLength(1);
  });

  it("parses Reddit and X without trusting external URLs or provider markup", () => {
    expect(parseRedditAtom("mauerstrassenwetten", atom("mauerstrassenwetten", "Diskussion $SAP"))[0]).toMatchObject({
      source: "mauerstrassenwetten", id: "t3_abcd", text: "Diskussion $SAP", at: Date.parse(posted),
      url: "https://www.reddit.com/r/mauerstrassenwetten/comments/abcd/test/",
    });
    expect(parseRedditAtom("mauerstrassenwetten", atom("mauerstrassenwetten", "$SAP", "https://example.org/r/mauerstrassenwetten/comments/abcd/test/"))).toEqual([]);
    expect(parseRedditAtom("mauerstrassenwetten", atom("wallstreetbetsGER", "$SAP"))).toEqual([]);
    expect(parseXRecent({ data: [{ id: "123456789", text: "$AMD", created_at: posted }, { id: "fake", text: "$AMD", created_at: posted }] })).toEqual([
      { id: "123456789", source: "x", at: Date.parse(posted), url: "https://x.com/i/web/status/123456789", text: "$AMD", title: "" },
    ]);
  });

  it("returns partial coverage and never presents disconnected X as zero mentions", async () => {
    vi.stubEnv("AFFENTRADER_X_BEARER_TOKEN", "");
    vi.stubEnv("AFFENTRADER_REDDIT_CLIENT_ID", "");
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("www.reddit.com");
      expect(url.searchParams.get("limit")).toBe("25");
      if (url.pathname.includes("comments")) return new Response("", { status: 429 });
      return new Response(atom(url.pathname.split("/")[2], "$SAP"));
    });
    const data = await terminalSocialRequest({ ticker: "SAP" }, new AbortController().signal, fetcher, now);
    expect(data.sources).toEqual([
      { source: "mauerstrassenwetten", state: "partial", samples: 1, fetchedAt: now },
      { source: "wallstreetbetsGER", state: "partial", samples: 1, fetchedAt: now },
      { source: "x", state: "needs-access", samples: 0 },
    ]);
    expect(data.trends[0]).toMatchObject({ ticker: "SAP", reddit: 2, count: 2 });
    expect(fetcher.mock.calls.some(([input]) => String(input).includes("search.rss") && String(input).includes("q=SAP"))).toBe(true);
  });

  it("uses the official X recent search for ticker queries and keeps request values out of results", async () => {
    vi.stubEnv("AFFENTRADER_REDDIT_CLIENT_ID", "");
    const fixture = "temporary-fixture-access";
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === "api.x.com") {
        expect(new Headers(init?.headers).has("authorization")).toBe(true);
        expect(url.pathname).toBe("/2/tweets/search/recent");
        expect(url.searchParams.get("query")).toBe('($MSFT OR "MSFT") -is:retweet');
        expect(init?.redirect).toBe("error");
        return Response.json({ data: [{ id: "123456789", text: "$MSFT", created_at: posted }], meta: { next_token: "page" } });
      }
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return new Response("", { status: 503 });
    });
    const data = await terminalSocialRequest({ ticker: "MSFT", hours: 72, xToken: fixture }, new AbortController().signal, fetcher, now);
    expect(data.sources.at(-1)).toMatchObject({ source: "x", state: "partial", samples: 1 });
    expect(data.trends[0]).toMatchObject({ ticker: "MSFT", x: 1, count: 1 });
    expect(JSON.stringify(data).includes(fixture)).toBe(false);
  });

  it("rejects cross-origin requests and ticker operators before fetching", async () => {
    const body = JSON.stringify({ ticker: 'MSFT OR "TSLA"' });
    const cross = await POST(new Request("https://terminal.example/api/terminal-social", { method: "POST", headers: { Origin: "https://other.example" }, body }));
    const invalid = await POST(new Request("https://terminal.example/api/terminal-social", { method: "POST", headers: { Origin: "https://terminal.example" }, body }));
    expect(cross.status).toBe(403);
    expect(invalid.status).toBe(400);
    expect(parseTerminalCommand("NVDA SOCIAL")).toEqual({ kind: "view", view: "social", ticker: "NVDA" });
  });
});
