import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "./errors.ts";

let serviceClient: SupabaseClient | null = null;

export function getSupabaseServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new ApiError(503, "SUPABASE_NOT_CONFIGURED", "Supabase 서버 환경변수가 설정되지 않았습니다.");
  }

  serviceClient ??= createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return serviceClient;
}
