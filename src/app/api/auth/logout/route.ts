import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { appUrl } from "@/lib/config";
import { destroySession, SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  await destroySession(await getDb(), req.cookies.get(SESSION_COOKIE)?.value);
  const res = NextResponse.redirect(`${appUrl()}/`, 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
