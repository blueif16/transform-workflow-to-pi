import Phaser from 'phaser';
import { LevelManager } from '../LevelManager';

/**
 * GameOverUIScene (KEEP — engine; W4 may restyle)
 *
 * Death / failure screen. Restarts the current level on Enter / Space / click.
 *
 * CALLER CONTRACT:
 *   this.scene.launch('GameOverUIScene', { currentLevelKey: this.scene.key });
 *   (gameSceneKey is also accepted.)
 *
 * The level scene sets registry 'status' = 'lost' at the death point; this
 * screen resets it to 'playing' when the player restarts.
 */
export class GameOverUIScene extends Phaser.Scene {
  private currentLevelKey: string | null = null;
  private isRestarting = false;

  constructor() {
    super({ key: 'GameOverUIScene' });
  }

  init(data?: { currentLevelKey?: string; gameSceneKey?: string }): void {
    this.currentLevelKey =
      data?.currentLevelKey ??
      data?.gameSceneKey ??
      LevelManager.getFirstLevelScene();
    this.isRestarting = false;
  }

  create(): void {
    const { width, height } = this.scale;
    this.add
      .rectangle(0, 0, width, height, 0x000000, 0.6)
      .setOrigin(0)
      .setScrollFactor(0);
    this.add
      .text(width / 2, height * 0.4, 'GAME OVER', {
        fontFamily: 'monospace',
        fontSize: '52px',
        color: '#ff5555',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height * 0.58, 'Press ENTER to retry', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    this.input.keyboard?.once('keydown-ENTER', () => this.retry());
    this.input.keyboard?.once('keydown-SPACE', () => this.retry());
    this.input.once('pointerdown', () => this.retry());
  }

  private retry(): void {
    if (this.isRestarting || !this.currentLevelKey) return;
    this.isRestarting = true;
    this.registry.set('status', 'playing');
    this.scene.stop('UIScene');
    this.scene.stop(this.currentLevelKey);
    this.scene.start(this.currentLevelKey);
    this.scene.stop();
  }
}
