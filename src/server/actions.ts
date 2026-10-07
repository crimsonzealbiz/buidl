import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";

/** Human-readable message for an expected failure; rethrows anything unexpected. */
export function errorMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e instanceof ZodError) {
    return e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
  }
  throw e;
}

/**
 * Runs a server action body and redirects back with a flash message. Errors
 * are reported to the user verbatim; nothing is reported as success unless
 * the operation completed.
 */
export async function act(path: string, fn: () => Promise<string | void>): Promise<never> {
  let target: string;
  try {
    const ok = await fn();
    target = `${path}${path.includes("?") ? "&" : "?"}ok=${encodeURIComponent(ok ?? "Saved")}`;
  } catch (e) {
    target = `${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(errorMessage(e))}`;
  }
  revalidatePath(path.split("?")[0]);
  redirect(target);
}

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}
