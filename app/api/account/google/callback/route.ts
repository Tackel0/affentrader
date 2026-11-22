import type { NextRequest } from "next/server";
import { finishGoogleAccount } from "@/lib/server/googleAccount";

export const dynamic = "force-dynamic";
export const GET = (request: NextRequest) => finishGoogleAccount(request);
