import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { scryptSync } from "node:crypto";
import { readLegalOperator, renderDatenschutzPage, renderImpressumPage, renderRisikohinweisPage } from "@/lib/server/legal";
import { proxy } from "@/proxy";

const salt = "c".repeat(32);
const passwordHash = `${salt}:${scryptSync("legal-test-pass", salt, 64).toString("hex")}`;
const sessionSecret = "d".repeat(64);

function configureSite() {
  vi.stubEnv("AFFENTRADER_SITE_PASSWORD_HASH", passwordHash);
  vi.stubEnv("AFFENTRADER_SITE_SESSION_SECRET", sessionSecret);
}

function req(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost:3000${path}`, init);
}

afterEach(() => vi.unstubAllEnvs());

describe("legal pages and Impressum env configuration", () => {
  it("reports unconfigured gracefully when no operator env vars are set", () => {
    const op = readLegalOperator({});
    expect(op.configured).toBe(false);
    const html = renderImpressumPage({});
    expect(html).toContain("AFFENTRADER_IMPRESSUM_JSON");
    expect(html).toContain("Keine Anlageberatung");
  });

  it("parses AFFENTRADER_IMPRESSUM_JSON and escapes HTML characters safely", () => {
    const env = {
      AFFENTRADER_IMPRESSUM_JSON: JSON.stringify({
        name: "Max <script>alert(1)</script> Mustermann",
        businessName: "Muster Studio",
        street: "Musterstraße 1",
        city: "12345 Musterstadt",
        country: "Deutschland",
        phone: "+49 30 1234567",
        email: "kontakt@example.test",
      }),
    };
    const op = readLegalOperator(env);
    expect(op.configured).toBe(true);
    expect(op.country).toBe("Deutschland");

    const impressumHtml = renderImpressumPage(env);
    expect(impressumHtml).toContain("Angaben gemäß § 5 DDG");
    expect(impressumHtml).toContain("Muster Studio");
    expect(impressumHtml).toContain("Musterstraße 1");
    expect(impressumHtml).toContain("href=\"tel:+49301234567\"");
    expect(impressumHtml).toContain("href=\"mailto:kontakt@example.test\"");
    expect(impressumHtml).not.toContain("<script>");

    const privacyHtml = renderDatenschutzPage(env);
    expect(privacyHtml).toContain("Datenschutzerklärung");
    expect(privacyHtml).toContain("Musterstadt");
    expect(privacyHtml).toContain("Germany West Central");
    expect(privacyHtml).not.toContain("<script>");
  });

  it("supports individual AFFENTRADER_IMPRESSUM_* env vars as fallback", () => {
    const env = {
      AFFENTRADER_IMPRESSUM_NAME: "Erika Beispiel",
      AFFENTRADER_IMPRESSUM_STREET: "Beispielweg 9",
      AFFENTRADER_IMPRESSUM_CITY: "70173 Stuttgart",
      AFFENTRADER_IMPRESSUM_EMAIL: "info@example.test",
    };
    const op = readLegalOperator(env);
    expect(op.configured).toBe(true);
    expect(op.name).toBe("Erika Beispiel");
    expect(op.country).toBe("Deutschland");
  });

  it("renders a comprehensive non-advice risk disclaimer on /risikohinweis", () => {
    const html = renderRisikohinweisPage({});
    expect(html).toContain("Keine Anlageberatung");
    expect(html).toContain("Totalverlustrisiko");
    expect(html).toContain("WpHG");
    expect(html).toContain("Haftungsbeschränkung");
  });

  it("serves /impressum, /risikohinweis, and /datenschutz publicly before login and rejects non-GET methods", async () => {
    configureSite();
    vi.stubEnv("AFFENTRADER_IMPRESSUM_JSON", JSON.stringify({
      name: "Test Betreiber",
      street: "Testweg 4",
      city: "10115 Berlin",
      email: "legal@example.test",
    }));

    for (const path of ["/impressum", "/risikohinweis", "/datenschutz"]) {
      const res = await proxy(req(path));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(res.headers.get("x-robots-tag")).toContain("noindex");
      const postRes = await proxy(req(path, { method: "POST" }));
      expect(postRes.status).toBe(405);
    }

    const loginRes = await proxy(req("/login"));
    const loginHtml = await loginRes.text();
    expect(loginHtml).toContain('href="/impressum"');
    expect(loginHtml).toContain('href="/risikohinweis"');
    expect(loginHtml).toContain('href="/datenschutz"');
    expect(loginHtml).toContain("keine Anlageberatung");
  });
});
