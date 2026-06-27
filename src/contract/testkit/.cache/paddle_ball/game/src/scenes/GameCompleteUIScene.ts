import Phaser from 'phaser';

/**
 * GameCompleteUIScene (KEEP — engine; W4 may restyle)
 *
 * Shown when the FINAL level is completed (the player beat the game).
 * Returns to the TitleScreen on Enter / Space / click.
 *
 * CALLER CONTRACT:
 *   this.scene.launch('GameCompleteUIScene', { currentLevelKey: this.scene.key });
 */
export class GameCompleteUIScene extends Phaser.Scene {
  private currentLevelKey: string | null = null;
  private isDone = false;

  constructor() {
    super({ key: 'GameCompleteUIScene' });
  }

  init(data?: { currentLevelKey?: string; gameSceneKey?: string }): void {
    this.currentLevelKey = data?.currentLevelKey ?? data?.gameSceneKey ?? null;
    this.isDone = false;
  }

  create(): void {
    const { width, height } = this.scale;
    const score = this.registry.get('score') ?? 0;
    this.add
      .rectangle(0, 0, width, height, 0x000000, 0.6)
      .setOrigin(0)
      .setScrollFactor(0);
    this.add
      .text(width / 2, height * 0.36, 'YOU WIN!', {
        fontFamily: 'monospace',
        fontSize: '56px',
        color: '#7CFC00',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height * 0.52, `Final score: ${score}`, {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height * 0.66, 'Press ENTER for title', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffd34a',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    this.input.keyboard?.once('keydown-ENTER', () => this.toTitle());
    this.input.keyboard?.once('keydown-SPACE', () => this.toTitle());
    this.input.once('pointerdown', () => this.toTitle());
  }

  private toTitle(): void {
    if (this.isDone) return;
    this.isDone = true;
    this.scene.stop('UIScene');
    if (this.currentLevelKey) this.scene.stop(this.currentLevelKey);
    this.scene.start('TitleScreen');
    this.scene.stop();
  }
}
