import type { NextRequest } from "next/server";
import { passwordAccountForm } from "@/lib/server/accountHttp";

export const dynamic = "force-dynamic";
export const POST = (request: NextRequest) => passwordAccountForm(request, "account");
