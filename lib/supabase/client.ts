"use client";

import { createBrowserClient } from "@supabase/ssr";

import { missingEnvError } from "@/lib/env";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw missingEnvError(
      ...(url ? [] : ["NEXT_PUBLIC_SUPABASE_URL"]),
      ...(anonKey ? [] : ["NEXT_PUBLIC_SUPABASE_ANON_KEY"])
    );
  }

  return createBrowserClient(url, anonKey);
}
