import * as THREE from "three"
import { math } from "./engine/index.js"

/* =========================================================================
   CENTRAL MONOLITH — IMMERSIVE INTERACTION UPGRADE (plan.md)
   Loaded as a module AFTER game.js (see index.html). game.js exceeds the
   sandbox per-file edit limit, so the upgrade lives here and attaches to the
   running game via window.__GAME__. Scope (per plan):
     - Multi-layered obsidian + gold monolith housing with chamfered bezels
       and copper/gold conduit accents.
     - Glowing neon cyan/gold circuit lattice + floating, drifting core light.
     - Living animated data-matrix CanvasTexture screen (scanlines, radar
       sweep, status readouts, data streams, chevrons, wave pulse + crest).
     - Proximity reactivity: within 4.5m of [0, 1.7, -11] the glow, scan
       frequency and embedded lights smoothly lerp from idle to brilliance.
     - Interaction: resonant synth chime + authoritative Nigerian/African
       examination-system narrator voice reading the exact monolith text;
       speech stops cleanly when the inspect panel closes.
   Nothing else (room, candidates, clues, notebook, judgment, UI) is touched.
   ========================================================================= */

const game = typeof window !== "undefined" ? window.__GAME__ : null
if (game && game.scene) {
  const scene = game.scene
  const GOLD = "#d4af37"
  const GOLD_DIM = "#8a7130"
  const MONOLITH_CENTER = new THREE.Vector3(0, 1.7, -11)

  // -------------------------------------------------------------------------
  // Retire the legacy flat face plane and re-obsidian the core housing.
  // -------------------------------------------------------------------------
  let legacyFace = null
  let legacyCore = null
  let monolithLight = null
  scene.traverse((obj) => {
    const p = obj.position
    if (obj.isPointLight && Math.abs(p.x) < 0.01 && Math.abs(p.y - 2.6) < 0.01 && Math.abs(p.z + 11.2) < 0.01) {
      monolithLight = obj
      return
    }
    if (!obj.isMesh) return
    if (Math.abs(p.x) < 0.01 && Math.abs(p.y - 1.7) < 0.01 && Math.abs(p.z + 10.68) < 0.01) legacyFace = obj
    else if (Math.abs(p.x) < 0.01 && Math.abs(p.y - 1.6) < 0.01 && Math.abs(p.z + 11) < 0.01) legacyCore = obj
  })
  if (legacyFace) {
    scene.remove(legacyFace)
    legacyFace.geometry?.dispose?.()
    legacyFace.material?.dispose?.()
  }
  if (legacyCore && legacyCore.material && "color" in legacyCore.material) {
    legacyCore.material.color.set("#0a0e17")
  }

  // -------------------------------------------------------------------------
  // Upgraded housing: gold bezel, conduits, cap/base trim (group at the wall).
  // -------------------------------------------------------------------------
  const monolithGroup = new THREE.Group()
  monolithGroup.position.set(0, 0, -11)
  scene.add(monolithGroup)

  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(1.38, 2.58, 0.06),
    new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.75, roughness: 0.3, emissive: GOLD, emissiveIntensity: 0.12 })
  )
  bezel.position.set(0, 1.7, 0.3)
  monolithGroup.add(bezel)
  for (const sx of [-1, 1]) {
    const conduit = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 3.0, 0.1),
      new THREE.MeshStandardMaterial({ color: GOLD_DIM, metalness: 0.7, roughness: 0.35 })
    )
    conduit.position.set(sx * 0.74, 1.6, 0.26)
    monolithGroup.add(conduit)
  }
  const capTrim = new THREE.Mesh(
    new THREE.BoxGeometry(1.66, 0.08, 0.66),
    new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.75, roughness: 0.3 })
  )
  capTrim.position.set(0, 3.22, 0)
  monolithGroup.add(capTrim)
  const baseTrim = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.1, 0.7),
    new THREE.MeshStandardMaterial({ color: GOLD_DIM, metalness: 0.7, roughness: 0.35 })
  )
  baseTrim.position.set(0, 0.05, 0)
  monolithGroup.add(baseTrim)

  // -------------------------------------------------------------------------
  // Glowing circuit lattice (procedural, drawn once, additive behind glass).
  // -------------------------------------------------------------------------
  const latticeCanvas = document.createElement("canvas")
  latticeCanvas.width = 256
  latticeCanvas.height = 512
  const lctx = latticeCanvas.getContext("2d")
  lctx.fillStyle = "#04070d"
  lctx.fillRect(0, 0, 256, 512)
  lctx.lineWidth = 2
  for (let i = 0; i < 26; i++) {
    lctx.strokeStyle = i % 3 === 0 ? "rgba(212,175,55,0.55)" : "rgba(111,211,255,0.45)"
    lctx.beginPath()
    let x = math.randRange(8, 248)
    let y = math.randRange(8, 504)
    lctx.moveTo(x, y)
    for (let s = 0; s < 4; s++) {
      if (s % 2 === 0) x = math.clamp(x + math.randRange(-64, 64), 8, 248)
      else y = math.clamp(y + math.randRange(-96, 96), 8, 504)
      lctx.lineTo(x, y)
    }
    lctx.stroke()
    lctx.fillStyle = i % 3 === 0 ? "#d4af37" : "#6fd3ff"
    lctx.beginPath()
    lctx.arc(x, y, 3, 0, Math.PI * 2)
    lctx.fill()
  }
  const latticeTex = new THREE.CanvasTexture(latticeCanvas)
  const latticePanel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.44, 2.84),
    new THREE.MeshBasicMaterial({
      map: latticeTex,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )
  latticePanel.position.set(0, 1.7, 0.315)
  monolithGroup.add(latticePanel)

  // -------------------------------------------------------------------------
  // Dynamic interface screen — living examination-system HUD (CanvasTexture).
  // -------------------------------------------------------------------------
  const screenCanvas = document.createElement("canvas")
  screenCanvas.width = 512
  screenCanvas.height = 1024
  const sctx = screenCanvas.getContext("2d")
  const screenTex = new THREE.CanvasTexture(screenCanvas)
  screenTex.colorSpace = THREE.SRGBColorSpace
  const monolithFace = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 2.4),
    new THREE.MeshBasicMaterial({ map: screenTex, transparent: true, opacity: 0.94 })
  )
  monolithFace.position.set(0, 1.7, 0.34)
  monolithGroup.add(monolithFace)

  // Floating inner core light (drifts + pulses; proximity-boosted below).
  const coreLight = new THREE.PointLight(0x6fd3ff, 2.2, 5)
  coreLight.position.set(0, 1.7, 0.5)
  monolithGroup.add(coreLight)

  let monolithGlow = 0 // 0 = idle/dim, 1 = focused examination brilliance

  function drawMonolithScreen(t, glow) {
    const W = screenCanvas.width
    const H = screenCanvas.height
    sctx.fillStyle = "#03060c"
    sctx.fillRect(0, 0, W, H)

    // subtle horizontal scanlines
    sctx.fillStyle = "rgba(111,211,255,0.05)"
    for (let y = 0; y < H; y += 6) sctx.fillRect(0, y, W, 2)

    // header block
    sctx.fillStyle = "rgba(212,175,55,0.14)"
    sctx.fillRect(24, 28, W - 48, 64)
    sctx.strokeStyle = "#d4af37"
    sctx.lineWidth = 2
    sctx.strokeRect(24, 28, W - 48, 64)
    sctx.fillStyle = "#d4af37"
    sctx.font = "bold 26px ui-monospace, monospace"
    sctx.textAlign = "center"
    sctx.fillText("LAGOS EXAMINATION SYSTEM", W / 2, 68)

    // status indicators
    sctx.font = "18px ui-monospace, monospace"
    sctx.textAlign = "left"
    sctx.fillStyle = "#6fd3ff"
    sctx.fillText("DIRECTIVE: CANDIDATE ASSESSMENT", 36, 132)
    const blink = Math.sin(t * 3) > -0.4
    sctx.fillStyle = blink ? "#7CFC9A" : "rgba(124,252,154,0.35)"
    sctx.fillText("SYSTEM STATE: ACTIVE SCAN", 36, 162)
    sctx.fillStyle = "#d4af37"
    sctx.fillText("PROTOCOL 09: ENGAGED", 36, 192)

    // telemetry radar sweep (frequency rises with proximity)
    const rx = 128
    const ry = 320
    const rr = 78
    sctx.strokeStyle = "rgba(111,211,255,0.5)"
    sctx.lineWidth = 1.5
    for (let k = 1; k <= 3; k++) {
      sctx.beginPath()
      sctx.arc(rx, ry, (rr * k) / 3, 0, Math.PI * 2)
      sctx.stroke()
    }
    sctx.beginPath()
    sctx.moveTo(rx, ry)
    const ang = t * (1.1 + glow * 1.6)
    sctx.lineTo(rx + Math.cos(ang) * rr, ry + Math.sin(ang) * rr)
    sctx.strokeStyle = "#d4af37"
    sctx.lineWidth = 2.5
    sctx.stroke()

    // diagnostic readout bars
    sctx.font = "14px ui-monospace, monospace"
    sctx.fillStyle = "rgba(143,163,207,0.85)"
    sctx.fillText("DIAGNOSTIC TELEMETRY", 248, 268)
    for (let i = 0; i < 7; i++) {
      const v = 0.32 + 0.6 * Math.abs(Math.sin(t * (1.4 + i * 0.42 + glow * 2.4) + i * 1.7))
      sctx.fillStyle = "rgba(20,28,44,0.9)"
      sctx.fillRect(248, 282 + i * 20, 220, 11)
      sctx.fillStyle = i % 2 === 0 ? "#6fd3ff" : "#d4af37"
      sctx.fillRect(248, 282 + i * 20, 220 * v, 11)
    }

    // flowing digital data streams
    sctx.font = "15px ui-monospace, monospace"
    for (let col = 0; col < 8; col++) {
      const x = 34 + col * 58
      for (let r = 0; r < 9; r++) {
        const yy = 470 + r * 26 + ((t * (52 + col * 14 + glow * 90) + col * 90) % 234)
        const ch = String.fromCharCode(0x30 + Math.floor(Math.abs(Math.sin(t * 2.2 + col * 3.1 + r * 1.3)) * 42))
        sctx.fillStyle = r === 0 ? "rgba(212,175,55,0.9)" : "rgba(111,211,255,0.42)"
        sctx.fillText(ch, x, yy)
      }
    }

    // golden-cyan chevron motifs
    for (let i = 0; i < 3; i++) {
      const yy = 748 + i * 26
      sctx.strokeStyle = i % 2 === 0 ? "rgba(212,175,55,0.8)" : "rgba(111,211,255,0.7)"
      sctx.lineWidth = 3
      sctx.beginPath()
      sctx.moveTo(W / 2 - 46, yy)
      sctx.lineTo(W / 2, yy + 15)
      sctx.lineTo(W / 2 + 46, yy)
      sctx.stroke()
    }

    // fluid wave pulse with glowing focal crest (crest reacts to proximity)
    sctx.beginPath()
    for (let x = 0; x <= W; x += 6) {
      const y =
        888 +
        Math.sin(x * 0.021 + t * (1.6 + glow * 2.6)) * (13 + glow * 15) +
        Math.sin(x * 0.052 - t * 2.3) * 5
      if (x === 0) sctx.moveTo(x, y)
      else sctx.lineTo(x, y)
    }
    sctx.strokeStyle = "#6fd3ff"
    sctx.lineWidth = 2.5
    sctx.stroke()
    const crestX = W / 2 + Math.sin(t * 0.8) * 130
    const crestY =
      888 +
      Math.sin(crestX * 0.021 + t * (1.6 + glow * 2.6)) * (13 + glow * 15) +
      Math.sin(crestX * 0.052 - t * 2.3) * 5
    const crest = sctx.createRadialGradient(crestX, crestY, 1, crestX, crestY, 24 + glow * 20)
    crest.addColorStop(0, "rgba(255,240,200,0.95)")
    crest.addColorStop(1, "rgba(212,175,55,0)")
    sctx.fillStyle = crest
    sctx.beginPath()
    sctx.arc(crestX, crestY, 24 + glow * 20, 0, Math.PI * 2)
    sctx.fill()

    // sweeping scan bar (frequency rises with proximity)
    const sweepY = ((t * (110 + glow * 260)) % (H + 120)) - 60
    const grad = sctx.createLinearGradient(0, sweepY - 34, 0, sweepY + 34)
    grad.addColorStop(0, "rgba(111,211,255,0)")
    grad.addColorStop(0.5, `rgba(111,211,255,${0.1 + glow * 0.14})`)
    grad.addColorStop(1, "rgba(111,211,255,0)")
    sctx.fillStyle = grad
    sctx.fillRect(0, sweepY - 34, W, 68)

    // footer
    sctx.fillStyle = "rgba(143,163,207,0.8)"
    sctx.font = "15px ui-monospace, monospace"
    sctx.textAlign = "center"
    sctx.fillText("THE ONE QUESTION — NO ANSWER KEY ON FILE", W / 2, H - 34)

    screenTex.needsUpdate = true
  }

  // -------------------------------------------------------------------------
  // Proximity + animation loop (Euclidean distance camera -> [0, 1.7, -11]).
  // -------------------------------------------------------------------------
  let monolithTime = 0
  let frameSkip = 0
  const camPos = new THREE.Vector3()
  game.onUpdate((dt) => {
    monolithTime += dt
    game.camera.getWorldPosition(camPos)
    const dist = camPos.distanceTo(MONOLITH_CENTER)
    const target = math.clamp01((4.5 - dist) / 3.2)
    // framerate-independent smoothing toward the proximity target
    monolithGlow = math.lerp(monolithGlow, target, 1 - Math.exp(-4 * dt))

    if (monolithLight) monolithLight.intensity = math.lerp(4, 16, monolithGlow)
    coreLight.intensity = 1.6 + monolithGlow * 3.4 + Math.sin(monolithTime * 2.2) * 0.35
    // gentle internal light drift
    coreLight.position.x = Math.sin(monolithTime * 0.7) * 0.34
    coreLight.position.y = 1.7 + Math.sin(monolithTime * 1.1) * 0.28
    latticePanel.material.opacity = 0.34 + monolithGlow * 0.42 + Math.sin(monolithTime * 1.7) * 0.05
    monolithFace.material.opacity = 0.86 + monolithGlow * 0.12

    // redraw the data-matrix screen (~20fps is plenty, cheap on software GL)
    frameSkip++
    if (frameSkip >= 3) {
      frameSkip = 0
      drawMonolithScreen(monolithTime, monolithGlow)
    }

    pollInspectModal()
  })

  // -------------------------------------------------------------------------
  // Narrator voice (African examination system) + resonant chime on inspect.
  // game.js owns the inspect modal; we observe it non-invasively: when the
  // monolith panel opens -> chime + speak the exact text; when it closes ->
  // stop narration cleanly (mirrors stopDialogueSpeech in closeInspect).
  // -------------------------------------------------------------------------
  const MONOLITH_VOICE = {
    pitch: 0.86,
    rate: 0.9,
    volume: 1.0,
    locales: ["en-NG", "en-GH", "en-ZA", "en-GB", "en-US"],
  }
  const MONOLITH_MONOLOGUE =
    "WHAT IS THE ONE QUESTION WORTH FAILING FOR?"

  const speech = (typeof window !== "undefined" && window.speechSynthesis) || null
  let cachedVoices = []
  function refreshVoices() {
    try {
      cachedVoices = speech ? speech.getVoices() || [] : []
    } catch (_err) {
      cachedVoices = []
    }
  }
  if (speech) {
    refreshVoices()
    try {
      speech.addEventListener?.("voiceschanged", refreshVoices)
    } catch (_err) { /* best-effort */ }
  }
  function pickVoice(locales) {
    if (!cachedVoices.length) refreshVoices()
    for (const tag of locales) {
      const exact = cachedVoices.find((v) => v.lang && v.lang.toLowerCase() === tag.toLowerCase())
      if (exact) return exact
    }
    for (const tag of locales) {
      const base = tag.split("-")[0].toLowerCase()
      const partial = cachedVoices.find((v) => v.lang && v.lang.toLowerCase().startsWith(base))
      if (partial) return partial
    }
    return cachedVoices[0] || null
  }
  function stopMonolithSpeech() {
    if (!speech) return
    try {
      speech.cancel()
    } catch (_err) { /* best-effort */ }
  }
  function speakMonolith() {
    if (!speech) return
    try {
      speech.cancel()
      setTimeout(() => {
        try {
          speech.resume()
          const utter = new SpeechSynthesisUtterance(MONOLITH_MONOLOGUE)
          const voice = pickVoice(MONOLITH_VOICE.locales)
          if (voice) utter.voice = voice
          utter.pitch = MONOLITH_VOICE.pitch
          utter.rate = MONOLITH_VOICE.rate
          utter.volume = MONOLITH_VOICE.volume
          utter.lang = voice ? voice.lang : MONOLITH_VOICE.locales[0]
          utter.onerror = () => { /* blocked speech is non-fatal */ }
          speech.speak(utter)
        } catch (_err) { /* speech is a nicety — never break the flow */ }
      }, 60)
    } catch (_err) { /* speech is a nicety — never break the flow */ }
  }

  // Resonant chime — layered Web Audio synth tones through the engine audio.
  function synthNote(frequency, duration, gain, delay = 0, type = "sine") {
    try {
      game.audio.tone({ frequency, duration, gain, delay, type })
    } catch (_err) { /* audio is non-fatal */ }
  }
  function playMonolithChime() {
    synthNote(196, 1.1, 0.2, 0, "sine")
    synthNote(294, 0.9, 0.15, 0.07, "sine")
    synthNote(392, 0.7, 0.11, 0.14, "triangle")
    synthNote(588, 0.45, 0.07, 0.22, "sine")
  }

  const inspectModal = document.getElementById("inspect-modal")
  const inspectTitle = document.getElementById("inspect-title")
  let monolithInspectOpen = false
  function pollInspectModal() {
    if (!inspectModal) return
    const open =
      !inspectModal.classList.contains("hidden") &&
      (inspectTitle?.textContent || "").trim() === "The Central Monolith"
    if (open && !monolithInspectOpen) {
      monolithInspectOpen = true
      playMonolithChime()
      speakMonolith()
    } else if (!open && monolithInspectOpen) {
      monolithInspectOpen = false
      stopMonolithSpeech()
    }
  }
}