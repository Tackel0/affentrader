// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";

import { ModuleErrorBoundary } from "@/components/ModuleErrorBoundary";
import WorkspaceError from "@/app/error";
import TerminalError from "@/app/terminal/error";
import GlobalError from "@/app/global-error";
import NotFound from "@/app/not-found";

function Bomb({ shouldThrow, message = "Boom in widget\nwith stack-like line" }: { shouldThrow: boolean; message?: string }) {
  if (shouldThrow) {
    throw new Error(message);
  }
  return <div data-testid="healthy-child">Recovered content</div>;
}

describe("Error boundaries & Next.js 16 route fallbacks", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders ModuleErrorBoundary with zero DOM wrapper when healthy", () => {
    const { container } = render(
      <ModuleErrorBoundary moduleName="Chart Grid">
        <section data-testid="direct-child">Direct child</section>
      </ModuleErrorBoundary>,
    );
    expect(container.firstElementChild?.getAttribute("data-testid")).toBe("direct-child");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("catches child render crashes, supports manual retry, and auto-recovers when resetKey changes", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onReset = vi.fn();

    let throwNow = true;
    function DynamicBomb() {
      return <Bomb shouldThrow={throwNow} />;
    }

    const { container, rerender } = render(
      <ModuleErrorBoundary moduleName="Opportunities" resetKey="opps" onReset={onReset}>
        <DynamicBomb />
      </ModuleErrorBoundary>,
    );

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Opportunities encountered an error");
    expect(alert?.textContent).toContain("Boom in widget with stack-like line");

    // Clicking Retry module clears error state and invokes onReset
    throwNow = false;
    fireEvent.click(within(container).getByRole("button", { name: /Retry module/i }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(within(container).getByTestId("healthy-child").textContent).toBe("Recovered content");
    expect(container.querySelector('[role="alert"]')).toBeNull();

    // Crash again, then switch resetKey -> automatic recovery
    throwNow = true;
    rerender(
      <ModuleErrorBoundary moduleName="Opportunities" resetKey="opps" onReset={onReset}>
        <Bomb shouldThrow={true} message="Second crash" />
      </ModuleErrorBoundary>,
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Second crash");

    rerender(
      <ModuleErrorBoundary moduleName="Markets" resetKey="markets" onReset={onReset}>
        <Bomb shouldThrow={false} />
      </ModuleErrorBoundary>,
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(within(container).getByTestId("healthy-child").textContent).toBe("Recovered content");

    expect(consoleSpy).toHaveBeenCalled();
  });

  it("renders WorkspaceError (app/error.tsx) with digest, navigation links, and retry handler", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    const err = Object.assign(new Error("Chart feed crashed"), { digest: "DIGEST-ROOT-42" });

    const { container } = render(<WorkspaceError error={err} retry={retry} />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Chart workspace interrupted");
    expect(alert?.textContent).toContain("Chart feed crashed");
    expect(alert?.textContent).toContain("DIGEST-ROOT-42");

    fireEvent.click(within(container).getByRole("button", { name: /Try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);

    const links = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toContain("/");
    expect(links).toContain("/terminal");
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("renders TerminalError (app/terminal/error.tsx) with scoped recovery links and retry handler", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    const err = Object.assign(new Error("Terminal pane fault"), { digest: "DIGEST-TERM-99" });

    const { container } = render(<TerminalError error={err} retry={retry} />);
    expect(container.textContent).toContain("AffenTerminal view interrupted");
    expect(container.textContent).toContain("Terminal pane fault");
    expect(container.textContent).toContain("DIGEST-TERM-99");

    fireEvent.click(within(container).getByRole("button", { name: /Try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);

    const links = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toContain("/terminal");
    expect(links).toContain("/");
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("renders GlobalError (app/global-error.tsx) inside a clean document shell with retry callback", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    const err = Object.assign(new Error("Root layout fault"), { digest: "DIGEST-GLOBAL-7" });

    const doc = document.implementation.createHTMLDocument("Test");
    render(<GlobalError error={err} retry={retry} />, { container: doc.documentElement });

    expect(doc.body.textContent).toContain("Application shell interrupted");
    expect(doc.body.textContent).toContain("Root layout fault");
    expect(doc.body.textContent).toContain("DIGEST-GLOBAL-7");

    const buttons = Array.from(doc.body.querySelectorAll("button"));
    const tryAgainBtn = buttons.find((b) => /Try again/i.test(b.textContent ?? ""));
    const reloadBtn = buttons.find((b) => /Reload app/i.test(b.textContent ?? ""));
    expect(tryAgainBtn).toBeDefined();
    expect(reloadBtn).toBeDefined();

    act(() => {
      tryAgainBtn!.click();
    });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("renders NotFound (app/not-found.tsx) with workspace navigation links", () => {
    const { container } = render(<NotFound />);
    expect(container.textContent).toContain("404 · Route Not Found");
    const links = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toContain("/");
    expect(links).toContain("/terminal");
  });
});
