import Phaser from 'phaser';
import { LevelManager } from '../LevelManager';
import gameConfig from '../gameConfig.json';

/** One documented control: how a player makes the game do something. */
interface ControlHint {
  input: string;
  action: string;
}

/**
 * TitleScreen (KEEP — engine; W4 may restyle text, must keep the start flow)
 *
 * Minimal start screen. Press Enter / Space / click to start the first level.
 * Phaser-native (no DOM/tailwind) so it renders headless with zero art.
 *
 * Renders a generic "HOW TO PLAY" panel from gameConfig.controlsHelp — the
 * GDD's declared controls[] carried into the build by W2 (scaffold). This is
 * archetype-agnostic: it lists WHATEVER {input, action} pairs the GDD declared
 * (arrows/jump, WASD, grid moves, tower placement, UI clicks). Empty/absent →
 * renders nothing (graceful).
 *
 * Also renders the one-line GOAL from gameConfig.objective (the spec's
 * winCondition.description carried into the build by W2 — WHAT-TO-DO, the
 * twin of controlsHelp's HOW-TO-PLAY). Empty/absent → renders nothing.
 */
export class TitleScreen extends Phaser.Scene {
  private isStarting = false;

  constructor() {
    super({ key: 'TitleScreen' });
  }

  init(): void {
    this.isStarting = false;
  }

  create(): void {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, height * 0.2, this.game.registry.get('title') ?? 'GAME', {
        fontFamily: 'monospace',
        fontSize: '48px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    this.renderObjective(width, height);
    this.renderControlsHelp(width, height);

    this.add
      .text(width / 2, height * 0.85, 'Press ENTER / SPACE to start', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffd34a',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    this.input.keyboard?.once('keydown-ENTER', () => this.startGame());
    this.input.keyboard?.once('keydown-SPACE', () => this.startGame());
    this.input.once('pointerdown', () => this.startGame());
  }

  /**
   * Render the one-line GOAL from gameConfig.objective, above the
   * "HOW TO PLAY" panel. Verbatim spec text (winCondition.description) —
   * never authored here. Does nothing if objective is empty or absent.
   */
  private renderObjective(width: number, height: number): void {
    const raw = (gameConfig as Record<string, unknown>).objective;
    const objective = typeof raw === 'string' ? raw : '';
    if (objective.length === 0) return;

    this.add
      .text(width / 2, height * 0.34, `GOAL — ${objective}`, {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffd34a',
        stroke: '#000000',
        strokeThickness: 3,
        align: 'center',
        wordWrap: { width: width * 0.85 },
      })
      .setOrigin(0.5);
  }

  /**
   * Render the "HOW TO PLAY" panel from gameConfig.controlsHelp.
   * Generic over archetype — it prints the declared {input → action} pairs.
   * Does nothing if controlsHelp is empty or absent (no crash).
   */
  private renderControlsHelp(width: number, height: number): void {
    const raw = (gameConfig as Record<string, unknown>).controlsHelp;
    const hints: ControlHint[] = Array.isArray(raw)
      ? (raw as unknown[]).filter(
          (h): h is ControlHint =>
            !!h &&
            typeof (h as ControlHint).input === 'string' &&
            typeof (h as ControlHint).action === 'string',
        )
      : [];
    if (hints.length === 0) return;

    const centerY = height * 0.52;
    const lineHeight = 26;
    const panelTop = centerY - (hints.length * lineHeight) / 2 - 36;

    this.add
      .text(width / 2, panelTop, 'HOW TO PLAY', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#9ad0ff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0);

    hints.forEach((hint, i) => {
      this.add
        .text(
          width / 2,
          panelTop + 36 + i * lineHeight,
          `${hint.input}  —  ${hint.action}`,
          {
            fontFamily: 'monospace',
            fontSize: '18px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3,
          },
        )
        .setOrigin(0.5, 0);
    });
  }

  private startGame(): void {
    if (this.isStarting) return;
    this.isStarting = true;
    const first = LevelManager.getFirstLevelScene() ?? 'Level1Scene';
    this.scene.start(first);
  }
}
