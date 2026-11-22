import type { NextRequest } from "next/server";
import { accountSecurityForm } from "@/lib/server/accountHttp";

export const dynamic = "force-dynamic";
export const POST = (request: NextRequest) => accountSecurityForm(request, "sessions");
