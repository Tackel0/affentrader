import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  entry: null as null | { data: { until: number }; etag: string },
  get: vi.fn(), set: vi.fn(), evaluate: vi.fn(), deliver: vi.fn(), configured: true,
}));
vi.mock("@/lib/server/netlifyStorage", () => ({ cloudStore: () => ({ getWithMetadata: fake.get, setJSON: fake.set }) }));
vi.mock("@/lib/server/alertService", () => ({ evaluateRules: fake.evaluate, processDeliveries: fake.deliver, exchangeSource: () => ({}) }));
vi.mock("@/lib/server/siteAccess", () => ({ siteAccessConfig: () => fake.configured ? {} : null }));
import alerts, { config } from "@/netlify/functions/alerts";
beforeEach(() => {
  vi.resetAllMocks(); fake.entry = null; fake.configured = true;
  fake.get.mockImplementation(async () => structuredClone(fake.entry));
  fake.set.mockImplementation(async (_key, data, conditions) => {
    if (conditions.onlyIfNew ? !!fake.entry : conditions.onlyIfMatch !== fake.entry?.etag) return { modified: false };
    const etag = crypto.randomUUID(); fake.entry = { data, etag }; return { modified: true, etag };
  });
  fake.evaluate.mockResolvedValue({ evaluated: 1, fired: 0, errors: [] });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe("Netlify scheduled alert evaluator", () => {
  it("runs once per minute and delivers only after acquiring a lease", async () => {
    expect(config.schedule).toBe("* * * * *"); await alerts();
    expect(fake.evaluate).toHaveBeenCalledTimes(1); expect(fake.deliver).toHaveBeenCalledTimes(1);
    expect(fake.entry?.data.until).toBe(0);
  });
  it("excludes concurrent invocations across serverless instances", async () => {
    await Promise.all([alerts(), alerts()]);
    expect(fake.evaluate).toHaveBeenCalledTimes(1); expect(fake.deliver).toHaveBeenCalledTimes(1);
  });
  it("waits out a killed invocation's lease before recovering", async () => {
    fake.entry = { data: { until: Date.now() + 40_000 }, etag: "old" };
    await alerts(); expect(fake.evaluate).not.toHaveBeenCalled();
    fake.entry.data.until = Date.now() - 1;
    await alerts(); expect(fake.evaluate).toHaveBeenCalledTimes(1);
  });
  it("releases a failed evaluation without sending deliveries", async () => {
    fake.evaluate.mockRejectedValue(new Error("Source failed"));
    await expect(alerts()).rejects.toThrow("Source failed");
    expect(fake.deliver).not.toHaveBeenCalled(); expect(fake.entry?.data.until).toBe(0);
  });
  it("does not clear a newer invocation's lease", async () => {
    fake.evaluate.mockImplementation(async () => {
      fake.entry = { data: { until: Date.now() + 45_000 }, etag: "successor" };
      return { evaluated: 0, fired: 0, errors: [] };
    });
    await alerts(); expect(fake.entry?.etag).toBe("successor");
    expect(fake.entry?.data.until).toBeGreaterThan(Date.now());
  });
  it("fails closed when website authentication is missing", async () => {
    fake.configured = false;
    await expect(alerts()).rejects.toThrow("Configure private site access");
    expect(fake.get).not.toHaveBeenCalled(); expect(fake.evaluate).not.toHaveBeenCalled();
  });
});
