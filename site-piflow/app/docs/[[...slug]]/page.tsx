import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { marked } from "marked";
import { getPage, listPages } from "@/lib/docs.mjs";

type Params = { slug?: string[] };

export function generateStaticParams() {
  return listPages().map((p) => ({ slug: p.segments }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = getPage(slug ?? []);
  if (!page) return {};
  return {
    title: `${page.meta.title} — Pi Flow docs`,
    description: page.meta.summary,
  };
}

export default async function DocPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const page = getPage(slug ?? []);
  if (!page) notFound();

  const html = await marked.parse(page.body);

  return (
    <article>
      <h1 className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-fg">
        {page.meta.title}
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-fg-muted">{page.meta.summary}</p>

      {page.meta.draft ? (
        <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-[var(--hairline)] px-3 py-1 font-mono text-xs text-fg-faint">
          <span className="size-1.5 rounded-full bg-fg-faint" aria-hidden />
          draft — this page is a stub
        </p>
      ) : null}

      <div
        className="doc-content mt-10"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
