declare module "@supabase/supabase-js" {
  export function createClient(url: string, key: string, options?: { global?: { fetch?: typeof fetch } } & Record<string, unknown>): any;
}
