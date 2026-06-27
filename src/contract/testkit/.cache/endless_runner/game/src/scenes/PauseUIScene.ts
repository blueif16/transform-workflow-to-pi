import Phaser from 'phaser';

/**
 * PauseUIScene (KEEP — engine; W4 may restyle)
 *
 * Overlay shown when the player pauses (ESC). Resumes the paused level on
 * ESC / Enter / click.
 *
 * CALLER CONTRACT:
 *   this.scene.launch('PauseUIScene', { currentLevelKey: <levelKey> });
 */
export class PauseUIScene extends Phaser.Scene {
  private currentLevelKey: string | null = null;

  constructor() {
    super({ key: 'PauseUIScene' });
  }

  init(data?: { currentLevelKey?: string }): void {
    this.currentLevelKey = data?.currentLevelKey ?? null;
  }

  create(): void {
    const { width, height } = this.scale;
    this.add
      .rectangle(0, 0, width, height, 0x000000, 0.5)
      .setOrigin(0)
      .setScrollFactor(0);
    this.add
      .text(width / 2, height * 0.42, 'PAUSED', {
        fontFamily: 'monospace',
        fontSize: '48px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height * 0.58, 'Press ESC to resume', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffd34a',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    this.input.keyboard?.once('keydown-ESC', () => this.resume());
    this.input.keyboard?.once('keydown-ENTER', () => this.resume());
    this.input.once('pointerdown', () => this.resume());
  }

  private resume(): void {
    if (this.currentLevelKey) this.scene.resume(this.currentLevelKey);
    this.scene.stop();
  }
}
