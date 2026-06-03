import { redirect } from "next/navigation";

// This marketing page was removed when the site was collapsed to one story.
// Keep the route reachable but send visitors to the homepage.
export default function Page() {
  redirect("/");
}
