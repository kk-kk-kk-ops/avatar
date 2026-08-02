import { createClient } from "@/lib/supabase/server";
import AvatarSpaceLoader from "@/components/AvatarSpaceLoader";

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let initialName: string | undefined;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle();
    initialName = profile?.display_name ?? undefined;
  }

  return <AvatarSpaceLoader initialName={initialName} />;
}
