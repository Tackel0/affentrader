import { NextRequest, NextResponse } from "next/server";
import { HttpError, isAuthorized, readJson } from "@/lib/server/security";
import { logError } from "@/lib/server/logger";
import {
  addSubscription,
  removeSubscription,
  sendPush,
  validSubscription,
  vapidKeys,
} from "@/lib/server/push";

export const dynamic = "force-dynamic";

/** The public VAPID key browsers need to subscribe (public by design). */
export async function GET() {
  try {
    return NextResponse.json({ publicKey: (await vapidKeys()).publicKey });
  } catch (error) {
    logError("api.push.get", error);
    return NextResponse.json({ error: "Push service error." }, { status: 500 });
  }
}

async function guard(request: NextRequest) {
  return (await isAuthorized(request))
    ? null
    : NextResponse.json({ error: "Missing or invalid server access key." }, { status: 401 });
}

/** Register this browser (`{ subscription }`) or send a test (`{ test: true }`). */
export async function POST(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const body = (await readJson(request, 8 * 1024)) as { subscription?: unknown; test?: boolean };
    if (body.test) {
      const result = await sendPush({ title: "Affentrader", body: "Push notifications are working.", tag: "test" });
      return NextResponse.json(result);
    }
    if (!validSubscription(body.subscription)) throw new HttpError(400, "Invalid push subscription.");
    await addSubscription(body.subscription);
    return NextResponse.json({ subscribed: true });
  } catch (error) {
    if (error instanceof HttpError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    logError("api.push.post", error);
    return NextResponse.json({ error: "Push service error." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  const endpoint = request.nextUrl.searchParams.get("endpoint");
  if (!endpoint || !/^https:\/\//.test(endpoint) || endpoint.length >= 1000)
    return NextResponse.json({ error: "Missing or invalid endpoint." }, { status: 400 });
  try {
    await removeSubscription(endpoint);
    return NextResponse.json({ removed: true });
  } catch (error) {
    logError("api.push.delete", error);
    return NextResponse.json({ error: "Push service error." }, { status: 500 });
  }
}
