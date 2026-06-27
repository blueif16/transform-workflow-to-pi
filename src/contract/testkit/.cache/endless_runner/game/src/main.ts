import Phaser from 'phaser';
import gameConfig from './gameConfig.json';
import { installGameHook } from './hook';
import { mountGuidance } from '@contract/guidance/mountGuidance';
import { mountSound } from '@contract/sound/mountSound';

// Core engine scenes (KEEP — overlaid from templates/core).
import { Preloader } from './scenes/Preloader';
import { TitleScreen } from './scenes/TitleScreen';
import UIScene from './scenes/UIScene';
import { PauseUIScene } from './scenes/PauseUIScene';
import { VictoryUIScene } from './scenes/VictoryUIScene';
import { GameCompleteUIScene } from './scenes/GameCompleteUIScene';
import { GameOverUIScene } from './scenes/GameOverUIScene';

// Endless-runner level scenes. Level1Scene is the data-driven shell (extends
// DataRunnerScene, loads the committed default levels/level1.json); W2 overwrites that
// data per-game and the construction path is unchanged.
import { Level1Scene } from './scenes/Level1Scene';
// TODO-W4: import additional level scenes here (a difficulty ladder).

/**
 * main.ts — the SINGLE bootstrap point (KEEP — engine seam; W4 only adds level-scene
 * registrations below the marked line).
 *
 * Endless runner: Arcade physics with NO global gravity (the GravityFlapMovement behavior
 * OWNS the gravity integration so the flap feel is one source of truth), a fixed 9:16
 * iPhone PORTRAIT canvas (432x768) with Scale.FIT (mirrors core). The run is built
 * data-driven by DataRunnerScene from levels/<level>.json. window.__GAME__ is installed
 * here, ONCE, per the template contract — it relies on the core/ overlay for hook.ts +
 * the shared Preloader/Title/UI/end scenes.
 */

const { screenSize, debugConfig, renderConfig } = gameConfig as any;

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: screenSize.width.value,
  height: screenSize.height.value,
  backgroundColor: '#5ec0e8',
  parent: 'game-container',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      // The flap behavior owns gravity integration; world gravity stays 0.
      gravity: { x: 0, y: 0 },
      debug: debugConfig.debug.value,
    },
  },
  pixelArt: renderConfig.pixelArt.value,
};

const game = new Phaser.Game(config);

// Seed the registry so the hook reports sane defaults before the first level.
game.registry.set('score', 0);
game.registry.set('ready', false);
game.registry.set('status', 'booting');
// Publish the runner tuning so a level that binds no explicit movement params still
// gets the committed feel (the safety floor DataRunnerScene reads).
game.registry.set('__config', gameConfig);

// Install the read-only test hook (window.__GAME__) per the contract.
const hook = installGameHook(game);

// ── guidance + sound (the shared DOM seams; INERT when none are declared) ────
mountGuidance(hook, gameConfig as Record<string, unknown>);
mountSound(hook, gameConfig as Record<string, unknown>);

// ── scene registration (order: Preloader → TitleScreen → levels → UI) ────────
game.scene.add('Preloader', Preloader, true);
game.scene.add('TitleScreen', TitleScreen);

// Level scenes. LEVEL_ORDER[0] must match the first level key.
game.scene.add('Level1Scene', Level1Scene);
// TODO-W4: register additional levels here.

// UI / end-screen scenes.
game.scene.add('UIScene', UIScene);
game.scene.add('PauseUIScene', PauseUIScene);
game.scene.add('VictoryUIScene', VictoryUIScene);
game.scene.add('GameCompleteUIScene', GameCompleteUIScene);
game.scene.add('GameOverUIScene', GameOverUIScene);
