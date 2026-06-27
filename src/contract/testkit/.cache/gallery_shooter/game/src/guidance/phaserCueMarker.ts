/**
 * ============================================================================
 * guidance/phaserCueMarker.ts — the Phaser (2D) world-cue MARKER factory (KEEP — engine)
 * ============================================================================
 * The ONLY engine-specific piece of the in-world guidance layer. The shared,
 * renderer-agnostic `WorldCueDriver` (@contract/guidance/WorldCueDriver) owns the
 * trigger + follow loop and INJECTS a `MarkerFactory`; this file is the 2D Phaser
 * implementation of that factory — a bobbing downward chevron (+ an optional label)
 * wrapped as a generic `CueMarker` the driver positions/shows/destroys.
 *
 * A 3D scene that needs world cues would ship a Three marker factory the same way;
 * the driver itself imports no engine. Generic — no game/theme is encoded here.
 */

import Phaser from 'phaser';
import type {
  CueMarker,
  MarkerFactory,
} from '@contract/guidance/WorldCueDriver';

/**
 * Build a `MarkerFactory` bound to `scene`. Each cue becomes a bobbing chevron
 * container the WorldCueDriver pins to its target entity each frame. Falls back to
 * screen center when the driver reveals before the target resolves.
 */
export function makePhaserMarkerFactory(scene: Phaser.Scene): MarkerFactory {
  return (entry): CueMarker => {
    const container = scene.add.container(
      scene.scale.width / 2,
      scene.scale.height / 2,
    );
    container.setDepth(900);

    // A bobbing downward chevron (a "look here" pointer above the entity).
    const chevron = scene.add
      .triangle(0, -44, 0, 0, 18, 0, 9, 16, 0xffe27a)
      .setStrokeStyle(2, 0x6b4e00);
    container.add(chevron);

    if (entry.content?.body) {
      const label = scene.add
        .text(0, -66, entry.content.body, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '12px',
          color: '#ffffff',
          backgroundColor: 'rgba(0,0,0,0.55)',
          padding: { x: 6, y: 3 },
        })
        .setOrigin(0.5);
      container.add(label);
    }

    // A gentle bob so the cue reads as "look here" without being intrusive.
    scene.tweens.add({
      targets: chevron,
      y: -36,
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    return {
      setPosition: (x: number, y: number) => container.setPosition(x, y),
      setVisible: (v: boolean) => container.setVisible(v),
      destroy: () => container.destroy(),
    };
  };
}
