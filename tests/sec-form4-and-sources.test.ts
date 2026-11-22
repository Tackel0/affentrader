import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSecForm4XmlUrl,
  clearSecForm4Caches,
  parseForm4Xml,
  resolveSecCik,
  SEC_MIN_INTERVAL_MS,
  secFetch,
} from "@/lib/server/secForm4";
import {
  clearPublicEquityCaches,
  fetchOpenInsiderBuys,
  parseFinvizHtml,
  parseOpenInsiderHtml,
  parseYahooQuoteSummary,
} from "@/lib/server/publicEquitySources";
import {
  clearSecEdgarSummaryCache,
  fetchSecEdgarForm4Summary,
  resolveFundamentalSnapshot,
} from "@/lib/server/fundamentals";
import { clearStockHeatmapCache, fetchStockSectorHeatmap } from "@/lib/server/stockHeatmap";

const SAMPLE_FORM4_XML = `<?xml version="1.0"?>
<ownershipDocument>
  <issuer><issuerTradingSymbol>QCOM</issuerTradingSymbol></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerName>Cristiano R. Amon</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>1</isDirector>
      <isOfficer>1</isOfficer>
      <officerTitle>President and CEO</officerTitle>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-02-12</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>2500</value></transactionShares>
        <transactionPricePerShare><value>162.50</value></transactionPricePerShare>
      </transactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-02-11</value></transactionDate>
      <transactionCoding><transactionCode>M</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>10000</value></transactionShares>
        <transactionPricePerShare><value>0</value></transactionPricePerShare>
      </transactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-02-10</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>5000</value></transactionShares>
        <transactionPricePerShare><value>168.00</value></transactionPricePerShare>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`;

describe("SEC Form 4 XML parser, dynamic CIK lookup & historical valuation", () => {
  beforeEach(() => {
    clearSecForm4Caches();
    clearSecEdgarSummaryCache();
    clearPublicEquityCaches();
    clearStockHeatmapCache();
  });

  it("parses Form 4 XML and strictly filters to open-market purchases (transactionCode P)", () => {
    const buys = parseForm4Xml(SAMPLE_FORM4_XML, "2026-02-13", "4");
    expect(buys).toHaveLength(1);
    expect(buys[0]).toEqual({
      date: "2026-02-12",
      transactionDate: "2026-02-12",
      insider: "Cristiano R. Amon",
      role: "President and CEO / Director",
      shares: 2500,
      price: 162.5,
      valueUsd: 406250,
      form: "4",
    });

    // Rejects Form 4 that only contains RSU grant ("A") or sale ("S")
    const nonBuyXml = SAMPLE_FORM4_XML.replace("<transactionCode>P</transactionCode>", "<transactionCode>A</transactionCode>");
    expect(parseForm4Xml(nonBuyXml, "2026-02-13")).toHaveLength(0);
  });

  it("strips SEC XSLT stylesheet prefix when constructing raw Form 4 XML archive URLs", () => {
    const url = buildSecForm4XmlUrl("0000804328", "0000804328-26-000014", "xslF345X05/wf-form4_174.xml");
    expect(url).toBe("https://www.sec.gov/Archives/edgar/data/804328/000080432826000014/wf-form4_174.xml");
  });

  it("resolves dynamic SEC CIKs from SEC company_tickers.json for tickers outside the static table", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          "0": { cik_str: 1326801, ticker: "META", title: "Meta Platforms, Inc." },
          "1": { cik_str: 1652044, ticker: "GOOGL", title: "Alphabet Inc." },
          "2": { cik_str: 123456, ticker: "PLTR", title: "Palantir Technologies Inc." },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const pltrCik = await resolveSecCik("PLTR", {}, fetcher);
    expect(pltrCik).toBe("0000123456");
  });

  it("records TradingView provenance whenever any TV metric is present even when forwardPe is null, and keeps historicalMedianPe null without price-aligned XBRL history", () => {
    const snap = resolveFundamentalSnapshot(
      "INTC",
      24.5,
      "USD",
      "Intel Corp.",
      {
        analystTarget: 91.04,
        marketCapBn: 108.2,
        sector: "Electronic Technology",
        forwardPe: null,
      },
      null,
      {
        yahooInsights: {
          trailingPe: 32.5,
          analystConsensus: {
            buy: 8,
            hold: 20,
            sell: 7,
            ratingLabel: "Hold",
            analystCount: 35,
            targetLow: 18,
            targetMean: 25.4,
            targetHigh: 91,
            recentActions: [],
          },
          partial: { operatingMarginPct: 4.1 },
        },
      },
    );
    expect(snap.dataSources).toContain("TradingView");
    expect(snap.dataSources).toContain("Yahoo Finance");
    expect(snap.source).toBe("tradingview+sec+yahoo");
    expect(snap.analystTarget).toBe(91.04);
    expect(snap.historicalMedianPe).toBeNull();
    expect(snap.peVsHistoryPct).toBeNull();

    const emptySnap = resolveFundamentalSnapshot(
      "NVDA",
      140,
      "USD",
      "NVIDIA Corp.",
      { forwardPe: null, analystTarget: null, marketCapBn: null },
      null,
      {
        yahooInsights: {
          trailingPe: null,
          analystConsensus: null,
          partial: { forwardPe: null, analystTarget: null },
        },
      },
    );
    expect(emptySnap.dataSources).not.toContain("TradingView");
    expect(emptySnap.dataSources).not.toContain("Yahoo Finance");
    expect(emptySnap.source).toBe("curated-baseline");
    expect(parseYahooQuoteSummary({})).toBeNull();
  });

  it("unwraps uncoerced Yahoo raw quoteSummary objects when schema validation is bypassed", () => {
    const parsed = parseYahooQuoteSummary({
      financialData: {
        targetMeanPrice: { raw: 31.5 },
        targetLowPrice: { raw: 20 },
        targetHighPrice: { raw: 45 },
        numberOfAnalystOpinions: { raw: 28 },
        operatingMargins: { raw: 0.085 },
        recommendationKey: "hold",
      },
      summaryDetail: {
        trailingPE: { raw: 29.1 },
        marketCap: { raw: 110_000_000_000 },
      },
      upgradeDowngradeHistory: {
        history: [
          {
            firm: "Morgan Stanley",
            toGrade: "Equal-Weight",
            action: "reit",
            priceTargetAction: "Removes",
            epochGradeDate: { raw: 1768003200 },
          },
        ],
      },
      earningsHistory: {
        history: [
          {
            quarter: { raw: 1767139200 },
            surprisePercent: { raw: 0.142 },
          },
        ],
      },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.trailingPe).toBe(29.1);
    expect(parsed?.analystConsensus?.targetMean).toBe(31.5);
    expect(parsed?.analystConsensus?.analystCount).toBe(28);
    expect(parsed?.analystConsensus?.recentActions?.[0]).toEqual({
      date: "2026-01-10",
      firm: "Morgan Stanley",
      toGrade: "Equal-Weight",
      action: "reit",
    });
    expect(parsed?.partial.earningsSurprisePct).toBe(14.2);
    expect(parsed?.partial.lastEarningsDate).toBe("2025-12-31");
  });

  it("parses OpenInsider HTML table, Finviz quote snapshot + ratings table, and Yahoo quoteSummary", () => {
    const openInsiderHtml = `
      <table class="tinytable">
        <tbody>
          <tr>
            <td>X</td><td>2026-02-10</td><td>2026-02-09</td><td>QCOM</td><td>Jane Doe</td><td>CFO</td>
            <td>P - Purchase</td><td>$160.00</td><td>+3,000</td><td>10000</td><td>+43%</td><td>+$480,000</td>
          </tr>
          <tr>
            <td>X</td><td>2026-02-08</td><td>2026-02-07</td><td>QCOM</td><td>Bob Smith</td><td>VP</td>
            <td>S - Sale</td><td>$170.00</td><td>-1,000</td><td>5000</td><td>-10%</td><td>-$170,000</td>
          </tr>
        </tbody>
      </table>`;
    const oiBuys = parseOpenInsiderHtml(openInsiderHtml, "QCOM");
    expect(oiBuys).toHaveLength(1);
    expect(oiBuys[0]).toMatchObject({
      date: "2026-02-09",
      insider: "Jane Doe",
      role: "CFO",
      shares: 3000,
      price: 160,
      valueUsd: 480000,
      form: "OpenInsider P",
    });

    const finvizHtml = `
      <table class="snapshot-table2">
        <tr class="table-dark-row">
          <td>Forward P/E</td><td>14.8</td><td>PEG</td><td>1.15</td><td>P/FCF</td><td>18.2</td><td>EV/EBITDA</td><td>11.4</td>
        </tr>
        <tr class="table-dark-row">
          <td>Oper. Margin</td><td>26.5%</td><td>Profit Margin</td><td>21.1%</td><td>ROE</td><td>34.0%</td><td>Target Price</td><td>215.00</td>
        </tr>
      </table>
      <table class="js-table-ratings">
        <tr><td>Feb-12-26</td><td>Upgrade</td><td>Morgan Stanley</td><td>Overweight</td></tr>
      </table>`;
    const fv = parseFinvizHtml(finvizHtml);
    expect(fv).not.toBeNull();
    expect(fv?.forwardPe).toBe(14.8);
    expect(fv?.analystTarget).toBe(215);
    expect(fv?.recentActions[0]).toMatchObject({ firm: "Morgan Stanley", action: "Upgrade", toGrade: "Overweight" });

    const yf = parseYahooQuoteSummary({
      financialData: {
        freeCashflow: 10e9,
        recommendationKey: "buy",
        numberOfAnalystOpinions: 28,
        targetLowPrice: 175,
        targetMeanPrice: 220,
        targetHighPrice: 260,
        operatingMargins: 0.27,
        profitMargins: 0.22,
        returnOnEquity: 0.35,
        revenueGrowth: 0.14,
      },
      defaultKeyStatistics: { forwardPE: 15.2, enterpriseToEbitda: 11.8, pegRatio: 1.12 },
      summaryDetail: { marketCap: 190e9, trailingPE: 19.5 },
      recommendationTrend: { trend: [{ strongBuy: 10, buy: 12, hold: 5, sell: 1, strongSell: 0 }] },
      upgradeDowngradeHistory: {
        history: [{ epochGradeDate: 1770000000, firm: "Goldman Sachs", action: "main", toGrade: "Buy" }],
      },
      earningsHistory: { history: [{ quarter: "2025-12-31", surprisePercent: 0.084 }] },
    });
    expect(yf?.analystConsensus).toMatchObject({
      ratingLabel: "Buy",
      buy: 22,
      hold: 5,
      sell: 1,
      targetMean: 220,
      analystCount: 28,
    });
    expect(yf?.partial.earningsSurprisePct).toBe(8.4);
  });

  it("loads TradingView Public GICS sector heatmap for US/Xetra/UK", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { s: "NASDAQ:NVDA", d: ["NVDA", "NVIDIA Corp", 135.2, 2.45, 42_000_000, 3_300e9, "Electronic Technology", 5_600e6] },
            { s: "NYSE:XOM", d: ["XOM", "Exxon Mobil", 112.4, -0.85, 18_000_000, 480e9, "Energy Minerals", 2_000e6] },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const heat = await fetchStockSectorHeatmap("us", fetcher, 10_000);
    expect(heat.sectors).toEqual(["Electronic Technology", "Energy Minerals"]);
    expect(heat.rows[0]).toMatchObject({
      ticker: "NVDA",
      symbol: "YF:NVDA",
      sector: "Electronic Technology",
      changePct: 2.45,
      marketCapBn: 3300,
    });
  });

  it("deduplicates concurrent resolveSecCik calls to a single SEC company_tickers.json fetch", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          "0": { cik_str: 1326801, ticker: "META", title: "Meta" },
          "1": { cik_str: 1561550, ticker: "CRWD", title: "CrowdStrike" },
          "2": { cik_str: 1561575, ticker: "DDOG", title: "Datadog" },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const [crwd, ddog] = await Promise.all([
      resolveSecCik("CRWD", {}, fetcher),
      resolveSecCik("DDOG", {}, fetcher),
    ]);
    expect(crwd).toBe("0001561550");
    expect(ddog).toBe("0001561575");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses HTTP OpenInsider screener endpoint and parses live Finviz chartEvent/ratings + styled-table-new", async () => {
    const requestedUrls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(
        `<table class="tinytable"><tr>
          <td>P</td><td>2026-03-01 09:00:00</td><td>2026-02-28</td><td>NXGL</td><td>Jane Doe</td><td>CEO</td>
          <td>P - Purchase</td><td>$4.50</td><td>+2,000</td><td>10,000</td><td>+25%</td><td>+$9,000</td>
        </tr></table>`,
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const buys = await fetchOpenInsiderBuys("NXGL", fetcher);
    expect(requestedUrls[0]).toMatch(/^http:\/\/openinsider\.com\/screener\?/);
    expect(buys).toHaveLength(1);
    expect(buys[0].valueUsd).toBe(9000);

    const liveScreenerHtml = `
      <table class="tinytable">
        <thead><tr>
          <th>X</th><th>Filing&nbsp;Date</th><th>Trade&nbsp;Date</th><th>Ticker</th>
          <th>Company&nbsp;Name</th><th>Insider&nbsp;Name</th><th>Title</th><th>Trade&nbsp;Type&nbsp;&nbsp;</th>
          <th>Price</th><th>Qty</th><th>Owned</th><th>&Delta;Own</th><th>Value</th>
          <th>1d</th><th>1w</th><th>1m</th><th>6m</th>
        </tr></thead>
        <tbody><tr>
          <td>D</td><td>2026-11-13 21:59:13</td><td>2026-11-10</td>
          <td><b><a href="/NXGL" onmouseover="Tip('<b>Nexgel, Inc.</b><br>More')">NXGL</a></b></td>
          <td>Nexgel, Inc.</td><td>Kieser Brian Joseph</td><td>Interim CEO, 10%</td><td>P - Purchase</td>
          <td>$5.50</td><td>+133,216</td><td>133,216</td><td>New</td><td>+$732,688</td>
          <td></td><td></td><td></td><td></td>
        </tr></tbody>
      </table>`;
    const liveScreenerBuys = parseOpenInsiderHtml(liveScreenerHtml, "NXGL");
    expect(liveScreenerBuys).toHaveLength(1);
    expect(liveScreenerBuys[0]).toEqual({
      date: "2026-11-10",
      insider: "Kieser Brian Joseph",
      role: "Interim CEO, 10%",
      shares: 133216,
      price: 5.5,
      valueUsd: 732688,
      form: "OpenInsider P",
    });

    const finvizWithEmbedded = `
      <table class="snapshot-table2">
        <tr class="table-dark-row"><td>Forward P/E</td><td>28.4</td><td>Target Price</td><td>310.00</td></tr>
      </table>
      <script>
        var data = {"dateTimestamp":1770000000,"eventType":"chartEvent/ratings","ratings":[{"action":"Reiterated","analyst":"Morgan Stanley","rating":"Overweight\\u0026rarr;Overweight"}]};
      </script>`;
    const parsedEmbedded = parseFinvizHtml(finvizWithEmbedded);
    expect(parsedEmbedded?.analystTarget).toBe(310);
    expect(parsedEmbedded?.recentActions[0]).toMatchObject({
      firm: "Morgan Stanley",
      action: "Reiterated",
      toGrade: "Overweight→Overweight",
    });

    const finvizStyledTable = `
      <table class="snapshot-table2">
        <tr class="table-dark-row"><td>PEG</td><td>1.45</td></tr>
      </table>
      <table class="styled-table-new js-table-ratings">
        <tr><td>Mar-10-26</td><td>Upgrade</td><td>Barclays</td><td>Equal Weight → Overweight</td></tr>
      </table>`;
    const parsedTable = parseFinvizHtml(finvizStyledTable);
    expect(parsedTable?.pegRatio).toBe(1.45);
    expect(parsedTable?.recentActions[0]).toMatchObject({
      date: "Mar-10-26",
      action: "Upgrade",
      firm: "Barclays",
      toGrade: "Equal Weight → Overweight",
    });
  });

  it("does NOT cache { count: 0, filings: [] } on Form 4 XML HTTP 429, never emits false SEC Form 4 XML provenance, and recovers immediately on retry", async () => {
    const now = Date.UTC(2026, 2, 1);
    const submissionsPayload = JSON.stringify({
      filings: {
        recent: {
          form: ["4", "4"],
          filingDate: ["2026-02-20", "2026-02-18"],
          accessionNumber: ["0001234567-26-000010", "0001234567-26-000009"],
          primaryDocument: ["xslF345X05/form4a.xml", "xslF345X05/form4b.xml"],
        },
      },
    });
    const tickersPayload = JSON.stringify({
      "0": { cik_str: 1829855, ticker: "NXGL", title: "Nexgel, Inc." },
    });

    const failingXmlFetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("company_tickers.json")) return new Response(tickersPayload, { status: 200 });
      if (url.includes("data.sec.gov/submissions/")) return new Response(submissionsPayload, { status: 200 });
      if (url.includes("sec.gov/Archives/edgar/data/")) {
        return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "0" } });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    // 1. All Form 4 XML requests return 429 -> must return null and NOT poison secCache
    const failedSummary = await fetchSecEdgarForm4Summary("NXGL", failingXmlFetcher, now, {
      maxXmlDocs: 2,
      concurrency: 1,
    });
    expect(failedSummary).toBeNull();

    // Even when OpenInsider has verified buys, failed Form 4 XML must NOT emit "SEC Form 4 XML" or "SEC EDGAR"
    const poisonedCheckSnap = resolveFundamentalSnapshot(
      "NXGL",
      5.5,
      "USD",
      "Nexgel, Inc.",
      undefined,
      failedSummary,
      {
        openInsider: [
          {
            date: "2026-02-20",
            insider: "Kieser Brian Joseph",
            role: "CEO",
            shares: 10_000,
            price: 5.5,
            valueUsd: 55_000,
            form: "OpenInsider P",
          },
        ],
      },
    );
    expect(poisonedCheckSnap.dataSources).not.toContain("SEC Form 4 XML");
    expect(poisonedCheckSnap.dataSources).not.toContain("SEC EDGAR");
    expect(poisonedCheckSnap.dataSources).toContain("OpenInsider");

    // 2. Immediate retry within 15-min window when SEC recovers -> must hit SEC and return verified Form 4 XML buys
    let healthyXmlCalls = 0;
    const healthyFetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("company_tickers.json")) return new Response(tickersPayload, { status: 200 });
      if (url.includes("data.sec.gov/submissions/")) return new Response(submissionsPayload, { status: 200 });
      if (url.includes("sec.gov/Archives/edgar/data/")) {
        healthyXmlCalls++;
        return new Response(SAMPLE_FORM4_XML, { status: 200 });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const recovered = await fetchSecEdgarForm4Summary("NXGL", healthyFetcher, now + 500, {
      maxXmlDocs: 2,
      concurrency: 1,
    });
    expect(healthyXmlCalls).toBe(2);
    expect(recovered).not.toBeNull();
    expect(recovered?.xmlVerified).toBe(true);
    expect(recovered?.count).toBe(2);

    const recoveredSnap = resolveFundamentalSnapshot("NXGL", 5.5, "USD", "Nexgel, Inc.", undefined, recovered);
    expect(recoveredSnap.dataSources).toContain("SEC Form 4 XML");
  });

  it("handles partial XML 429 failures without poisoning secCache and distinguishes SEC EDGAR submissions from SEC Form 4 XML", async () => {
    const now = Date.UTC(2026, 2, 1);
    const saleOnlyXml = SAMPLE_FORM4_XML.replace("<transactionCode>P</transactionCode>", "<transactionCode>S</transactionCode>");
    const submissionsPayload = JSON.stringify({
      filings: {
        recent: {
          form: ["4", "4"],
          filingDate: ["2026-02-20", "2026-02-18"],
          accessionNumber: ["0000050863-26-000010", "0000050863-26-000009"],
          primaryDocument: ["form4_first.xml", "form4_second.xml"],
        },
      },
    });

    const partial429Fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("data.sec.gov/submissions/")) return new Response(submissionsPayload, { status: 200 });
      if (url.includes("form4_first.xml")) return new Response(saleOnlyXml, { status: 200 });
      if (url.includes("form4_second.xml")) {
        return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "0" } });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    // 1 ok non-buy + 1 429 -> must NOT poison cache with { count: 0, filings: [] }
    const partialRes = await fetchSecEdgarForm4Summary("INTC", partial429Fetcher, now, {
      maxXmlDocs: 2,
      concurrency: 1,
    });
    expect(partialRes).toBeNull();

    // Retry succeeds -> recovers immediately
    const okFetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("data.sec.gov/submissions/")) return new Response(submissionsPayload, { status: 200 });
      if (url.includes("form4_first.xml")) return new Response(saleOnlyXml, { status: 200 });
      if (url.includes("form4_second.xml")) return new Response(SAMPLE_FORM4_XML, { status: 200 });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const fullRes = await fetchSecEdgarForm4Summary("INTC", okFetcher, now + 1_000, { maxXmlDocs: 2 });
    expect(fullRes?.xmlVerified).toBe(true);
    expect(fullRes?.count).toBe(1);

    // Zero Form 4 filings in submissions (no XML fetched) -> emits "SEC EDGAR", NOT "SEC Form 4 XML"
    const emptySubmissionsFetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("data.sec.gov/submissions/")) {
        return new Response(
          JSON.stringify({ filings: { recent: { form: ["10-K"], filingDate: ["2026-02-15"] } } }),
          { status: 200 },
        );
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const noForm4Res = await fetchSecEdgarForm4Summary("AAPL", emptySubmissionsFetcher, now);
    expect(noForm4Res).toEqual({ count: 0, filings: [], xmlVerified: false });
    const noForm4Snap = resolveFundamentalSnapshot("AAPL", 220, "USD", "Apple Inc.", undefined, noForm4Res, {
      openInsider: [
        {
          date: "2026-02-14",
          insider: "Director",
          role: "Director",
          shares: 500,
          price: 220,
          valueUsd: 110_000,
          form: "OpenInsider P",
        },
      ],
    });
    expect(noForm4Snap.dataSources).toContain("SEC EDGAR");
    expect(noForm4Snap.dataSources).not.toContain("SEC Form 4 XML");
  });

  it("caps batch Form 4 XML scans with early-stop without downgrading subsequent 8-doc single-ticker lookups", async () => {
    const now = Date.UTC(2026, 2, 1);
    const submissionsPayload = JSON.stringify({
      filings: {
        recent: {
          form: ["4", "4", "4", "4"],
          filingDate: ["2026-02-22", "2026-02-21", "2026-02-20", "2026-02-19"],
          accessionNumber: [
            "0000320193-26-000004",
            "0000320193-26-000003",
            "0000320193-26-000002",
            "0000320193-26-000001",
          ],
          primaryDocument: ["d1.xml", "d2.xml", "d3.xml", "d4.xml"],
        },
      },
    });
    const xmlCalls: string[] = [];
    const mockFetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("data.sec.gov/submissions/")) return new Response(submissionsPayload, { status: 200 });
      if (url.includes("sec.gov/Archives/edgar/data/")) {
        xmlCalls.push(url);
        return new Response(SAMPLE_FORM4_XML, { status: 200 });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    // Batch scan caps at maxXmlDocs=3 and stops early once 1 buy is found
    const batchRes = await fetchSecEdgarForm4Summary("AAPL", mockFetcher, now, {
      maxXmlDocs: 3,
      stopAfterBuys: 1,
      concurrency: 1,
    });
    expect(batchRes?.count).toBe(1);
    expect(xmlCalls).toHaveLength(1);

    // Subsequent single-ticker lookup requesting up to 8 docs upgrades cleanly and checks all 4 docs
    const fullRes = await fetchSecEdgarForm4Summary("AAPL", mockFetcher, now + 500, {
      maxXmlDocs: 8,
      concurrency: 2,
    });
    expect(fullRes?.count).toBe(4);
    expect(xmlCalls).toHaveLength(5);
  });

  it("paces concurrent SEC endpoints via secFetch (~130ms spacing), handles brief 429 Retry-After, and aborts cleanly", async () => {
    const startTimes: number[] = [];
    const pacingFetcher = vi.fn(async () => {
      startTimes.push(Date.now());
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await Promise.all([
      secFetch("https://www.sec.gov/files/company_tickers.json", { fetcher: pacingFetcher }),
      secFetch("https://data.sec.gov/submissions/CIK0000050863.json", { fetcher: pacingFetcher }),
      secFetch("https://data.sec.gov/api/xbrl/companyfacts/CIK0000050863.json", { fetcher: pacingFetcher }),
      secFetch("https://www.sec.gov/Archives/edgar/data/50863/000005086326000001/f4.xml", { fetcher: pacingFetcher }),
    ]);

    expect(startTimes).toHaveLength(4);
    for (let i = 1; i < startTimes.length; i++) {
      expect(startTimes[i] - startTimes[i - 1]).toBeGreaterThanOrEqual(SEC_MIN_INTERVAL_MS - 2);
    }

    // Brief 429 Retry-After triggers a single retry and succeeds
    clearSecForm4Caches();
    let retryAttempt = 0;
    const retryFetcher = vi.fn(async () => {
      retryAttempt++;
      if (retryAttempt === 1) {
        return new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } });
      }
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const retriedRes = await secFetch("https://data.sec.gov/submissions/CIK0000050863.json", { fetcher: retryFetcher });
    expect(retriedRes.status).toBe(200);
    expect(retryAttempt).toBe(2);

    // Huge Retry-After beyond retry budget returns 429 immediately without stalling
    clearSecForm4Caches();
    const stalledFetcher = vi.fn(async () =>
      new Response("rate limited", { status: 429, headers: { "Retry-After": "120" } }),
    ) as unknown as typeof fetch;
    const t0 = Date.now();
    const hugeRetryRes = await secFetch("https://data.sec.gov/submissions/CIK0000050863.json", {
      fetcher: stalledFetcher,
      retryBudgetMs: 1_500,
    });
    expect(hugeRetryRes.status).toBe(429);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(stalledFetcher).toHaveBeenCalledTimes(1);

    // Queued call aborts cleanly via AbortSignal without invoking fetcher
    clearSecForm4Caches();
    const controller = new AbortController();
    const abortFetcher = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const p1 = secFetch("https://data.sec.gov/submissions/CIK0000050863.json", { fetcher: abortFetcher });
    const p2 = secFetch("https://data.sec.gov/submissions/CIK0000320193.json", {
      fetcher: abortFetcher,
      signal: controller.signal,
    });
    controller.abort();
    await expect(p1).resolves.toMatchObject({ status: 200 });
    await expect(p2).rejects.toThrow();
    expect(abortFetcher).toHaveBeenCalledTimes(1);
  });
});
