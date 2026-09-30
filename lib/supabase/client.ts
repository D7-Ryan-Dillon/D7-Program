import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/** Browser-safe client -- uses the publishable key, fine to import in client components. */
export const supabase = createClient(url, publishableKey);
