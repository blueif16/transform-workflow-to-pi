import Phaser from 'phaser';
import gameConfig from '../gameConfig.json';
import { type HudItem, deriveDefaultHud } from '@contract/hud-spec';

/**
 * UIScene (KEEP — engine HUD overlay; the COMPOSER; W4 may add HUD elements)
 *
 * Runs in parallel with the active level scene. Phaser-native (no DOM) HUD that
 * owns ONLY placement/layout — it never decides WHAT to track (the blueprint
 * does). It renders a data-driven `gameConfig.shell.hud` spec into NON-OVERLAPPING,
 * boxed regions on the fixed portrait canvas:
 *
 *   ┌ STAT BAND ─ a row of self-sizing, boxed stat chips (score / time / lives /
 *   │   health-bar / any future stat), flow-laid left→right and WRAPPING to a new
 *   │   row when the next chip would overflow the canvas width — so an ARBITRARY
 *   │   set of stats never collides.
 *   └ OBJECTIVE PANEL ─ one full-width panel placed strictly BELOW the measured
 *       stat band (sequential bands, never overlaid), text left-anchored inside,
 *       wrapped + truncated so a sentence-length goal can't run over the chips.
 *
 * Each hud entry = { observable, label?, container?, format?, priority? }:
 *   - observable: a __GAME__ observable the hook ALREADY exposes ('score',
 *     'timeRemaining', 'lives', 'player.health'), OR the sentinel 'objective'
 *     (renders gameConfig.objective). The reads stay on the existing observables
 *     (registry 'score'/'lives', scene timeRemaining, player.health) — no oracle
 *     change.
 *   - container: a suggested component TYPE ('chip'|'pill'|'counter'|'timer'|
 *     'bar'|'objective'). Advisory — the composer maps it to a renderer and
 *     falls back to a sensible default per observable when absent.
 *   - format: 'x/max'|'mm:ss'|'pct'|'int' — a generic formatter (no game strings).
 *   - priority: lower sorts earlier (left) within the stat band.
 *
 * When `gameConfig.shell.hud` is ABSENT, deriveDefaultHud() reproduces the PRIOR
 * rendering exactly (a score chip + the failModel resource widget + the objective
 * panel) so every pre-existing blueprint — including the gold — still renders.
 *
 * ESC to pause. Launched by the base level scene:
 *   `this.scene.launch('UIScene', { gameSceneKey })`.
 */

/** A live stat chip the update() loop refreshes (handle + how to read/format it). */
interface StatChip {
  item: HudItem;
  bg: Phaser.GameObjects.Graphics;
  text: Phaser.GameObjects.Text;
  // For the wide health BAR container only (else undefined):
  barFill?: Phaser.GameObjects.Graphics;
  box: { x: number; y: number; w: number; h: number };
}

// ── layout tokens (px on the FIXED design canvas; small + portrait-safe) ──
const EDGE = 8; // outer margin
const GAP = 6; // gap between chips / bands
const PADX = 8; // chip inner horizontal padding
const PADY = 5; // chip inner vertical padding
const CHIP_H = 26; // stat chip height
const STAT_FONT = '15px';
const OBJ_FONT = '13px';
const BAR_W = 120; // width of the health-bar fill region (the 'bar' container)
const DEPTH = 1000;

export default class UIScene extends Phaser.Scene {
  private gameSceneKey: string | null = null;
  private statChips: StatChip[] = [];

  constructor() {
    super({ key: 'UIScene' });
  }

  init(data: { gameSceneKey?: string }): void {
    this.gameSceneKey = data.gameSceneKey ?? null;
  }

  create(): void {
    this.statChips = [];

    const cfg = gameConfig as Record<string, unknown>;
    const hud = this.resolveHudSpec(cfg);

    // Split the spec into the stat band (compact widgets) and the objective panel.
    const statItems = hud
      .filter((h) => !this.isObjective(h))
      .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));
    const objectiveItem = hud.find((h) => this.isObjective(h));

    const statBandBottom = this.layoutStatBand(statItems);
    this.layoutObjectivePanel(objectiveItem, statBandBottom);

    this.input.keyboard?.on('keydown-ESC', () => this.pauseGame());
  }

  /**
   * The hud spec: gameConfig.shell.hud if present + valid, else the derived default
   * (which reproduces the prior score+resource+objective rendering exactly).
   */
  private resolveHudSpec(cfg: Record<string, unknown>): HudItem[] {
    const shell = cfg.shell as Record<string, unknown> | undefined;
    const raw = shell ? shell.hud : undefined;
    const items: HudItem[] = Array.isArray(raw)
      ? (raw as unknown[]).filter(
          (h): h is HudItem =>
            !!h && typeof (h as HudItem).observable === 'string',
        )
      : [];
    return items.length > 0 ? items : deriveDefaultHud(cfg);
  }

  private isObjective(h: HudItem): boolean {
    return h.container === 'objective' || h.observable === 'objective';
  }

  // ── STAT BAND ──────────────────────────────────────────────────────────────

  /**
   * Flow-lay each stat item as its own boxed chip left→right from the top-left,
   * wrapping to a new row when the next chip would overflow the canvas width.
   * Returns the y of the band's BOTTOM edge (so the objective panel sits below).
   */
  private layoutStatBand(items: HudItem[]): number {
    const maxRight = this.scale.width - EDGE;
    let cx = EDGE;
    let cy = EDGE;
    let rowBottom = EDGE;

    for (const item of items) {
      const isBar = item.container === 'bar';
      // Width: a bar widget reserves a fixed fill region; a text chip measures
      // its widest plausible content so it never reflows as the value changes.
      const probe = this.add
        .text(0, 0, this.sampleText(item), {
          fontFamily: 'monospace',
          fontSize: STAT_FONT,
        })
        .setVisible(false);
      const textW = Math.ceil(probe.width);
      probe.destroy();

      const innerW = isBar ? textW + GAP + BAR_W : textW;
      const chipW = innerW + PADX * 2;

      // Wrap to the next row if this chip would overflow the right margin.
      if (cx + chipW > maxRight && cx > EDGE) {
        cx = EDGE;
        cy = rowBottom + GAP;
      }

      const box = { x: cx, y: cy, w: chipW, h: CHIP_H };

      const bg = this.add.graphics().setScrollFactor(0).setDepth(DEPTH);
      this.drawBox(bg, box, 0x000000, 0.55, 0xffffff, 0.25);

      const text = this.add
        .text(cx + PADX, cy + PADY, '', {
          fontFamily: 'monospace',
          fontSize: STAT_FONT,
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 3,
        })
        .setScrollFactor(0)
        .setDepth(DEPTH + 1);

      let barFill: Phaser.GameObjects.Graphics | undefined;
      if (isBar) {
        barFill = this.add.graphics().setScrollFactor(0).setDepth(DEPTH + 1);
      }

      this.statChips.push({ item, bg, text, barFill, box });

      cx += chipW + GAP;
      rowBottom = Math.max(rowBottom, cy + CHIP_H);
    }

    // Paint initial values so the band shows before the first update tick.
    this.refreshStats();
    return rowBottom;
  }

  /** A widest-plausible sample for sizing a chip's box without later reflow. */
  private sampleText(item: HudItem): string {
    const label = item.label ? `${item.label} ` : '';
    switch (item.format) {
      case 'mm:ss':
        return `${label}88:88`;
      case 'x/max':
        return `${label}888/888`;
      case 'pct':
        return `${label}100%`;
      default:
        return `${label}8888`;
    }
  }

  // ── OBJECTIVE PANEL ──────────────────────────────────────────────────────────

  /**
   * One full-width panel placed strictly BELOW the stat band. The objective text
   * is left-anchored inside, word-wrapped to the panel width and truncated to a
   * couple of lines so a sentence-length goal can never overprint the chips.
   */
  private layoutObjectivePanel(item: HudItem | undefined, statBandBottom: number): void {
    if (!item) return;
    const cfg = gameConfig as Record<string, unknown>;
    const objective = typeof cfg.objective === 'string' ? cfg.objective : '';
    if (objective.length === 0) return;

    const panelX = EDGE;
    const panelY = statBandBottom + GAP;
    const panelW = this.scale.width - EDGE * 2;
    const innerW = panelW - PADX * 2;

    // Measure wrapped height (cap at ~2 lines, then truncate with an ellipsis).
    const measure = this.add
      .text(0, 0, `GOAL — ${objective}`, {
        fontFamily: 'monospace',
        fontSize: OBJ_FONT,
        wordWrap: { width: innerW, useAdvancedWrap: true },
      })
      .setVisible(false);
    const lineH = measure.height / Math.max(1, this.lineCount(measure));
    const maxLines = 2;
    let shown = `GOAL — ${objective}`;
    if (this.lineCount(measure) > maxLines) {
      shown = this.truncateToLines(objective, innerW, maxLines);
    }
    measure.destroy();

    const panelH = lineH * Math.min(maxLines, Math.max(1, 1)) + PADY * 2 + lineH; // header line + body allowance
    const box = { x: panelX, y: panelY, w: panelW, h: Math.ceil(panelH) };

    const bg = this.add.graphics().setScrollFactor(0).setDepth(DEPTH);
    this.drawBox(bg, box, 0x000000, 0.5, 0xffd34a, 0.7);

    this.add
      .text(panelX + PADX, panelY + PADY, shown, {
        fontFamily: 'monospace',
        fontSize: OBJ_FONT,
        color: '#ffd34a',
        stroke: '#000000',
        strokeThickness: 3,
        wordWrap: { width: innerW, useAdvancedWrap: true },
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1);
  }

  private lineCount(t: Phaser.GameObjects.Text): number {
    const wrapped = (t as any).getWrappedText
      ? (t as any).getWrappedText(t.text)
      : [t.text];
    return Array.isArray(wrapped) ? Math.max(1, wrapped.length) : 1;
  }

  /** Truncate the objective to fit `maxLines` at width `innerW`, with an ellipsis. */
  private truncateToLines(objective: string, innerW: number, maxLines: number): string {
    const words = objective.split(/\s+/);
    let acc = '';
    const probe = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: OBJ_FONT,
        wordWrap: { width: innerW, useAdvancedWrap: true },
      })
      .setVisible(false);
    for (let i = 0; i < words.length; i++) {
      const next = acc ? `${acc} ${words[i]}` : words[i];
      probe.setText(`GOAL — ${next}…`);
      if (this.lineCount(probe) > maxLines) break;
      acc = next;
    }
    probe.destroy();
    return acc ? `GOAL — ${acc}…` : `GOAL — ${objective}`;
  }

  // ── shared draw + per-frame refresh ──────────────────────────────────────────

  private drawBox(
    g: Phaser.GameObjects.Graphics,
    box: { x: number; y: number; w: number; h: number },
    fill: number,
    fillA: number,
    stroke: number,
    strokeA: number,
  ): void {
    const r = 6;
    g.fillStyle(fill, fillA);
    g.fillRoundedRect(box.x, box.y, box.w, box.h, r);
    g.lineStyle(1, stroke, strokeA);
    g.strokeRoundedRect(box.x, box.y, box.w, box.h, r);
  }

  private pauseGame(): void {
    if (!this.gameSceneKey) return;
    if (!this.scene.isActive(this.gameSceneKey)) return;
    this.scene.pause(this.gameSceneKey);
    this.scene.launch('PauseUIScene', { currentLevelKey: this.gameSceneKey });
  }

  update(): void {
    this.refreshStats();
  }

  /** Refresh each stat chip from its declared observable (existing reads only). */
  private refreshStats(): void {
    const gameScene = this.gameSceneKey
      ? (this.scene.get(this.gameSceneKey) as any)
      : null;
    const player = gameScene?.player;

    for (const chip of this.statChips) {
      const { item } = chip;
      const value = this.readObservable(item.observable, gameScene, player);

      if (item.container === 'bar') {
        this.refreshBar(chip, player);
        continue;
      }

      const label = item.label ? `${item.label}: ` : '';
      chip.text.setText(`${label}${this.formatValue(item, value)}`);

      // Low-time warning for a timer (generic: any 'mm:ss' under 10s).
      if (item.format === 'mm:ss' && typeof value === 'number') {
        chip.text.setColor(value <= 10 ? '#f44336' : '#ffffff');
      }
    }
  }

  /** Read a __GAME__-vocabulary observable from the live registry/scene/player. */
  private readObservable(
    observable: string,
    gameScene: any,
    player: any,
  ): number | string | undefined {
    switch (observable) {
      case 'score':
        return this.registry.get('score') ?? 0;
      case 'lives':
        return this.registry.get('lives');
      case 'timeRemaining':
        return gameScene?.timeRemaining;
      case 'player.health':
        return player?.health;
      default: {
        // Generic registry / scene fallthrough for any future scalar stat.
        if (observable.startsWith('player.') && player) {
          return player[observable.slice('player.'.length)];
        }
        const reg = this.registry.get(observable);
        if (reg !== undefined) return reg;
        return gameScene ? gameScene[observable] : undefined;
      }
    }
  }

  private formatValue(item: HudItem, value: number | string | undefined): string {
    if (typeof value !== 'number') return typeof value === 'string' ? value : '—';
    switch (item.format) {
      case 'mm:ss': {
        const secs = Math.max(0, Math.ceil(value));
        const mm = Math.floor(secs / 60);
        const ss = secs % 60;
        return `${mm}:${ss.toString().padStart(2, '0')}`;
      }
      case 'pct':
        return `${Math.round(value * 100)}%`;
      case 'x/max': {
        // The denominator is the ENGINE-DERIVED ceiling (Σ of placed reward
        // values) read off __GAME__.maxScore — NOT a frozen authored constant.
        // Falls back to a bare value if no ceiling has accumulated yet.
        const hook = (window as any).__GAME__;
        const max = typeof hook?.maxScore === 'number' ? hook.maxScore : 0;
        return max > 0 ? `${Math.round(value)}/${Math.round(max)}` : `${Math.round(value)}`;
      }
      case 'int':
      default:
        return `${Math.round(value)}`;
    }
  }

  /** The wide health-bar container (only used for failModel:'health'). */
  private refreshBar(chip: StatChip, player: any): void {
    const { bg, text, barFill, box } = chip;
    if (!barFill) return;

    // Repaint the chip box (cleared each frame for the live fill).
    bg.clear();
    this.drawBox(bg, box, 0x000000, 0.55, 0xffffff, 0.25);
    barFill.clear();

    if (!player || typeof player.health !== 'number') {
      text.setText('');
      return;
    }
    const max = player.maxHealth || player.health || 1;
    const pct = Phaser.Math.Clamp(player.health / max, 0, 1);

    const label = chip.item.label ? `${chip.item.label}` : 'HP';
    text.setText(label);
    const labelRight = box.x + PADX + Math.ceil(text.width);

    const barX = labelRight + GAP;
    const barY = box.y + (box.h - 14) / 2;
    const barW = box.x + box.w - PADX - barX;
    barFill.fillStyle(0x000000, 0.5);
    barFill.fillRect(barX, barY, barW, 14);
    const color = pct > 0.5 ? 0x4caf50 : pct > 0.25 ? 0xffc107 : 0xf44336;
    barFill.fillStyle(color, 1);
    barFill.fillRect(barX, barY, Math.max(0, barW * pct), 14);
  }
}
