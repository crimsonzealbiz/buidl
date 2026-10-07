import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { completeLink } from "@/lib/wallet/link";
import { AppError } from "@/lib/errors";
import { getSession } from "@/server/session";
import { jsonError } from "../../_respond";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) throw new AppError("unauthenticated", "Sign in with GitHub first");
    const { nonce, signature } = (await req.json()) as { nonce?: string; signature?: string };
    const w = await completeLink(await getDb(), session.user, String(nonce ?? ""), String(signature ?? ""));
    return NextResponse.json({ address: w.address, linkedAt: w.linkedAt });
  } catch (e) {
    return jsonError(e);
  }
}
