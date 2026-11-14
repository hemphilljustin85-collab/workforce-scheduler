import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local"
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Right after signing in, the database can reject the brand-new sign-in token
 * with "JWT issued at future" when its clock is a few seconds behind the
 * sign-in server's. The token becomes valid moments later, so wait and retry
 * instead of showing the error.
 */
async function fetchWithClockSkewRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let response = await fetch(input, init);
  for (const delay of [1500, 3000, 5000]) {
    if (response.status !== 401) return response;
    const text = await response.clone().text().catch(() => "");
    if (!/issued at future/i.test(text)) return response;
    await sleep(delay);
    response = await fetch(input, init);
  }
  return response;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithClockSkewRetry },
});
