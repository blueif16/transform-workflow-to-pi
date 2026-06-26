// (M5 · #11) pre-gate — a `checks.pre` gate must fire BEFORE the model. Today `render.ts` flattens pre→post
// (collectChecks does [...pre, ...post]), so a pre-check only ever runs in the POST verify gate — AFTER the
// model already ran. The unified envelope lowers `checks.pre` to a `{when:'pre', gate}` op with a REAL
// firing site: the runner evaluates pre-gates over the staged inputs and, on a blocking failure, fails the
// node WITHOUT spawning the model.
//
// The discriminating assertion is a CALL-COUNT of 0 on the command builder/execRunner: a "node blocks"
// assertion alone passes vacuously (a missing artifact also blocks). We prove the model NEVER ran.
//
// Written test-first: today there is NO pre-gate firing site, so the node's bad staged input is only caught
// by the post gate AFTER exec — the execRunner IS called (call-count 1). RED for the right reason.

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compile } from '../src/index.js';
import { runWorkflow, type ExecRunner } from '../src/runner/index.js';
import type { NodeIntent, WorkflowSpec } from '../src/index.js';

const wf = (nodes: NodeIntent[]): WorkflowSpec => ({ meta: { name: 't', description: 'd' }, nodes });
const tmpOut = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), 'piflow-pregate-'));

describe('pre-gate — a checks.pre gate fires BEFORE the model (#11)', () => {
  it('a failing pre-gate blocks the node WITHOUT spawning the model (call-count 0)', async () => {
    const outDir = await tmpOut();
    // Stage a MALFORMED input the node's pre-gate (json-parses) will reject.
    await fs.writeFile(path.join(outDir, 'in.json'), '{ this is NOT json');

    // A node whose ONLY contract is a pre-gate over the staged input. (artifacts empty ⇒ returnMode required,
    // but we never reach the model — the pre-gate blocks first.)
    const node: NodeIntent = {
      label: 'consume',
      prompt: 'consume the input',
      tools: {},
      io: {
        reads: ['in.json'],
        produces: ['out.json'],
        externalInputs: ['in.json'],
        artifacts: [{ path: 'out.json' }],
      },
      op: [{ when: 'pre', reads: ['in.json'], gate: { kind: 'json-parses', path: 'in.json' }, onFailure: 'block' }],
    };

    // Count every model spawn — it MUST be 0 (the pre-gate short-circuits before exec).
    let execCalls = 0;
    const countingExec: ExecRunner = async () => {
      execCalls++;
      return { result: { stdout: '', stderr: '', code: 0 }, killed: null };
    };
    let buildCalls = 0;
    const countingBuild = (): string => {
      buildCalls++;
      return 'true';
    };

    const { status } = await runWorkflow(compile(wf([node])), {
      run: 'pregate', outDir, buildCommand: countingBuild, execRunner: countingExec,
    });

    // The node FAILED on the pre-gate …
    expect(status.nodes.consume.status, 'a failing pre-gate must fail the node').not.toBe('ok');
    // … and the model was NEVER spawned (the load-bearing call-count assertion — RED today: the pre-gate has
    // no firing site, so the model runs and the post gate catches it).
    expect(execCalls, 'the model must NOT spawn when a pre-gate blocks').toBe(0);
    expect(buildCalls, 'the command must NOT be built when a pre-gate blocks').toBe(0);
  });
});
