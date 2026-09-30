import "server-only";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

/** Server-only client -- uses the secret key, bypasses RLS. Never import this into a client component. */
export const supabaseAdmin = createClient(url, secretKey);
