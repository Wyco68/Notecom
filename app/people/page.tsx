import PeoplePanel from "@/components/collab/PeoplePanel";

// The standalone route. People normally opens inside the workspace's content
// column (AppShell keeps the sidebar and the open document alive behind it);
// this page is what a deep link lands on, same pattern as /discover.
export default function PeoplePage() {
  return <PeoplePanel />;
}
