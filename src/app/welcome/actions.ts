"use server";

import { createClient } from "@/lib/supabase/server";

export async function completeWelcomeOnboardingAction(input: {
  fullName: string;
  role: string;
  companySize: string;
  theme: "light" | "dark";
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false as const, error: "Not authenticated." };
  }

  const { error } = await supabase.auth.updateUser({
    data: {
      ...user.user_metadata,
      full_name: input.fullName.trim(),
      onboarding_v1_complete: true,
      onboarding_role: input.role,
      onboarding_company_size: input.companySize,
      onboarding_theme: input.theme,
      theme: input.theme,
    },
  });

  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}
