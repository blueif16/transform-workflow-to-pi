// Types for the plain-JS reader in docs.mjs (runtime stays JS so `node` can run
// the generator; the /docs route consumes these types).

export interface DocPage {
  slug: string;
  segments: string[];
  route: string;
  title: string;
  summary: string;
  read_when: string[];
  order: number;
  draft: boolean;
  section: string;
}

export interface DocSection {
  key: string;
  title: string;
  pages: DocPage[];
}

export interface DocMeta {
  title: string;
  summary: string;
  read_when: string[];
  draft?: boolean;
  order?: number;
  [key: string]: unknown;
}

export const SECTIONS: Record<string, { title: string; order: number }>;
export function listPages(): DocPage[];
export function getNav(): DocSection[];
export function getPage(segments?: string[]): { meta: DocMeta; body: string } | null;
