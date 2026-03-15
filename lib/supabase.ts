import { createClient } from "@supabase/supabase-js";

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Fall back to safe placeholder values during build / when env vars are missing
const supabaseUrl =
  rawUrl.startsWith("http") ? rawUrl : "https://placeholder.supabase.co";
const supabaseAnonKey = rawKey.length > 10 ? rawKey : "placeholder-anon-key";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Availability = {
  id: string;
  user_name: string;
  slot_key: string;
  created_at: string;
};
