import Link from "next/link";
import { getNav } from "@/lib/docs.mjs";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const nav = getNav();
  return (
    <>
      <div className="grain" aria-hidden />
      <div className="relative min-h-dvh">
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
          <Link href="/" className="font-mono text-sm tracking-tight text-fg">
            ◆ Pi Flow
          </Link>
          <Link
            href="/docs"
            className="font-mono text-xs uppercase tracking-[0.18em] text-fg-muted transition-colors hover:text-fg"
          >
            Docs
          </Link>
        </header>

        <div className="mx-auto flex w-full max-w-6xl gap-12 px-6 pb-24">
          <aside className="hidden w-56 shrink-0 lg:block">
            <nav className="sticky top-8 space-y-7 text-sm">
              {nav.map((section) => (
                <div key={section.key}>
                  <p className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
                    {section.title}
                  </p>
                  <ul className="space-y-1.5">
                    {section.pages.map((page) => (
                      <li key={page.route}>
                        <Link
                          href={page.route}
                          className="text-fg-muted transition-colors hover:text-fg"
                        >
                          {page.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>

          <main className="min-w-0 max-w-2xl flex-1 py-4">{children}</main>
        </div>
      </div>
    </>
  );
}
