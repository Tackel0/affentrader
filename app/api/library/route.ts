import { NextRequest, NextResponse } from "next/server";
import { HttpError, isAuthorized, readJson } from "@/lib/server/security";
import { logError } from "@/lib/server/logger";
import {
  LibraryError,
  deleteScript,
  getScript,
  listScripts,
  mine,
  openInvite,
  publishScript,
  setLike,
  updateScript,
  validToken,
  type ScriptInput,
} from "@/lib/server/library";

export const dynamic = "force-dynamic";

function failure(error: unknown) {
  if (error instanceof LibraryError || error instanceof HttpError)
    return NextResponse.json({ error: error.message }, { status: error.status });
  logError("api.library.error", error);
  return NextResponse.json({ error: "Script library error." }, { status: 500 });
}

async function requireOwner(request: NextRequest) {
  if (!(await isAuthorized(request)))
    throw new LibraryError(401, "Publishing needs this server's access key.");
}

function tokenOf(request: NextRequest): string | undefined {
  const token = request.headers.get("x-affentrader-reader");
  return validToken(token) ? token : undefined;
}

/**
 * Reading is open: `?q=&kind=&sort=` lists public scripts, `?id=` fetches one
 * (invite-only ones also need `&invite=`), `?invite=` alone opens an invite code
 * and `?mine=1` lists everything for the publisher (server key required).
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  try {
    const token = tokenOf(request);
    if (q.get("mine") === "1") {
      await requireOwner(request);
      return NextResponse.json({ scripts: await mine() });
    }
    const id = q.get("id");
    const invite = q.get("invite") ?? undefined;
    if (invite && invite.length > 256) throw new LibraryError(400, "Invalid invite code.");
    if (id) {
      if (id.length > 128) throw new LibraryError(400, "Invalid script id.");
      const owner = (await isAuthorized(request)) && q.get("owner") === "1";
      return NextResponse.json({ script: await getScript(id, { invite, token, owner }) });
    }
    if (invite) return NextResponse.json({ script: await openInvite(invite, token) });
    const parsedLimit = Number(q.get("limit") ?? 50);
    return NextResponse.json({
      scripts: await listScripts({
        query: q.get("q") ?? "",
        kind: q.get("kind") ?? "",
        sort: q.get("sort") ?? "",
        limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
      }),
    });
  } catch (error) {
    return failure(error);
  }
}

/** Publish (server key) or like/unlike (anonymous reader token). */
export async function POST(request: NextRequest) {
  try {
    const body = (await readJson(request, 400_000)) as ScriptInput & {
      action?: string;
      id?: string;
      liked?: boolean;
      invite?: string;
    };
    if (body.action === "like") {
      const token = tokenOf(request);
      if (!token || typeof body.id !== "string" || !body.id || body.id.length > 128)
        throw new LibraryError(400, "Missing reader token or script id.");
      if (body.invite !== undefined && (typeof body.invite !== "string" || body.invite.length > 256))
        throw new LibraryError(400, "Invalid invite code.");
      return NextResponse.json(await setLike(body.id, token, body.liked !== false, body.invite));
    }
    await requireOwner(request);
    return NextResponse.json(await publishScript(body));
  } catch (error) {
    return failure(error);
  }
}

/** Publish a new version / edit details: `{ id, ...fields }`. */
export async function PUT(request: NextRequest) {
  try {
    await requireOwner(request);
    const body = (await readJson(request, 400_000)) as ScriptInput & { id?: string };
    if (typeof body.id !== "string" || !body.id || body.id.length > 128)
      throw new LibraryError(400, "Missing script id.");
    return NextResponse.json(await updateScript(body.id, body));
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireOwner(request);
    const id = request.nextUrl.searchParams.get("id") ?? "";
    if (!id || id.length > 128) throw new LibraryError(400, "Missing script id.");
    return NextResponse.json({ removed: await deleteScript(id) });
  } catch (error) {
    return failure(error);
  }
}
