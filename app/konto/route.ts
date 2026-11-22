import type { NextRequest } from "next/server";
import { ACCOUNT_COOKIE, readAccountSession } from "@/lib/server/accounts";
import { accountHtml, googleSettings } from "@/lib/server/accountHttp";
import { accountOverviewPage } from "@/lib/server/siteLoginPage";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const user = await readAccountSession(request.cookies.get(ACCOUNT_COOKIE)?.value);
  return accountHtml(accountOverviewPage(user, Boolean(googleSettings())));
}
