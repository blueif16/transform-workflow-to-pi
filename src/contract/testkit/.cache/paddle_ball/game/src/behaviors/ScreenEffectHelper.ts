/**
 * ScreenEffectHelper — cosmetic juice for paddle_ball (KEEP — engine seam).
 *
 * Static camera-shake / hit-stop / burst helpers bound to a game EVENT via the
 * blueprint's effects[] (the loader fires them through behaviors/registry's
 * EFFECT_DISPATCH). The registry catalogs the `effect` capabilities FROM the static
 * method names here (membership-gated). An effect is COSMETIC — it never reads/writes an
 * observed __GAME__ field (anti-reward-hack). Mirrors top_down's ScreenEffectHelper
 * (slim subset: the moments a paddle-ball game juices are a brick clear, a paddle hit,
 * a life lost, and the win).
 */
import Phaser from 'phaser';

export interface ShakeConfig {
  duration?: number;
  intensity?: number;
}

export class ScreenEffectHelper {
  /** Camera shake with a configurable intensity/duration (the parametric base). */
  static shake(scene: Phaser.Scene, config: ShakeConfig = {}): void {
    scene.cameras?.main?.shake(config.duration ?? 300, config.intensity ?? 0.008);
  }

  /** A light preset shake (a brick clear / a paddle tap). */
  static shakeLight(scene: Phaser.Scene): void {
    this.shake(scene, { duration: 120, intensity: 0.004 });
  }

  /** A medium preset shake (a solid hit / a multi-hit brick break). */
  static shakeMedium(scene: Phaser.Scene): void {
    this.shake(scene, { duration: 220, intensity: 0.008 });
  }

  /** A strong preset shake (a life lost / the win). */
  static shakeStrong(scene: Phaser.Scene): void {
    this.shake(scene, { duration: 400, intensity: 0.016 });
  }

  /** Briefly freeze the scene timescale on impact for hit weight (default ~60ms). */
  static hitStop(scene: Phaser.Scene, durationMs = 60): void {
    const prev = scene.time.timeScale;
    scene.time.timeScale = 0.0001;
    scene.time.delayedCall(durationMs, () => {
      scene.time.timeScale = prev || 1;
    });
  }

  /** A particle-ish burst at a point (a brick break / the ball-lost pop). */
  static createExplosion(
    scene: Phaser.Scene,
    x: number,
    y: number,
    config: { imageKey?: string; scale?: number; duration?: number } = {},
  ): void {
    const key = config.imageKey ?? '__px';
    if (!scene.textures.exists(key)) return;
    const n = 8;
    for (let i = 0; i < n; i += 1) {
      const ang = (i / n) * Math.PI * 2;
      const sprite = scene.add.sprite(x, y, key).setScale(config.scale ?? 0.4);
      scene.tweens.add({
        targets: sprite,
        x: x + Math.cos(ang) * 30,
        y: y + Math.sin(ang) * 30,
        alpha: 0,
        duration: config.duration ?? 400,
        onComplete: () => sprite.destroy(),
      });
    }
  }
}
