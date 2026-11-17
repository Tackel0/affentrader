import { expect, test, vi } from "vitest";
import { azureDeploymentDate } from "@/lib/azureDeploymentDate";
import { siteLoginPage } from "@/lib/server/siteLoginPage";

test("decodes the UTC timestamp of a deployed revision", () => {
  expect(azureDeploymentDate("affenterminal--r20261115192421-4a3b806f")?.toISOString())
    .toBe("2026-11-15T19:24:21.000Z");
});

test.each([undefined, "affenterminal--generated", "affenterminal--r20260230000000-abcd"])(
  "omits timestamps for missing or invalid revisions (%s)",
  (revision) => expect(azureDeploymentDate(revision)).toBeNull(),
);

test("the login shows the release day in Berlin time", () => {
  vi.stubEnv("CONTAINER_APP_REVISION", "affenterminal--r20261115233000-abcd");
  try {
    expect(siteLoginPage("/")).toContain(
      '<time datetime="2026-11-15T23:30:00.000Z">Letztes Update 16.11.2026</time>',
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
