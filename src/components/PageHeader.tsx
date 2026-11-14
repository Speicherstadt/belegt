export function PageHeader({ title, intro }: { title: string; intro: string }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="m-0 font-semibold text-2xl tracking-tight">{title}</h1>
      <p className="m-0 text-muted text-sm">{intro}</p>
    </header>
  );
}

export function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <section className="flex flex-col items-center gap-2 rounded-lg border border-border px-6 py-12 text-center">
      <h2 className="m-0 font-medium text-base">{title}</h2>
      <p className="m-0 text-muted text-sm">{text}</p>
    </section>
  );
}
