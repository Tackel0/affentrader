import { expect, it } from "vitest";
import { depthMetrics } from "@/lib/orderflow/depthMetrics";

it("uses equal depth on both sides and preserves a small decimal spread with large quantities", () => {
  const book = {
    bids: [{ price: 0.1, quantity: 1e308 }, { price: 0.09, quantity: 1e308 }, { price: 0.08, quantity: 1e308 }],
    asks: [{ price: 0.11, quantity: 1e308 }, { price: 0.12, quantity: 5e307 }],
  };
  expect(depthMetrics(book, 6)).toMatchObject({ levels: 2, spread: 0.01, bidShare: 2 / 3.5 });
  expect(depthMetrics(book, 1)?.bidShare).toBe(0.5);
});
