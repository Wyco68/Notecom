import SheetEngine from "@/components/sheet/SheetEngine";

// The page a headless browser opens to lay a cheatsheet out on this machine
// (lib/sheet/device-layout.ts). It holds no data and fetches none: the sheet
// is handed to it over the DevTools protocol, so it needs no session.
export default function SheetEnginePage() {
  return <SheetEngine />;
}
