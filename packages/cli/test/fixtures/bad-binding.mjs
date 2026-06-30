// A malformed `optimize --binding` module — missing `fixer`. loadBinding must reject it with a clear error
// (a --fix binding has nothing to propose without a fixer).
export const oracle = async () => ({});
export const copyScope = async (node) => `cand:${node}`;
// no `fixer` export
