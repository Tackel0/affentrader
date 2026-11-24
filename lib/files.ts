export function downloadFile(
  filename: string,
  content: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || typeof File === "undefined") return false;
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File(["x"], "chart.csv", { type: "text/csv" })] });
  } catch {
    return false;
  }
}

export async function shareFile(
  filename: string,
  content: string,
  type = "text/csv;charset=utf-8",
): Promise<"shared" | "cancelled" | "unsupported"> {
  if (!canShareFiles()) return "unsupported";
  const file = new File([content], filename, { type });
  try {
    await navigator.share({ files: [file], title: filename });
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    return "unsupported";
  }
}

