/** Maximum complete output units per transform. Failure never returns a truncated financial series. */
export const MAX_DERIVED_MARKS = 50_000;
export class DerivedTransformError extends Error {
  constructor(readonly reason: "capacity" | "precision") {
    super(reason === "capacity" ? "This box size needs more than 50,000 marks. Increase the box size or load less history." :
      "This box size is below the price precision supported here. Increase the box size.");
    this.name = "DerivedTransformError";
  }
}
export function requireMarkCapacity(count: number) {
  if (!Number.isFinite(count) || count > MAX_DERIVED_MARKS) throw new DerivedTransformError("capacity");
}
export function requirePriceStep(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) throw new DerivedTransformError("precision");
}
