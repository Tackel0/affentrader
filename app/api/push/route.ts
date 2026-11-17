import { NextRequest, NextResponse } from "next/server";
import { HttpError, isAuthorized, readJson } from "@/lib/server/security";
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
  return NextResponse.json({ publicKey: (await vapidKeys()).publicKey });
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
    return NextResponse.json({ error: "Push service error." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  const endpoint = request.nextUrl.searchParams.get("endpoint");
  if (!endpoint) return NextResponse.json({ error: "Missing endpoint." }, { status: 400 });
  await removeSubscription(endpoint);
  return NextResponse.json({ removed: true });
}
