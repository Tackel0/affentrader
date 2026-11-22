import type { NextRequest } from "next/server";
import { beginGoogleAccount } from "@/lib/server/googleAccount";

export const dynamic = "force-dynamic";
export const GET = (request: NextRequest) => beginGoogleAccount(request);
export const POST = (request: NextRequest) => beginGoogleAccount(request);
