import Phaser from 'phaser';
import { LevelManager } from '../LevelManager';

/**
 * VictoryUIScene (KEEP — engine; W4 may restyle)
 *
 * Shown when a level is completed and a NEXT level exists. Advances to the
 * next level on Enter / Space / click.
 *
 * CALLER CONTRACT:
 *   this.scene.launch('VictoryUIScene', { currentLevelKey: this.scene.key });
 */
export class VictoryUIScene extends Phaser.Scene {
  private currentLevelKey: string | null = null;
  private isAdvancing = false;

  constructor() {
    super({ key: 'VictoryUIScene' });
  }

  init(data?: { currentLevelKey?: string; gameSceneKey?: string }): void {
    this.currentLevelKey =
      data?.currentLevelKey ??
      data?.gameSceneKey ??
      LevelManager.getFirstLevelScene();
    this.isAdvancing = false;
  }

  create(): void {
    const { width, height } = this.scale;
    this.add
      .rectangle(0, 0, width, height, 0x000000, 0.55)
      .setOrigin(0)
      .setScrollFactor(0);
    this.add
      .text(width / 2, height * 0.4, 'LEVEL COMPLETE', {
        fontFamily: 'monospace',
        fontSize: '46px',
        color: '#ffe066',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height * 0.58, 'Press ENTER to continue', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    this.input.keyboard?.once('keydown-ENTER', () => this.advance());
    this.input.keyboard?.once('keydown-SPACE', () => this.advance());
    this.input.once('pointerdown', () => this.advance());
  }

  private advance(): void {
    if (this.isAdvancing || !this.currentLevelKey) return;
    this.isAdvancing = true;
    const next = LevelManager.getNextLevelScene(this.currentLevelKey);
    this.scene.stop('UIScene');
    this.scene.stop(this.currentLevelKey);
    if (next) {
      this.registry.set('status', 'playing');
      this.scene.start(next);
    } else {
      this.scene.start('TitleScreen');
    }
    this.scene.stop();
  }
}
