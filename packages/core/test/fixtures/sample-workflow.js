// A small fixture Claude Code Workflow for extract.test.ts. NOT imported — it is read as text
// and run under recording stubs (the runtime wraps the body in an AsyncFunction, which is why
// top-level `await`/`return` and the de-exported `meta` are legal here).
//
// Shape it asserts:
//   - meta is a pure literal with two phases
//   - 4 agent() calls total across 2 phase()s
//   - phase "design": ONE serial agent (W0)
//   - phase "build": a parallel([...]) of TWO agents, then ONE serial agent (W4)
//   => 4 records, 3 stages (serial W0, ∥ x2, serial W4)
//   - W0's prompt interpolates args.theme (proves the stub records REALIZED values + args threading)

export const meta = {
  name: 'sample-fixture',
  description: 'a tiny extract fixture',
  phases: [
    { id: 'design', detail: 'classify + design' },
    { id: 'build', detail: 'parallel build + assemble' },
  ],
};

phase('design');
await agent(`W0 classify the ${args.theme} game`, { label: 'W0 Classify', agentType: 'classifier' });

phase('build');
await parallel([
  () => agent('W3a art direction', { label: 'W3a Art', schema: 'art.schema.json' }),
  () => agent('W3b assets', { label: 'W3b Assets' }),
]);
await agent('W4 assemble the milestone', { label: 'W4 Execute' });

return { ok: true };
