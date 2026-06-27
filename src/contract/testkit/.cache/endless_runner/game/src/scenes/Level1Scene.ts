/**
 * Level1Scene — the data-driven shell level (KEEP — engine seam; W2 overwrites the data).
 *
 * Extends DataRunnerScene and loads the committed default `levels/level1.json`. W2
 * overwrites that data per-game (the materialized blueprint.layout + bindings) and the
 * construction path is UNCHANGED — the scene invents no coordinate. W4 adds more level
 * scenes (a difficulty ladder) below the same pattern; an endless runner is typically
 * one endless level.
 */
import levelData from '../levels/level1.json';
import { DataRunnerScene } from './DataRunnerScene';
import type { RunnerLevelData } from './runner-data';

export class Level1Scene extends DataRunnerScene {
  constructor() {
    super('Level1Scene', levelData as unknown as RunnerLevelData);
  }
}
