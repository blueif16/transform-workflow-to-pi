/* CodeEditor — the hero coding panel ("a flow, in a few lines"). Light system
   via the .editor tokens (white surface, orange caret). Kept as its own module
   so it can be dropped back into any section with a single import. */
export default function CodeEditor() {
  const Kw = ({ children }: { children: React.ReactNode }) => (
    <span className="text-fg">{children}</span>
  );
  const Arg = ({ children }: { children: React.ReactNode }) => (
    <span className="text-fg-muted">{children}</span>
  );
  return (
    <div className="editor w-full">
      <div className="editor-bar">
        <span className="editor-dot" />
        <span className="editor-dot" />
        <span className="editor-dot" />
        <span className="ml-2 font-mono text-xs text-fg-faint">
          a flow, in a few lines
        </span>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-7">
        <code>
          <Kw>flow</Kw> <Arg>&quot;morning repost&quot;</Arg>
          {"\n"}
          {"  "}
          <Kw>every</Kw> <Arg>day at 8:00am</Arg>
          {"\n"}
          {"  "}
          <Kw>watch</Kw>
          {"  "}
          <Arg>&lt;paste a post URL&gt;</Arg>
          {"\n"}
          {"  "}
          <Kw>rewrite</Kw> <Arg>it in my voice</Arg>
          {"\n"}
          {"  "}
          <Kw>post</Kw>
          {"   "}
          <Arg>to my channel</Arg>
          <span className="caret" aria-hidden />
        </code>
      </pre>
      <div className="flex items-center gap-2 border-t border-[var(--hairline)] px-5 py-3 font-mono text-xs text-fg-muted">
        <span className="size-1.5 rounded-full bg-accent" aria-hidden />
        designed, running, and improving — every run
      </div>
    </div>
  );
}
