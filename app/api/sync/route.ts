import { NextRequest, NextResponse } from "next/server";
import { HttpError, readJson } from "@/lib/server/security";
import { logError } from "@/lib/server/logger";
import {
  SyncError,
  deleteSync,
  pullSync,
  pushSync,
  validKey,
} from "@/lib/server/sync";

export const dynamic = "force-dynamic";

function keyOf(request: NextRequest): string {
  const key = request.headers.get("x-affentrader-sync");
  if (!validKey(key)) throw new SyncError(401, "Missing or invalid sync key.");
  return key;
}

function failure(error: unknown) {
  if (error instanceof SyncError)
    return NextResponse.json({ error: error.message, current: error.current }, { status: error.status });
  if (error instanceof HttpError)
    return NextResponse.json({ error: error.message }, { status: error.status });
  logError("api.sync.error", error);
  return NextResponse.json({ error: "Sync service error." }, { status: 500 });
}

/** Pull the stored workspace; `?peek=1` returns only its revision. */
export async function GET(request: NextRequest) {
  try {
    const doc = await pullSync(keyOf(request));
    if (!doc) return NextResponse.json({ revision: 0, updatedAt: 0, device: "", data: null });
    if (request.nextUrl.searchParams.get("peek") === "1")
      return NextResponse.json({ revision: doc.revision, updatedAt: doc.updatedAt, device: doc.device });
    return NextResponse.json(doc);
  } catch (error) {
    return failure(error);
  }
}

/** Push a workspace: `{ data, baseRevision, device }`. */
export async function PUT(request: NextRequest) {
  try {
    const key = keyOf(request);
    const body = (await readJson(request, 8_100_000)) as {
      data?: unknown;
      baseRevision?: unknown;
      device?: unknown;
    };
    const baseRevision = body.baseRevision === undefined ? 0 : body.baseRevision;
    if (typeof baseRevision !== "number" || !Number.isInteger(baseRevision) || baseRevision < 0) {
      throw new HttpError(400, "Invalid baseRevision.");
    }
    if (body.device !== undefined && typeof body.device !== "string") {
      throw new HttpError(400, "Invalid device.");
    }
    const result = await pushSync(key, {
      data: body.data,
      baseRevision,
      device: body.device ?? "device",
    });
    return NextResponse.json(result);
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await deleteSync(keyOf(request));
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return failure(error);
  }
}
