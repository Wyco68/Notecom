import AppShell from "@/components/layout/AppShell";
import GenerateJobsProvider from "@/components/generate/GenerateJobsProvider";

// The provider sits above the shell rather than inside it because a generation
// run outlives the dialog that starts it: it owns the job list and the log
// stream, and AppShell only reads them. See the note at the top of
// GenerateJobsProvider.
export default function VaultPage() {
  return (
    <GenerateJobsProvider>
      <AppShell />
    </GenerateJobsProvider>
  );
}
