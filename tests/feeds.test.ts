import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearFeedCache,
  decodeEntities,
  fetchEconomicCalendar,
  fetchNews,
  fetchYields,
  parseDividends,
  parseEarnings,
  parseEconomicCalendar,
  parseRss,
  parseTreasuryYields,
  stripHtml,
  symbolsIn,
} from "@/lib/server/feeds";

afterEach(() => clearFeedCache());

const rss = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Bitcoin &amp; Ether rally as SOL jumps]]></title><link>https://example.com/a</link>
<pubDate>Fri, 23 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>The <b>market</b> rose &#8211; sharply.</p>]]></description></item>
<item><title>Older story about Dogecoin</title><link>https://example.com/b</link><pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>Broken item without a date</title><link>https://example.com/c</link></item>
<item><title>Bad link</title><link>javascript:alert(1)</link><pubDate>Fri, 23 Oct 2026 09:00:00 GMT</pubDate></item>
</channel></rss>`;

describe("rss parsing", () => {
  it("extracts items, strips markup and tags coins", () => {
    const items = parseRss(rss, "Test");
    expect(items.map((i) => i.link)).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(items[0].title).toBe("Bitcoin & Ether rally as SOL jumps");
    expect(items[0].summary).toBe("The market rose – sharply.");
    expect(items[0].symbols.sort()).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
    expect(items[1].symbols).toEqual(["DOGEUSDT"]);
  });
  it("decodes entities and strips scripts", () => {
    expect(decodeEntities("a &amp; b &#x41; &#66;")).toBe("a & b A B");
    expect(stripHtml("<script>alert(1)</script><p>hi&nbsp;there</p>")).toBe("hi there");
    expect(symbolsIn("Is BTC the new ETH? bitcoinist")).toEqual(["BTCUSDT", "ETHUSDT"]);
  });
  it("merges feeds newest-first, de-duplicates and tolerates one failing source", async () => {
    const fetcher = vi.fn(async (url: unknown) => {
      if (String(url).includes("cointelegraph")) return new Response("down", { status: 500 });
      return new Response(rss);
    });
    const { items, failed } = await fetchNews(fetcher as unknown as typeof fetch);
    expect(failed).toEqual(["Cointelegraph"]);
    expect(items).toHaveLength(2);
    expect(items[0].published).toBeGreaterThan(items[1].published);
    await fetchNews(fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("fails clearly when no source answers", async () => {
    const fetcher = vi.fn(async () => new Response("no", { status: 503 }));
    await expect(fetchNews(fetcher as unknown as typeof fetch)).rejects.toThrow(/reachable/);
  });
});

describe("calendars", () => {
  it("normalizes economic events and sorts by time", () => {
    const events = parseEconomicCalendar([
      { title: "CPI", country: "USD", date: "2026-10-23T08:30:00-04:00", impact: "High", forecast: "0.3%", previous: "0.2%" },
      { title: "Bank holiday", country: "JPY", date: "2026-10-22T00:00:00-04:00", impact: "Holiday", forecast: "", previous: "" },
      { title: "Bad", date: "nonsense" },
      "junk",
    ]);
    expect(events.map((e) => e.title)).toEqual(["Bank holiday", "CPI"]);
    expect(events[1]).toMatchObject({ impact: "high", forecast: "0.3%", country: "USD" });
    expect(parseEconomicCalendar({})).toEqual([]);
  });
  it("fetches the requested week from the calendar feed", async () => {
    const fetcher = vi.fn(async (url: unknown) =>
      new Response(JSON.stringify([{ title: "X", country: "USD", date: "2026-10-23T08:30:00-04:00", impact: "Low" }])),
    );
    expect(await fetchEconomicCalendar("next", fetcher as unknown as typeof fetch)).toHaveLength(1);
    expect(String(fetcher.mock.calls[0][0])).toContain("nextweek");
  });
  it("parses earnings and dividend calendars", () => {
    const earnings = parseEarnings({
      data: { rows: [{ symbol: "AAPL", name: "Apple", time: "time-after-hours", epsForecast: "$1.9", lastYearEPS: "$1.5", marketCap: "$3T", fiscalQuarterEnding: "Sep/2026" }] },
    });
    expect(earnings[0]).toMatchObject({ symbol: "AAPL", time: "After close", epsForecast: "$1.9" });
    const dividends = parseDividends({
      data: { calendar: { rows: [{ symbol: "KO", companyName: "Coca-Cola", dividend_Ex_Date: "10/23/2026", payment_Date: "11/15/2026", dividend_Rate: "$0.51", indicated_Annual_Dividend: "2.04" }] } },
    });
    expect(dividends[0]).toMatchObject({ symbol: "KO", amount: 0.51 });
    expect(parseEarnings(null)).toEqual([]);
  });
});

describe("treasury yields", () => {
  const entry = (date: string, ten: string, two: string) =>
    `<entry><content><m:properties><d:NEW_DATE m:type="Edm.DateTime">${date}T00:00:00</d:NEW_DATE><d:BC_1MONTH m:type="Edm.Double">4.40</d:BC_1MONTH><d:BC_2YEAR m:type="Edm.Double">${two}</d:BC_2YEAR><d:BC_10YEAR m:type="Edm.Double">${ten}</d:BC_10YEAR><d:BC_20YEAR m:type="Edm.Double" m:null="true"></d:BC_20YEAR></m:properties></content></entry>`;
  const xml = `<feed>${entry("2026-10-22", "4.10", "3.80")}${entry("2026-10-21", "4.05", "3.75")}</feed>`;
  it("reads curves oldest first and treats empty tenors as missing", () => {
    const curves = parseTreasuryYields(xml);
    expect(curves.map((c) => c.date)).toEqual(["2026-10-21", "2026-10-22"]);
    expect(curves[1].values["10Y"]).toBe(4.1);
    expect(curves[1].values["2Y"]).toBe(3.8);
    expect(curves[1].values["20Y"]).toBeNull();
    expect(curves[1].values["30Y"]).toBeNull();
  });
  it("merges two months and survives one failing", async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => (++calls === 2 ? new Response("x", { status: 500 }) : new Response(xml)));
    const curves = await fetchYields(fetcher as unknown as typeof fetch, new Date(Date.UTC(2026, 9, 23)));
    expect(curves).toHaveLength(2);
    clearFeedCache();
    const dead = vi.fn(async () => new Response("x", { status: 500 }));
    await expect(fetchYields(dead as unknown as typeof fetch)).rejects.toThrow(/unavailable/);
  });
});
