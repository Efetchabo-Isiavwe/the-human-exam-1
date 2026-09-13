const puppeteer = require('puppeteer-core');
const fs = require('fs');

const GAME_URL = "http://localhost:8080";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let errors = [];
function pushError(msg) {
  if (errors.length < 50 && msg) {
    const s = String(msg).trim();
    if (s && !errors.includes(s)) errors.push(s);
  }
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium",
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,720', '--autoplay-policy=no-user-gesture-required'],
    headless: 'new',
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  page.on('pageerror', (err) => pushError(err.message || err));
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error' || /texture|loader|Phaser|WebGL|decodeAudioData|unhandledrejection|unknown content type|failed to load|404|TypeError|ReferenceError|Cannot read|undefined|QA_VIOLATION|UI_WARNING/i.test(text)) {
      pushError(text);
    }
  });
  // Network failures / 4xx responses (assets, chunks, favicons) — evidence
  page.on('requestfailed', (req) => {
    try {
      const errText = (req.failure() && req.failure().errorText) || 'failed';
      pushError('[ASSET_FAIL] ' + req.url() + ' :: ' + errText);
    } catch (e) { /* best effort */ }
  });
  page.on('response', (res) => {
    try {
      if (res.status() >= 400) {
        pushError('[ASSET_404] ' + res.url() + ' status=' + res.status());
      }
    } catch (e) { /* best effort */ }
  });

  // Catch all uncaught exceptions in page context
  await page.evaluateOnNewDocument(() => {
    window.addEventListener('error', (e) => {
      console.error('UncaughtPageError: ' + (e.message || (e.error && e.error.message) || e));
    });
    window.addEventListener('unhandledrejection', (e) => {
      console.error('UnhandledRejection: ' + (e.reason && (e.reason.message || e.reason)));
    });
  });

  const shot = async (moment) => {
    try {
      const buf = await page.screenshot({ type: 'png' });
      fs.writeFileSync('/home/user/shot-' + moment + '.png', buf);
    } catch (e) {
      pushError('screenshot ' + moment + ': ' + (e && e.message || e));
    }
  };

  // Best-effort Game-ready poll: active Phaser scene or Three.js canvas/engine exists.
  const waitGameActive = () =>
    page
      .waitForFunction(
        () => {
          const g = window.__PHASER_GAME__;
          if (g && g.scene && g.scene.scenes && g.scene.scenes.some((s) => s.sys && s.sys.settings.active)) return true;
          const tg = window.__GAME__ || window.game;
          if (tg && (tg.renderer || tg.scene || tg.engine)) return true;
          const canvas = document.querySelector('canvas');
          return !!canvas;
        },
        { timeout: 8000 }
      )
      .catch(() => {});

  await page.goto(GAME_URL, { waitUntil: 'networkidle0', timeout: 20000 })
    .catch((e) => { pushError('goto: ' + (e && e.message || e)); });
  await waitGameActive();
  await sleep(400);
  await shot('boot');

  // Menu / Title inspection
  await sleep(400);
  await shot('menu');

  // Trigger game start via DOM button, Canvas click, EventBus, or Keyboard
  try {
    await page.evaluate(() => {
      // 1. Try DOM button in React overlay (#hud) or body
      const re = /start|play|begin|go|continue/i;
      const els = document.querySelectorAll('#hud button, button, a, input[type="submit"], [role="button"]');
      for (const el of els) {
        const text = ((el.innerText || el.value || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
        if (text && re.test(text)) {
          el.click();
          return true;
        }
      }

      // 2. Try EventBus if exposed on window
      if (window.__PHASER_EVENT_BUS__) {
        window.__PHASER_EVENT_BUS__.emit('start-game');
        window.__PHASER_EVENT_BUS__.emit('start');
      }
      if (window.__GAME_BUS__) {
        window.__GAME_BUS__.emit('start-game');
        window.__GAME_BUS__.emit('start');
      }

      // 3. Try clicking canvas center
      const canvas = document.querySelector('canvas');
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const evt = new MouseEvent('pointerdown', {
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
        });
        canvas.dispatchEvent(evt);
        canvas.dispatchEvent(new MouseEvent('click', {
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
        }));
      }
      return false;
    });
  } catch (e) { /* best effort */ }

  // Also press Space and Enter via page keyboard
  try {
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
  } catch (e) { /* best effort */ }

  // Wait for transition / countdown into active gameplay (best-effort
  // game-ready poll; short settle sleep keeps the animation frames).
  await waitGameActive();
  await sleep(400);

  // Countdown handling: wait for countdown to transition into active PLAYING
  try {
    const hasCountdown = await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      const s = g && g.scene && g.scene.scenes && g.scene.scenes.find((x) => x.sys && x.sys.settings.active);
      const phase = s && (s.phase || s.currentPhase || s.state);
      const isVisible = (el) => !!(el && (el.offsetWidth > 0 || el.offsetHeight > 0) && window.getComputedStyle(el).display !== 'none');
      const cdEl = document.querySelector('.countdown, #countdown, [data-phase="countdown"]');
      return !!(phase === 'COUNTDOWN' || phase === 'countdown' || isVisible(cdEl));
    });

    if (hasCountdown) {
      const finished = await page.waitForFunction(() => {
        const g = window.__PHASER_GAME__;
        const s = g && g.scene && g.scene.scenes && g.scene.scenes.find((x) => x.sys && x.sys.settings.active);
        const phase = s && (s.phase || s.currentPhase || s.state);
        const isVisible = (el) => !!(el && (el.offsetWidth > 0 || el.offsetHeight > 0) && window.getComputedStyle(el).display !== 'none');
        const cdEl = document.querySelector('.countdown, #countdown, [data-phase="countdown"]');
        return !isVisible(cdEl) && (!phase || String(phase).toUpperCase() !== 'COUNTDOWN');
      }, { timeout: 4500 }).catch(() => null);

      if (!finished) {
        pushError('[QA_VIOLATION] Countdown Stalled: Game remained in COUNTDOWN phase after 4.5 seconds.');
      }
    }
  } catch (e) { /* best effort */ }

  // Check for duplicate / overlapping timers in Phaser scene
  try {
    await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      const s = g && g.scene && g.scene.scenes && g.scene.scenes.find((x) => x.sys && x.sys.settings.active);
      if (s && s.time && s.time._active) {
        const timerEvents = s.time._active;
        const countdownTimers = timerEvents.filter((t) => {
          if (!t || t.repeat <= 0 || t.delay < 500 || t.delay > 1200) return false;
          const fnStr = String((t.callback && t.callback.toString()) || t.callbackScope || '');
          return /countdown|tick|startRun|onCmd/i.test(fnStr);
        });
        if (countdownTimers.length > 1) {
          console.error('[QA_VIOLATION] Overlapping Timers: Multiple countdown timer events running simultaneously.');
        }
      }
    });
  } catch (e) { /* best effort */ }

  // Dead-HUD detection: snapshot #hud text before gameplay input.
  let hudBefore = null;
  try {
    hudBefore = await page.evaluate(() => {
      const hud = document.querySelector('#hud');
      return hud ? String(hud.innerText || '').trim() : null;
    });
  } catch (e) { /* best effort */ }

  // Emulate active gameplay input: movement + combat + jump + dash + on-screen actions
  try {
    for (let loop = 0; loop < 2; loop++) {
      // Move right + attack + jump
      await page.keyboard.down('ArrowRight');
      await page.keyboard.down('KeyD');
      await sleep(150);
      await page.keyboard.press('Space'); // Jump
      await page.keyboard.press('KeyW');
      await sleep(100);
      await page.keyboard.press('KeyJ'); // Light Attack / Shoot
      await page.keyboard.press('KeyZ');
      await sleep(100);
      await page.keyboard.press('KeyK'); // Heavy Attack / Dash
      await page.keyboard.press('KeyX');
      await sleep(100);
      await page.keyboard.press('KeyL'); // Shield Block / Special
      await page.keyboard.press('KeyC');
      await sleep(100);
      await page.keyboard.up('ArrowRight');
      await page.keyboard.up('KeyD');

      // Click all on-screen action / touch buttons
      await page.evaluate(() => {
        const actionBtns = document.querySelectorAll(
          '#hud button, button, .action-btn, .touch-btn, [data-action], #btn-attack, #btn-dash, #btn-jump, #btn-block'
        );
        for (const btn of actionBtns) {
          const t = ((btn.innerText || '') + ' ' + (btn.getAttribute('aria-label') || '')).toLowerCase();
          if (!/restart|menu|quit|exit|home/i.test(t)) {
            btn.click();
          }
        }
      });

      // Move left + attack
      await page.keyboard.down('ArrowLeft');
      await page.keyboard.down('KeyA');
      await sleep(150);
      await page.keyboard.press('KeyJ');
      await page.keyboard.press('Space');
      await sleep(100);
      await page.keyboard.up('ArrowLeft');
      await page.keyboard.up('KeyA');
      await sleep(150);
    }
  } catch (e) { /* best effort */ }

  // Dead-HUD detection: compare after gameplay input; present + unchanged
  // means the HUD never updated (dead score/health overlay).
  try {
    const hudAfter = await page.evaluate(() => {
      const hud = document.querySelector('#hud');
      return hud ? String(hud.innerText || '').trim() : null;
    });
    if (hudBefore !== null && hudAfter !== null && hudBefore === hudAfter) {
      pushError('[HUD_STATIC] #hud text unchanged during gameplay');
    }
  } catch (e) { /* best effort */ }

  await sleep(400);
  await shot('gameplay');

  // Runtime telemetry: frozen loop + fps (deterministic, measured).
  try {
    const frameBefore = await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      return g && g.loop ? g.loop.frame : -1;
    });
    await sleep(500);
    const frameAfter = await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      return g && g.loop ? g.loop.frame : -1;
    });
    if (frameBefore >= 0 && frameAfter >= 0 && frameAfter === frameBefore) {
      pushError('[FROZEN_LOOP] game loop frame did not advance over 500ms');
    }
    const fps = await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      return g && g.loop ? g.loop.actualFps : null;
    });
    if (typeof fps === 'number' && fps < 5) {
      pushError('[PERF_WARNING] low fps: ' + fps);
    }
  } catch (e) { /* best effort */ }

  // Kinematic & Platform Reachability inspection
  try {
    await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      if (g && g.scene) {
        const scenes = g.scene.scenes || [];
        const activeScene = scenes.find((s) => s.sys && s.sys.settings.active) || scenes[0];
        if (activeScene) {
          const player = activeScene.player || activeScene.knight || (activeScene.children && activeScene.children.list && activeScene.children.list.find((c) => c.body && !c.body.immovable));
          const platforms = activeScene.platforms || activeScene.ground;
          const gravity = (activeScene.physics && activeScene.physics.world && activeScene.physics.world.gravity && activeScene.physics.world.gravity.y) || 800;
          if (player && player.body) {
            const jumpV = Math.abs(player.jumpVelocity !== undefined ? player.jumpVelocity : -350);
            const maxJumpH = (jumpV * jumpV) / (2 * (gravity || 1));
            if (platforms && typeof platforms.getChildren === 'function') {
              const children = platforms.getChildren();
              if (children && children.length > 1) {
                const groundY = Math.max(...children.map((c) => c.y));
                for (const plat of children) {
                  const deltaY = groundY - plat.y;
                  if (deltaY > 20 && deltaY > maxJumpH * 1.25) {
                    console.error(`[PLATFORM_REACHABILITY_WARNING] Platform at y=${Math.round(plat.y)} is ${Math.round(deltaY)}px above ground, exceeding max single jump height ${Math.round(maxJumpH)}px.`);
                  }
                }
              }
            }
          }
        }
      }
    });
  } catch (e) { /* best effort */ }

  // Automated Asset, Objective, Goal, Kill-Plane & Hazard Inspections
  try {
    await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      if (!g || !g.scene) return;
      const scenes = g.scene.scenes || [];
      const activeScene = scenes.find((s) => s.sys && s.sys.settings.active) || scenes[0];
      if (!activeScene) return;

      const children = (activeScene.children && activeScene.children.list) || [];
      const player = activeScene.player || activeScene.knight || children.find((c) => c.body && !c.body.immovable);

      // 1. Asset Identity Check: Flag primitive rectangle/graphics or 1x1 dummy player
      try {
        if (player) {
          const isPrimitive = player.type === 'Graphics' || player.type === 'Rectangle';
          if (isPrimitive) {
            console.error('[QA_VIOLATION] Player is a primitive Graphics/Rectangle box instead of a real Sprite.');
          }
          if (player.frame && (player.frame.width <= 1 || player.frame.height <= 1)) {
            console.error(`[QA_VIOLATION] Invisible Player: Player "${(player.texture && player.texture.key) || ''}" has 1x1 dummy placeholder texture.`);
          }
        }
      } catch (e) {}

      // 2. Objective Counter Consistency: HUD target vs scene collectibles
      try {
        const hudEl = document.querySelector('#hud');
        const hudText = hudEl ? (hudEl.innerText || '') : '';
        // ponytail: fallback only runs on HUD lines that exclude non-collectible
        // counters (HP 3/3, Wave 2/3, Level 1/3) — primary keyword regex is fine.
        const fallbackText = hudText
          .split('\n')
          .filter((line) => !/hp|health|live|wave|level|ammo|time/i.test(line))
          .join('\n');
        const targetMatch = hudText.match(/(?:fruit|coin|star|gem|item|target|score)s?\s*[:=]?\s*(\d+)\s*\/\s*(\d+)/i)
          || fallbackText.match(/(\d+)\s*\/\s*(\d+)/);
        if (targetMatch) {
          const requiredCount = parseInt(targetMatch[2], 10);
          if (requiredCount > 0) {
            let actualCount = 0;
            const groups = [
              activeScene.fruits, activeScene.coins, activeScene.collectibles,
              activeScene.items, activeScene.stars, activeScene.gems
            ];
            for (const grp of groups) {
              if (grp && typeof grp.countActive === 'function') {
                actualCount += grp.countActive(true);
              }
            }
            if (actualCount === 0) {
              actualCount = children.filter((c) => {
                const k = (c.texture && c.texture.key) || c.name || '';
                return /fruit|apple|coin|star|gem|collectible|pickup/i.test(k) && c.active !== false;
              }).length;
            }
            if (actualCount === 0 || actualCount < requiredCount) {
              console.error(`[QA_VIOLATION] Ghost Objectives: HUD demands ${requiredCount} collectibles ("${targetMatch[0]}"), but only ${actualCount} exist in scene!`);
            }

            // Check for gravity leaks on collectibles (falling fruits bug)
            for (const grp of groups) {
              if (grp && typeof grp.getChildren === 'function') {
                for (const item of grp.getChildren()) {
                  if (item && item.body && item.body.allowGravity && !item.body.immovable) {
                    console.error(`[QA_VIOLATION] Gravity Leak on Collectible: "${(item.texture && item.texture.key) || 'item'}" has allowGravity=true. Collectibles will drop through world before or during gameplay!`);
                    break;
                  }
                }
              }
            }
          }
        }
      } catch (e) {}

      // 3. Win Condition Goal Presence
      try {
        const hudEl = document.querySelector('#hud');
        const hudText = hudEl ? (hudEl.innerText || '') : '';
        const hasGoal = !!(
          activeScene.flag || activeScene.goal || activeScene.exit || activeScene.portal || activeScene.finishLine ||
          children.some((c) => /flag|goal|exit|portal|finish|trophy/i.test((c.texture && c.texture.key) || c.name || ''))
        );
        const hasGravity = activeScene.physics && activeScene.physics.world && activeScene.physics.world.gravity && activeScene.physics.world.gravity.y > 0;
        if (hasGravity && !hasGoal && !/score|time|wave/i.test(hudText)) {
          console.error('[QA_VIOLATION] Missing Win Goal: No flag, portal, exit, or goal entity found in platformer level.');
        }
      } catch (e) {}

      // 4. Kill Plane / Pit Bounds Check
      try {
        const hasGravity = activeScene.physics && activeScene.physics.world && activeScene.physics.world.gravity && activeScene.physics.world.gravity.y > 0;
        if (hasGravity && player && player.body && activeScene.physics && activeScene.physics.world) {
          const worldBounds = activeScene.physics.world.bounds;
          const platforms = activeScene.platforms || activeScene.ground;
          let maxPlatY = worldBounds ? worldBounds.height : 600;
          if (platforms && typeof platforms.getChildren === 'function') {
            const platList = platforms.getChildren();
            if (platList.length > 0) {
              maxPlatY = Math.max(...platList.map((p) => p.y));
            }
          }
          if (player.y > maxPlatY + 180 && player.active) {
            console.error('[QA_VIOLATION] Pit Soft-lock: Player fell into pit below platforms without dying or respawning.');
          }
        }
      } catch (e) {}

      // 5. Hazard Collider Check
      try {
        const hazards = activeScene.hazards || activeScene.traps || activeScene.saws || activeScene.spikes;
        if (hazards && player && activeScene.physics && activeScene.physics.world && activeScene.physics.world.colliders) {
          const colliderQueue = activeScene.physics.world.colliders;
          const colliders = (typeof colliderQueue.getActive === 'function') ? colliderQueue.getActive() : (Array.isArray(colliderQueue) ? colliderQueue : []);
          const hasHazardOverlap = colliders.some((c) =>
            (c.object1 === player && (c.object2 === hazards || (hazards.getChildren && hazards.getChildren().includes(c.object2)))) ||
            (c.object2 === player && (c.object1 === hazards || (hazards.getChildren && hazards.getChildren().includes(c.object1))))
          );
          // Fire when hazards exist but never overlap the player — even when
          // world.colliders is empty (that IS the broken case).
          const hazardCount = (hazards.getChildren && hazards.getChildren().length) || 0;
          if (!hasHazardOverlap && hazardCount > 0) {
            console.error('[QA_VIOLATION] Dead Hazards: Hazards exist in scene but have no active collision/overlap with player.');
          }
        }
      } catch (e) {}

      // 6. Mobile Touch Controls on Desktop Check
      try {
        const touchControls = document.querySelectorAll('#mobile-dpad, #touch-arrows, .mobile-controls, .touch-controls');
        if (touchControls.length > 0 && window.innerWidth >= 960) {
          console.warn('[UI_WARNING] Mobile touch controls rendered on desktop widescreen viewport.');
        }
      } catch (e) {}
    });
  } catch (e) { /* best effort */ }

  // Emulate pause & resume
  try {
    await page.keyboard.press('Escape');
    await page.keyboard.press('KeyP');
    await page.evaluate(() => {
      const pauseBtn = document.querySelector('#btn-pause, #pause-btn, [data-action="pause"], button[aria-label*="pause" i]');
      if (pauseBtn) pauseBtn.click();
      else if (window.__GAME_BUS__) window.__GAME_BUS__.emit('pause');
      else if (window.__PHASER_EVENT_BUS__) window.__PHASER_EVENT_BUS__.emit('pause');
    });
    await sleep(300);
    await shot('pause');

    // Resume
    await page.keyboard.press('Escape');
    await page.keyboard.press('KeyP');
    await page.evaluate(() => {
      const resumeBtn = document.querySelector('#btn-resume, #resume-btn, [data-action="resume"], button[aria-label*="resume" i]');
      if (resumeBtn) resumeBtn.click();
      else if (window.__GAME_BUS__) window.__GAME_BUS__.emit('resume');
      else if (window.__PHASER_EVENT_BUS__) window.__PHASER_EVENT_BUS__.emit('resume');
    });
    await sleep(200);
  } catch (e) { /* best effort */ }

  // Emulate level restart / replay
  try {
    await page.evaluate(() => {
      const restartBtn = document.querySelector('#btn-restart, #restart-btn, [data-action="restart"], button[aria-label*="restart" i]');
      if (restartBtn) {
        restartBtn.click();
      } else if (window.__GAME_BUS__) {
        window.__GAME_BUS__.emit('restart-game');
        window.__GAME_BUS__.emit('restart');
      } else if (window.__PHASER_EVENT_BUS__) {
        window.__PHASER_EVENT_BUS__.emit('restart-game');
        window.__PHASER_EVENT_BUS__.emit('restart');
      }
    });
    await sleep(400);
    await shot('restart');
  } catch (e) { /* best effort */ }

  // Emulate game over / state transition
  try {
    await page.evaluate(() => {
      if (typeof window.__QA_FINISH_RACE__ === 'function') {
        window.__QA_FINISH_RACE__();
      } else if (typeof window.__GAME_OVER__ === 'function') {
        window.__GAME_OVER__();
      } else if (window.__GAME_BUS__) {
        window.__GAME_BUS__.emit('game-over');
      } else if (window.__PHASER_EVENT_BUS__) {
        window.__PHASER_EVENT_BUS__.emit('game-over');
      }
    });
    await sleep(400);
  } catch (e) { /* best effort */ }
  await shot('gameover');

  fs.writeFileSync('/home/user/console-errors.txt', JSON.stringify(errors));
  await browser.close();
}

main().catch((e) => {
  // ALWAYS persist the collected console errors first
  try {
    fs.writeFileSync('/home/user/console-errors.txt', JSON.stringify(errors));
  } catch (ce) { /* best-effort */ }
  fs.writeFileSync('/home/user/capture-errors.txt', String((e && e.stack) || e));
  process.exit(0);
});
