import { Inbox } from "./components/Inbox.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { m } from "./paraglide/messages.js";

export function App() {
  return (
    <div className="flex min-h-screen flex-wrap bg-bg text-fg">
      <a
        href="#inhalt"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-onprimary"
      >
        {m.skip_link()}
      </a>
      <Sidebar />
      <main id="inhalt" className="min-w-0 flex-[999_1_560px] px-8 py-6">
        <Inbox />
      </main>
    </div>
  );
}
