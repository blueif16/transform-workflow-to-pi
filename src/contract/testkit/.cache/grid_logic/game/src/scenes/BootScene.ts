import Phaser from 'phaser';

/**
 * BootScene (KEEP — core standalone default level)
 *
 * A minimal, art-free level so the CORE template boots to `ready` on its own
 * (used when no archetype module is overlaid — e.g. core's own build-health
 * check). An archetype module ships its own first level (Level1Scene) and its
 * own main.ts that registers it instead; this scene is the core fallback.
 *
 * It latches `registry.ready = true` and `registry.status = 'playing'` on its
 * first interactive frame so `window.__GAME__.ready` flips true.
 */
export class BootScene extends Phaser.Scene {
  private firstFrame = true;

  constructor() {
    super({ key: 'Level1Scene' });
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#1a1a2e');
    this.add
      .text(width / 2, height / 2, 'empty template — ready', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#888888',
      })
      .setOrigin(0.5);
    this.scene.launch('UIScene', { gameSceneKey: this.scene.key });
  }

  update(): void {
    if (this.firstFrame) {
      this.firstFrame = false;
      this.registry.set('ready', true);
      this.registry.set('status', 'playing');
    }
  }
}
