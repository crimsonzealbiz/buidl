import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { appUrl } from "@/lib/config";
import { createLinkChallenge } from "@/lib/wallet/link";
import { AppError } from "@/lib/errors";
import { getSession } from "@/server/session";
import { jsonError } from "../../_respond";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) throw new AppError("unauthenticated", "Sign in with GitHub first");
    const { address } = (await req.json()) as { address?: string };
    const ch = await createLinkChallenge(await getDb(), session.user, String(address ?? ""), new URL(appUrl()).host);
    return NextResponse.json({ nonce: ch.nonce, message: ch.message, expiresAt: ch.expiresAt });
  } catch (e) {
    return jsonError(e);
  }
}
