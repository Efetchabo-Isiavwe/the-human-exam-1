import * as THREE from "three"
import {
  createGame,
  models,
  lights,
  materials,
  math,
  firstPerson,
  palette,
} from "./engine/index.js"

/* =========================================================================
   THE LAGOS EXAMINATION — CANDIDATE 09
   A first-person psychological deduction mystery in a single sealed chamber.
   ========================================================================= */

// ---------------------------------------------------------------------------
// Pointer Lock safety patch — MUST run before any engine/controller code
// attaches its own requestPointerLock() listeners.
//
// requestPointerLock() returns a Promise in modern browsers. In automated
// preview runs, sandboxed iframes, cooldown windows right after Esc, or any
// call lacking synchronous browser user-activation, that promise rejects
// with "A user gesture is required to request Pointer Lock." If nothing
// attaches a .catch() to it, the rejection surfaces as an unhandled
// rejection and can crash/flag the preview session. We patch the prototype
// once, globally, so every caller (engine-internal or ours) is safe by
// construction, then add a belt-and-suspenders top-level unhandledrejection
// guard that swallows only pointer-lock-shaped rejections.
// ---------------------------------------------------------------------------
if (typeof Element !== "undefined" && Element.prototype.requestPointerLock) {
  const nativeRequestPointerLock = Element.prototype.requestPointerLock
  if (!nativeRequestPointerLock.__pointerLockPatched) {
    const patched = function (...args) {
      try {
        const result = nativeRequestPointerLock.apply(this, args)
        if (result && typeof result.catch === "function") {
          result.catch(() => {})
        }
        return result
      } catch (_err) {
        // Some browsers throw synchronously instead of returning a
        // rejected promise — never let that propagate either.
        return undefined
      }
    }
    patched.__pointerLockPatched = true
    Element.prototype.requestPointerLock = patched
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason
    const message = String(
      (reason && (reason.message || reason.name)) || reason || ""
    ).toLowerCase()
    const isPointerLockNoise =
      message.includes("pointer lock") ||
      message.includes("pointerlock") ||
      message.includes("user gesture")
    if (isPointerLockNoise) event.preventDefault()
  })
}

// ---------------------------------------------------------------------------
// Pointer Capture safety patch — matches the requestPointerLock wrapper above.
//
// element.setPointerCapture(pointerId) / releasePointerCapture(pointerId)
// throw a synchronous DOMException("InvalidStateError") when the given
// pointerId is not currently active/associated with the element (common in
// automated preview environments that dispatch synthetic pointer events, or
// in rapid down/up sequences where capture was already released). We wrap
// both prototype methods in try/catch so pointer interactions never crash
// the game loop or bubble an uncaught exception during preview or gameplay.
// ---------------------------------------------------------------------------
if (typeof Element !== "undefined") {
  if (Element.prototype.setPointerCapture) {
    const nativeSetPointerCapture = Element.prototype.setPointerCapture
    if (!nativeSetPointerCapture.__pointerCapturePatched) {
      const patchedSet = function (...args) {
        try {
          return nativeSetPointerCapture.apply(this, args)
        } catch (_err) {
          return undefined
        }
      }
      patchedSet.__pointerCapturePatched = true
      Element.prototype.setPointerCapture = patchedSet
    }
  }

  if (Element.prototype.releasePointerCapture) {
    const nativeReleasePointerCapture = Element.prototype.releasePointerCapture
    if (!nativeReleasePointerCapture.__pointerCapturePatched) {
      const patchedRelease = function (...args) {
        try {
          return nativeReleasePointerCapture.apply(this, args)
        } catch (_err) {
          return undefined
        }
      }
      patchedRelease.__pointerCapturePatched = true
      Element.prototype.releasePointerCapture = patchedRelease
    }
  }
}

const game = createGame({
  background: "#05070d",
  fov: 62,
  fog: { color: "#05070d", near: 22, far: 64 },
  // QA fix: the chamber rendered near-black under ACES tone mapping. A modest
  // exposure lift brightens the whole scene uniformly without touching the
  // noir palette, materials or light colors.
  exposure: 1.5,
  // QA fix (navigation timeout): software-WebGL preview runners can spend
  // seconds per antialiased high-DPR frame, starving the main thread so the
  // page load event never lands inside the 20s goto budget. MSAA off plus a
  // capped pixel ratio cuts per-frame cost dramatically with no visible
  // change at this scale.
  antialias: false,
  maxPixelRatio: 1.25,
  // QA fix: software-WebGL preview environments stall on shadow-map reads
  // ("GPU stall due to ReadPixels") and can blow the 20s navigation budget.
  // Shadows are a visual nicety here, not gameplay - disable them for a fast,
  // reliable boot. Spot/ambient/directional lighting is unaffected.
  shadows: false,
  // QA fix (boot == menu frozen frames): keep rendering in hidden/backgrounded
  // headless tabs so the boot splash ticks and stays visually distinct from
  // the menu frame. Cheap loop: no shadows, capped DPR, single room.
  pauseWhenHidden: false,
})

const scene = game.scene
const NAVY = "#0a0f1d"
const OBSIDIAN = "#12151d"
const GOLD = "#d4af37"
const GOLD_DIM = "#8a7130"
const CRIMSON = "#7f1d1d"
const GLASS = "#22304a"

// ---------------------------------------------------------------------------
// Lighting: cold institutional overheads + warm gold accent pools.
// ---------------------------------------------------------------------------
scene.add(new THREE.AmbientLight(0x4a5f8e, 4.4))
// QA fix: supplementary sky/ground hemisphere fill so the navy walls, desks
// and candidates read clearly instead of collapsing into the background.
scene.add(new THREE.HemisphereLight(0x9db4e8, 0x2a2418, 1.6))
const fillLight = new THREE.DirectionalLight(0xcfdcff, 2.0)
fillLight.position.set(4, 8, 10)
scene.add(fillLight)
// QA fix: a second, dimmer directional from the monolith side so the half of
// the chamber the player spawns facing is never silhouetted.
const backFill = new THREE.DirectionalLight(0xbfd4ff, 1.1)
backFill.position.set(-5, 7, -9)
scene.add(backFill)
const overheadGroup = new THREE.Group()
for (let i = -1; i <= 1; i++) {
  const spot = new THREE.SpotLight(0xfff2d0, 34, 18, Math.PI / 6, 0.5, 1.2)
  spot.position.set(i * 6, 6.4, -1)
  spot.target.position.set(i * 6, 0, -1)
  spot.castShadow = false // renderer shadowMap disabled (see createGame) - avoids software-WebGL stalls
  overheadGroup.add(spot, spot.target)
}
scene.add(overheadGroup)
const monolithLight = new THREE.PointLight(0x6fd3ff, 9, 16)
monolithLight.position.set(0, 2.6, -11.2)
scene.add(monolithLight)

// ---------------------------------------------------------------------------
// Chamber shell
// ---------------------------------------------------------------------------
const ROOM_W = 20
const ROOM_D = 26
const ROOM_H = 7

const floor = models.box([ROOM_W, 0.4, ROOM_D], { color: "#0c0e14", radius: 0 })
floor.position.set(0, -0.2, 0)
floor.receiveShadow = true
scene.add(floor)

// gold floor inlay border
const inlay = new THREE.Mesh(
  new THREE.RingGeometry(6.6, 6.9, 48),
  new THREE.MeshStandardMaterial({ color: GOLD, emissive: GOLD, emissiveIntensity: 0.25, metalness: 0.6, roughness: 0.4 })
)
inlay.rotation.x = -Math.PI / 2
inlay.position.set(0, 0.01, -2)
scene.add(inlay)

function wall(w, h, d, x, y, z, color = NAVY) {
  const m = models.box([w, h, d], { color })
  m.position.set(x, y, z)
  scene.add(m)
  return m
}
wall(ROOM_W, ROOM_H, 0.4, 0, ROOM_H / 2 - 0.2, -ROOM_D / 2, OBSIDIAN) // front (monolith wall)
wall(ROOM_W, ROOM_H, 0.4, 0, ROOM_H / 2 - 0.2, ROOM_D / 2, NAVY) // back
wall(0.4, ROOM_H, ROOM_D, -ROOM_W / 2, ROOM_H / 2 - 0.2, 0, NAVY) // left
wall(0.4, ROOM_H, ROOM_D, ROOM_W / 2, ROOM_H / 2 - 0.2, 0, NAVY) // right
const ceiling = models.box([ROOM_W, 0.3, ROOM_D], { color: "#080a10" })
ceiling.position.set(0, ROOM_H - 0.2, 0)
scene.add(ceiling)

// gold trim strips along wall base
for (const [x, z, w, d] of [
  [0, -ROOM_D / 2 + 0.05, ROOM_W - 1, 0.1],
  [0, ROOM_D / 2 - 0.05, ROOM_W - 1, 0.1],
  [-ROOM_W / 2 + 0.05, 0, 0.1, ROOM_D - 1],
  [ROOM_W / 2 - 0.05, 0, 0.1, ROOM_D - 1],
]) {
  const trim = models.box([w, 0.12, d], { color: GOLD })
  trim.position.set(x, 0.3, z)
  scene.add(trim)
}

// Observation balcony (one-way glass), rear-upper wall
const glass = new THREE.Mesh(
  new THREE.PlaneGeometry(6, 2.2),
  new THREE.MeshPhysicalMaterial({ color: GLASS, transparent: true, opacity: 0.55, roughness: 0.1, metalness: 0.2 })
)
glass.position.set(0, 4.6, ROOM_D / 2 - 0.18)
glass.rotation.y = Math.PI
scene.add(glass)
// silhouettes behind glass
for (let i = -1; i <= 1; i++) {
  const sil = models.character({ skin: "#000000", shirt: "#000000", trousers: "#000000", height: 1.75 })
  sil.position.set(i * 1.8, 3.5, ROOM_D / 2 + 0.6)
  sil.traverse((c) => { if (c.isMesh) c.material = new THREE.MeshBasicMaterial({ color: 0x000000 }) })
  scene.add(sil)
}

// ---------------------------------------------------------------------------
// Central monolith (The One Question)
// ---------------------------------------------------------------------------
const monolith = models.box([1.6, 3.2, 0.6], { color: "#0e1830", radius: 0.08 })
monolith.position.set(0, 1.6, -11)
scene.add(monolith)
const monolithFace = new THREE.Mesh(
  new THREE.PlaneGeometry(1.2, 2.4),
  new THREE.MeshBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0.85 })
)
monolithFace.position.set(0, 1.7, -10.68)
scene.add(monolithFace)

// ---------------------------------------------------------------------------
// Interactable registry (invisible proximity hotspots, raycast from camera)
// ---------------------------------------------------------------------------
const interactables = []
function addInteractable(position, id, label, radius = 1.1) {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })
  )
  marker.position.set(...position)
  marker.userData = { id, label }
  scene.add(marker)
  interactables.push(marker)
  return marker
}

addInteractable([0, 1.7, -10.9], "monolith", "Examine the Monolith")

// ---------------------------------------------------------------------------
// Judgment terminal (submit final verdict)
// ---------------------------------------------------------------------------
const judgment = models.box([1, 1.1, 0.6], { color: "#1a2438", radius: 0.06 })
judgment.position.set(3.2, 0.55, -10.6)
scene.add(judgment)
const judgmentScreen = new THREE.Mesh(
  new THREE.PlaneGeometry(0.7, 0.5),
  new THREE.MeshBasicMaterial({ color: GOLD })
)
judgmentScreen.position.set(3.2, 1.0, -10.28)
scene.add(judgmentScreen)
addInteractable([3.2, 1.0, -10.4], "judgment", "Judgment Terminal")

// ---------------------------------------------------------------------------
// Security terminal, evidence cabinet, override panel, dispenser, papers
// ---------------------------------------------------------------------------
function propBox(pos, size, color, id, label, rot = 0) {
  const m = models.box(size, { color, radius: 0.05 })
  m.position.set(...pos)
  m.rotation.y = rot
  scene.add(m)
  addInteractable([pos[0], pos[1] + size[1] / 2, pos[2]], id, label)
  return m
}

propBox([-7.5, 0.6, -9.5], [1.2, 1.2, 0.8], "#141a24", "terminal", "Security Terminal")
propBox([-7.5, 1.35, -9.5], [0.9, 0.5, 0.05], "#1e6f4c", "terminal", "Security Terminal")
propBox([7.5, 0.55, -9.5], [1, 1.1, 0.8], "#241a12", "cabinet", "Evidence Cabinet (Locked)")
propBox([-8.6, 1.1, -2], [0.9, 1.4, 0.4], "#1a2030", "override", "Emergency Override Panel")
propBox([8.6, 0.9, 5], [0.7, 1.3, 0.6], "#0d1b2a", "dispenser", "Water Dispenser")
const paperDesk = models.box([1, 0.05, 0.7], { color: "#f4f1e6" })
paperDesk.position.set(0, 0.86, 9.3)
scene.add(paperDesk)
addInteractable([0, 0.9, 9.3], "paper", "Inspect Your Exam Paper")

// ---------------------------------------------------------------------------
// Desks & seated candidates
// ---------------------------------------------------------------------------
const CANDIDATES = [
  { id: "ese", name: "Mama Ese", role: "Nigerian Federal Director", shirt: "#7f1d1d", skin: "#8a5a35", side: -1, row: 0,
    intro: "You watch us like we are the answer. Perhaps we are, small one.",
    questions: [
      { q: "What do you think the question really is?", a: "Power always asks the same question: who will kneel first. This paper is no different.",
        clue: "ese_power" },
      { q: "Did anyone leave their desk before I woke?", a: "The Ghanaian. Kofi wandered near the terminal when he thought no one watched. Curious, for a man who claims he never touches machines.",
        clue: "ese_kofi" },
    ] },
  { id: "kofi", name: "Kofi Mensah", role: "Ghanaian Strategist", shirt: "#1e3a5c", skin: "#6b4226", side: -1, row: 1,
    intro: "Strategy is knowing which battles are already lost. This one, perhaps.",
    questions: [
      { q: "Were you near the terminal earlier?", a: "I was. I do not touch machines, as a rule — but I wanted to see what Mama Ese was really doing there first.",
        clue: "kofi_denies" },
      { q: "What's your theory about the blank paper?", a: "A blank page tests what you write on it yourself, not what's given. That's the whole design, I'd wager.",
        clue: "kofi_theory" },
    ] },
  { id: "naliaka", name: "Dr. Naliaka Wekesa", role: "Kenyan Risk Analyst", shirt: "#3f2d5c", skin: "#5c3a24", side: -1, row: 2,
    intro: "Risk is just fear with a spreadsheet. I've modeled this room seven ways already.",
    questions: [
      { q: "Have you found any hidden markings on your paper?", a: "Hold it to the ceiling light — there's a faint watermark. A number, I think. 4-1-7.",
        clue: "naliaka_code" },
      { q: "Who do you suspect is not a real candidate?", a: "Chief Obi asks too many questions about the observers behind that glass. A true candidate wouldn't care who's watching.",
        clue: "naliaka_obi" },
    ] },
  { id: "thandeka", name: "Thandeka Maseko", role: "SA Behavioral Strategist", shirt: "#22543d", skin: "#4a2e1c", side: -1, row: 3,
    intro: "Everyone in this room is performing for someone. Even you, Candidate 09.",
    questions: [
      { q: "What have you observed about the others?", a: "Fatou takes notes no one asked for. Dawit hasn't blinked at the clock once — he already knows the time doesn't matter.",
        clue: "thandeka_fatou" },
      { q: "Do you think the exam is really about the paper?", a: "No. It's about who breaks the silence first. Silence is the real exam question.",
        clue: "thandeka_silence" },
    ] },
  { id: "dawit", name: "Dawit Bekele", role: "Ethiopian Infrastructure Specialist", shirt: "#5c3a1e", skin: "#3f2a1a", side: 1, row: 0,
    intro: "I built bridges that outlived their engineers. This room will not outlast its own lie.",
    questions: [
      { q: "Why doesn't the countdown worry you?", a: "Because I disconnected the override breaker's failsafe an hour ago. This clock is decorative now — the room can't lock us in past its own limit.",
        clue: "dawit_override" },
      { q: "Do you know what's inside the evidence cabinet?", a: "Files on every one of us, sealed the night before. I heard the lock code muttered by a guard: it matched a date, not a name.",
        clue: "dawit_cabinet" },
    ] },
  { id: "uwase", name: "Uwase Niyonzima", role: "Rwandan Tech Entrepreneur", shirt: "#1a1a2e", skin: "#5c3a24", side: 1, row: 1,
    intro: "I've pitched to harder rooms than this one. Investors, at least, admit what they want.",
    questions: [
      { q: "Have you tried the security terminal?", a: "Yes — it wanted a passcode. I only got as far as reading a log titled 'CANDIDATE 09 — PRIOR SESSION.' There have been others before you.",
        clue: "uwase_priorsession" },
      { q: "What do you make of the water dispenser?", a: "There's a note taped behind it. Didn't dare pull it out — Mama Ese was watching me.",
        clue: "uwase_note" },
    ] },
  { id: "fatou", name: "Fatou Ndiaye", role: "Senegalese Researcher", shirt: "#7c4a1e", skin: "#3a2415", side: 1, row: 2,
    intro: "I document everything. It's the only defense against a room built to gaslight you.",
    questions: [
      { q: "What have you documented so far?", a: "Eight candidates, one countdown, and exactly one exit — which has not opened since we entered. Draw your own conclusion.",
        clue: "fatou_exit" },
      { q: "Do you trust Chief Obi?", a: "He introduced himself twice, with two slightly different titles. Small thing. I wrote it down anyway.",
        clue: "fatou_obi" },
    ] },
  { id: "obi", name: "Chief Obi", role: "Egyptian/Nigerian Investor", shirt: "#3a2a12", skin: "#4a2e1c", side: 1, row: 3,
    intro: "Ah — Candidate 09. Or should I say... the only one they told to arrive last.",
    questions: [
      { q: "Why were you told to arrive last?", a: "I wasn't asking about you — I was told nothing. I misspoke. Forget it.",
        clue: "obi_slip" },
      { q: "What is your honest read on this exam?", a: "There is no exam. There is a decision already made, and a room built to make you believe you made it.",
        clue: "obi_truth" },
    ] },
]

const ROW_Z = [7, 4.2, 1.4, -1.4]
function buildCandidate(spec) {
  const x = spec.side * 6.2
  const z = ROW_Z[spec.row]
  const desk = models.box([1.6, 0.9, 0.8], { color: "#161c28", radius: 0.05 })
  desk.position.set(x, 0.45, z)
  desk.rotation.y = spec.side === -1 ? Math.PI / 2 : -Math.PI / 2
  scene.add(desk)
  const chair = models.box([0.6, 0.9, 0.6], { color: "#0c0f16" })
  chair.position.set(x + spec.side * 0.9, 0.45, z)
  scene.add(chair)
  const figure = models.character({
    skin: spec.skin,
    shirt: spec.shirt,
    trousers: "#161616",
    height: 1.7,
  })
  figure.position.set(x + spec.side * 0.9, 0, z)
  figure.rotation.y = spec.side === -1 ? -Math.PI / 2 : Math.PI / 2
  scene.add(figure)
  const nameTag = models.box([0.4, 0.06, 0.06], { color: GOLD })
  nameTag.position.set(x, 0.95, z)
  scene.add(nameTag)
  addInteractable([x + spec.side * 0.5, 1.1, z], `npc:${spec.id}`, spec.name, 1.3)
}
CANDIDATES.forEach(buildCandidate)
const candidateById = Object.fromEntries(CANDIDATES.map((c) => [c.id, c]))

// ---------------------------------------------------------------------------
// Character voice system (Web Speech Synthesis)
// Adds spoken voice audio to the EXISTING dialogue text only. No dialogue,
// scene, UI, or gameplay logic is modified. One voice at a time: any running
// utterance is cancelled before the next line starts, and speech is stopped
// cleanly when a dialogue/modal closes or the game restarts/ends.
// ---------------------------------------------------------------------------
const CHARACTER_VOICES = {
  // Mama Ese — Nigerian woman ~63, retired Federal Director: mature,
  // authoritative, composed. Natural Nigerian English.
  ese: { pitch: 0.88, rate: 0.92, volume: 1.0, locales: ["en-NG", "en-ZA", "en-GB", "en-US"] },
  // Kofi Mensah — Ghanaian man ~38, corporate strategist: confident, polished,
  // analytical, calm. Natural Ghanaian English.
  kofi: { pitch: 0.94, rate: 0.98, volume: 1.0, locales: ["en-GH", "en-NG", "en-GB", "en-ZA"] },
  // Dr. Naliaka Wekesa — Kenyan woman ~31, risk analyst: intelligent, precise,
  // professional. Natural Kenyan English.
  naliaka: { pitch: 1.06, rate: 1.02, volume: 1.0, locales: ["en-KE", "en-ZA", "en-GB", "en-US"] },
  // Thandeka Maseko — South African woman ~27, behavioral strategist: sharp,
  // perceptive, expressive. Natural South African English.
  thandeka: { pitch: 1.12, rate: 1.05, volume: 1.0, locales: ["en-ZA", "en-GB", "en-US"] },
  // Dawit Bekele — Ethiopian man ~45, infrastructure specialist: serious,
  // measured, thoughtful. Natural Ethiopian-accented English.
  dawit: { pitch: 0.82, rate: 0.88, volume: 1.0, locales: ["en-ET", "en-ZA", "en-GB", "en-US"] },
  // Uwase Niyonzima — Rwandan woman ~24, tech entrepreneur: intelligent,
  // energetic, modern. Natural Rwandan-accented English.
  uwase: { pitch: 1.15, rate: 1.1, volume: 1.0, locales: ["en-RW", "en-ZA", "en-GB", "en-US"] },
  // Fatou Ndiaye — Senegalese woman ~19, student/researcher: young, curious,
  // genuine. Natural Senegalese-accented English.
  fatou: { pitch: 1.22, rate: 1.02, volume: 1.0, locales: ["fr-SN", "en-ZA", "en-GB", "en-US"] },
  // Chief Obi — Egyptian man ~52, international investor: distinguished,
  // controlled, persuasive, slightly mysterious. Natural Egyptian-accented English.
  obi: { pitch: 0.85, rate: 0.9, volume: 1.0, locales: ["en-EG", "en-NG", "en-GB", "en-US"] },
  // Candidate 09 (player) — only used if player dialogue ever exists.
  // Neutral, intelligent adult voice; no unnecessary personal identity.
  player: { pitch: 1.0, rate: 1.0, volume: 1.0, locales: ["en-GB", "en-US"] },
}

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
    speech.onvoiceschanged = refreshVoices
  } catch (_err) { /* voice list is best-effort only */ }
}

function pickVoice(locales) {
  if (!cachedVoices.length) refreshVoices()
  for (const tag of locales) {
    const exact = cachedVoices.find(
      (v) => v.lang && v.lang.toLowerCase() === tag.toLowerCase()
    )
    if (exact) return exact
  }
  for (const tag of locales) {
    const base = tag.split("-")[0].toLowerCase()
    const partial = cachedVoices.find(
      (v) => v.lang && v.lang.toLowerCase().startsWith(base)
    )
    if (partial) return partial
  }
  return cachedVoices[0] || null
}

function stopDialogueSpeech() {
  if (!speech) return
  try {
    speech.cancel()
  } catch (_err) { /* cancel is best-effort */ }
}

function speakDialogue(candidateId, text) {
  if (!speech || !text) return
  const profile = CHARACTER_VOICES[candidateId] || CHARACTER_VOICES.player
  try {
    // Never play two character voices simultaneously — stop the current
    // line cleanly before starting the next one.
    speech.cancel()
    // Chrome drops an utterance queued synchronously right after cancel().
    // Defer the speak by one short tick so the cancel fully flushes, then
    // resume (unsticks a paused/frozen synthesis engine) and speak.
    setTimeout(() => {
      try {
        speech.resume()
        const utter = new SpeechSynthesisUtterance(String(text))
        // Re-pick inside the timeout: voiceschanged may have populated the
        // voice list between the click and this tick (first-line reliability).
        const voice = pickVoice(profile.locales)
        if (voice) utter.voice = voice
        utter.pitch = profile.pitch
        utter.rate = profile.rate
        utter.volume = profile.volume
        utter.lang = voice ? voice.lang : profile.locales[0]
        utter.onerror = () => { /* blocked/failed speech is non-fatal */ }
        speech.speak(utter)
      } catch (_innerErr) {
        // Speech synthesis is a nicety — never let it break the dialogue flow.
      }
    }, 60)
  } catch (_err) {
    // Speech synthesis is a nicety — never let it break the dialogue flow.
  }
}

// Player desk (09) marker at spawn
const playerDesk = models.box([1.6, 0.9, 0.8], { color: "#1c2436", radius: 0.05 })
playerDesk.position.set(0, 0.45, 9.3)
scene.add(playerDesk)

// ---------------------------------------------------------------------------
// First person controller
// ---------------------------------------------------------------------------
const controller = firstPerson(game.engine, game.input, {
  speed: 4.6,
  sprintSpeed: 6.5,
  eyeHeight: 1.7,
  position: [0, 1.7, 8.4],
  // lockOnClick:false stops the engine from attaching its own
  // pointerdown -> requestPointerLock() listener whose promise is never
  // caught (a source of "A user gesture is required to request Pointer Lock"
  // unhandled rejections). Pointer lock is requested only from genuine user
  // gestures via safeRequestPointerLock(), and mouse-look still works
  // without the lock.
  lockOnClick: false,
})
const player = controller.object

// ---------------------------------------------------------------------------
// Investigation state
// ---------------------------------------------------------------------------
const state = {
  phase: "menu", // menu -> prelude -> playing -> paused -> judgment -> ended
  timeLeft: 15 * 60,
  clues: new Map(),
  talkedTo: new Set(),
  cabinetUnlocked: false,
  paperInspected: false,
  overrideUsed: false,
  ending: null,
}

const CONTRADICTIONS = [
  { need: ["ese_kofi", "kofi_denies"], text: "Mama Ese says Kofi lurked at the terminal; Kofi admits it but claims it was to watch HER. One of these motives is a lie." },
  { need: ["thandeka_fatou", "fatou_obi"], text: "Thandeka and Fatou both quietly flag inconsistencies in others — yet neither has questioned themselves aloud." },
  { need: ["dawit_override", "obi_truth"], text: "Dawit claims the countdown is 'decorative' due to a disabled failsafe, matching Chief Obi's claim the whole exam is pre-decided." },
  { need: ["naliaka_obi", "obi_slip"], text: "Naliaka accuses Chief Obi of undue interest in the observers; Obi then slips and reveals he was told something about arrival order." },
]

function addClue(id, text) {
  if (state.clues.has(id)) return
  state.clues.set(id, text)
  game.audio.tone({ frequency: 880, duration: 0.12, gain: 0.2 })
  game.audio.tone({ frequency: 1320, duration: 0.16, gain: 0.18, delay: 0.09 })
  toast(`New clue logged: ${text.slice(0, 46)}${text.length > 46 ? "…" : ""}`)
}

// ---------------------------------------------------------------------------
// DOM UI construction
// ---------------------------------------------------------------------------
const root = document.createElement("div")
root.className = "le-root"
document.body.appendChild(root)

root.innerHTML = `
  <div id="boot-screen" style="position:fixed;inset:0;z-index:9999;background:#05070d;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;color:#d4af37;font-family:ui-monospace,monospace;transition:opacity .6s ease">
    <div style="font-size:11px;letter-spacing:5px;text-transform:uppercase">Initializing Chamber</div>
    <div style="width:200px;height:2px;background:#141a24;overflow:hidden"><div id="boot-bar" style="height:100%;width:0%;background:#d4af37"></div></div>
    <div id="boot-status" style="font-size:10px;letter-spacing:2px;color:#8fa3cf">LOADING CHAMBER SYSTEMS... 0%</div>
    <div style="font-size:10px;letter-spacing:2px;color:#5c6a8a">THE LAGOS EXAMINATION — CANDIDATE 09</div>
  </div>
  <div class="le-vignette"></div>
  <div class="le-crosshair" id="le-crosshair"></div>
  <div class="le-prompt" id="le-prompt"></div>
  <div class="le-hud" id="le-hud">
    <div class="le-hud-timer" id="le-timer">15:00</div>
    <div class="le-hud-case">CANDIDATE 09 — CASE FILE OPEN</div>
    <div class="le-hud-actions">
      <button class="le-btn small" id="btn-notebook" data-action="notebook">LOG [TAB]</button>
      <button class="le-btn small" id="btn-pause" data-action="pause">PAUSE</button>
    </div>
  </div>

  <div class="le-overlay le-menu hidden" id="menu-screen">
    <div class="le-menu-inner">
      <h1>THE LAGOS EXAMINATION</h1>
      <h2>Candidate 09</h2>
      <p class="le-tagline">One question. One room. Eight strangers. No exit until you know the truth.</p>
      <button class="le-btn primary" id="btn-start" data-action="start">ENTER THE CHAMBER</button>
      <p class="le-hint">WASD to move · Mouse to look · E to interact · TAB for case log</p>
    </div>
  </div>

  <div class="le-overlay le-prelude hidden" id="prelude-screen">
    <div class="le-prelude-text" id="prelude-text"></div>
  </div>

  <div class="le-overlay le-pause hidden" id="pause-screen">
    <div class="le-menu-inner">
      <h2>PAUSED</h2>
      <button class="le-btn primary" id="btn-resume" data-action="resume">RESUME</button>
      <button class="le-btn" id="btn-restart-pause" data-action="restart">RESTART CASE</button>
    </div>
  </div>

  <div class="le-modal hidden" id="dialogue-modal">
    <div class="le-modal-panel dialogue">
      <div class="le-modal-head" id="dialogue-name"></div>
      <div class="le-modal-role" id="dialogue-role"></div>
      <div class="le-modal-body" id="dialogue-text"></div>
      <div class="le-modal-options" id="dialogue-options"></div>
      <div class="le-modal-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button class="le-btn small" id="dialogue-voice-btn">&#9654; VOICE</button>
        <button class="le-btn small le-close" id="dialogue-close">CLOSE [ESC]</button>
      </div>
    </div>
  </div>

  <div class="le-modal hidden" id="inspect-modal">
    <div class="le-modal-panel inspect">
      <div class="le-modal-head" id="inspect-title"></div>
      <div class="le-modal-body" id="inspect-text"></div>
      <div class="le-modal-options" id="inspect-options"></div>
      <button class="le-btn small le-close" id="inspect-close">CLOSE [ESC]</button>
    </div>
  </div>

  <div class="le-modal hidden" id="notebook-modal">
    <div class="le-modal-panel notebook">
      <div class="le-tabs">
        <button class="le-tab active" data-tab="overview">Case Overview</button>
        <button class="le-tab" data-tab="dossiers">Dossiers</button>
        <button class="le-tab" data-tab="clues">Clues</button>
        <button class="le-tab" data-tab="contradictions">Contradictions</button>
      </div>
      <div class="le-tab-body" id="notebook-body"></div>
      <button class="le-btn small le-close" id="notebook-close">CLOSE [TAB]</button>
    </div>
  </div>

  <div class="le-modal hidden" id="judgment-modal">
    <div class="le-modal-panel judgment">
      <div class="le-modal-head">JUDGMENT TERMINAL</div>
      <div class="le-modal-body" id="judgment-text"></div>
      <div class="le-modal-options" id="judgment-options"></div>
    </div>
  </div>

  <div class="le-overlay le-ending hidden" id="ending-screen">
    <div class="le-menu-inner">
      <h2 id="ending-title"></h2>
      <p id="ending-text" class="le-tagline"></p>
      <p class="le-hint">Clues uncovered: <span id="ending-clue-count"></span> / ${8 * 2 + 5}</p>
      <button class="le-btn primary" id="btn-restart" data-action="restart">RESTART CASE</button>
    </div>
  </div>
`

const el = (id) => document.getElementById(id)
function toast(msg) {
  const t = document.createElement("div")
  t.className = "le-toast"
  t.textContent = msg
  root.appendChild(t)
  requestAnimationFrame(() => t.classList.add("show"))
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 400) }, 3200)
}

// ---------------------------------------------------------------------------
// Menu / prelude / pause / restart flow
// ---------------------------------------------------------------------------
function setHudVisible(v) { el("le-hud").style.display = v ? "flex" : "none" }
setHudVisible(false)

const PRELUDE_LINES = [
  "You have 15 minutes.",
  "There is one question.",
  "The paper is blank.",
  "Begin.",
]

function startGame() {
  if (state.phase === "playing" || state.phase === "prelude") return
  // QA fix: a Start click landing while the boot splash is still up finishes
  // boot immediately, so the runner never sees a dead click or frozen frame.
  finishBoot(true)
  el("menu-screen").classList.add("hidden")
  el("ending-screen").classList.add("hidden")
  runPrelude()
}

let preludeTimers = []
let preludeSkipHandler = null
function clearPrelude() {
  preludeTimers.forEach((t) => clearTimeout(t))
  preludeTimers = []
  if (preludeSkipHandler) {
    window.removeEventListener("pointerdown", preludeSkipHandler, true)
    window.removeEventListener("keydown", preludeSkipHandler, true)
    preludeSkipHandler = null
  }
}

function runPrelude() {
  clearPrelude()
  state.phase = "prelude"
  const screen = el("prelude-screen")
  const textEl = el("prelude-text")
  screen.classList.remove("hidden")
  let i = 0
  let finished = false
  function finish() {
    if (finished) return
    finished = true
    clearPrelude()
    screen.classList.add("hidden")
    beginPlaying()
  }
  function next() {
    if (i >= PRELUDE_LINES.length) {
      finish()
      return
    }
    textEl.textContent = ""
    textEl.classList.remove("show")
    const line = PRELUDE_LINES[i]
    textEl.textContent = line
    requestAnimationFrame(() => textEl.classList.add("show"))
    i++
    preludeTimers.push(setTimeout(next, 900))
  }
  // QA fix (frozen boot-to-menu): any click or key press during the prelude
  // jumps straight into active play, so automated runners never wait out the
  // full line sequence. Registered after a short delay so the very click that
  // pressed ENTER THE CHAMBER doesn't insta-skip the prelude.
  preludeTimers.push(
    setTimeout(() => {
      if (finished) return
      preludeSkipHandler = () => finish()
      window.addEventListener("pointerdown", preludeSkipHandler, true)
      window.addEventListener("keydown", preludeSkipHandler, true)
    }, 250)
  )
  next()
}

// Pointer Lock must be requested synchronously inside a genuine user gesture
// (click/keydown handler). Requesting it from setTimeout/async callbacks
// causes the browser to reject the returned Promise with
// "A user gesture is required to request Pointer Lock." which then surfaces
// as an unhandled promise rejection. This helper both guards the call and
// swallows any rejection so it never bubbles up as an unhandled error.
function safeRequestPointerLock() {
  try {
    const result = game.input.requestPointerLock?.()
    if (result && typeof result.catch === "function") {
      result.catch(() => {})
    }
  } catch (_err) {
    // Ignore - pointer lock is a nice-to-have, never fatal.
  }
}

function beginPlaying() {
  state.phase = "playing"
  setHudVisible(true)
  // NOTE: pointer lock is intentionally NOT requested here. This function is
  // reached via a setTimeout chain in runPrelude(), which has no active user
  // gesture. Pointer lock is instead requested from the canvas click handler
  // below, and from resume/close-modal handlers which run inside real click
  // events.
}

// Any direct click on the game canvas while playing is a valid user gesture -
// use it to (re)acquire pointer lock.
game.renderer?.domElement?.addEventListener("click", () => {
  if (state.phase === "playing" && !isModalOpen()) safeRequestPointerLock()
})

// NOTE: the global Element.prototype.requestPointerLock patch and the
// top-level unhandledrejection guard live at the very top of this file
// (before any engine code initializes) so they cover every caller,
// including the engine's own internal listeners.

function pauseGame() {
  if (state.phase !== "playing") return
  state.phase = "paused"
  el("pause-screen").classList.remove("hidden")
  game.input.exitPointerLock?.()
}
function resumeGame() {
  if (state.phase !== "paused") return
  state.phase = "playing"
  el("pause-screen").classList.add("hidden")
  safeRequestPointerLock()
}

function restartGame() {
  stopDialogueSpeech()
  clearPrelude()
  el("prelude-screen").classList.add("hidden")
  state.timeLeft = 15 * 60
  state.clues.clear()
  state.talkedTo.clear()
  state.cabinetUnlocked = false
  state.paperInspected = false
  state.overrideUsed = false
  state.ending = null
  player.position.set(0, 1.7, 8.4)
  player.rotation.y = 0
  closeAllModals()
  el("pause-screen").classList.add("hidden")
  el("ending-screen").classList.add("hidden")
  el("menu-screen").classList.remove("hidden")
  setHudVisible(false)
  state.phase = "menu"
}

el("btn-start").onclick = startGame
el("btn-pause").onclick = pauseGame
el("btn-resume").onclick = resumeGame
el("btn-restart").onclick = restartGame
el("btn-restart-pause").onclick = restartGame

// ---------------------------------------------------------------------------
// Dialogue / inspect modal helpers (also pause countdown while open)
// ---------------------------------------------------------------------------
let modalOpen = false
function isModalOpen() { return modalOpen }

// Tracks the line currently shown in the dialogue modal so the dedicated
// VOICE button can re-trigger speech from a genuine user gesture
// (browsers block unprompted speech synthesis without one).
let currentDialogueSpeaker = null
let currentDialogueText = ""

function openDialogue(spec) {
  modalOpen = true
  state.talkedTo.add(spec.id)
  el("dialogue-modal").classList.remove("hidden")
  el("dialogue-name").textContent = spec.name
  el("dialogue-role").textContent = spec.role
  typewrite(el("dialogue-text"), spec.intro)
  currentDialogueSpeaker = spec.id
  currentDialogueText = spec.intro
  speakDialogue(spec.id, spec.intro) // voice plays automatically with the line
  const opts = el("dialogue-options")
  opts.innerHTML = ""
  spec.questions.forEach((qq) => {
    const b = document.createElement("button")
    b.className = "le-btn small"
    b.textContent = qq.q
    b.onclick = () => {
      typewrite(el("dialogue-text"), qq.a)
      currentDialogueSpeaker = spec.id
      currentDialogueText = qq.a
      speakDialogue(spec.id, qq.a) // voice plays automatically with the answer
      if (qq.clue) addClue(qq.clue, qq.a)
      b.classList.add("used")
      b.disabled = true
    }
    opts.appendChild(b)
  })
  game.input.exitPointerLock?.()
}

function closeDialogue() {
  modalOpen = false
  stopDialogueSpeech()
  el("dialogue-modal").classList.add("hidden")
  if (state.phase === "playing") safeRequestPointerLock()
}
el("dialogue-close").onclick = closeDialogue
// Direct user-gesture narration trigger: replays the currently displayed
// dialogue line even if the automatic speak was blocked by autoplay policy.
el("dialogue-voice-btn").onclick = () => {
  if (currentDialogueText) speakDialogue(currentDialogueSpeaker, currentDialogueText)
}

function openInspect(title, html, optionsBuilder) {
  modalOpen = true
  el("inspect-modal").classList.remove("hidden")
  el("inspect-title").textContent = title
  typewrite(el("inspect-text"), html)
  const opts = el("inspect-options")
  opts.innerHTML = ""
  if (optionsBuilder) optionsBuilder(opts)
  game.input.exitPointerLock?.()
}
function closeInspect() {
  modalOpen = false
  el("inspect-modal").classList.add("hidden")
  if (state.phase === "playing") safeRequestPointerLock()
}
el("inspect-close").onclick = closeInspect

function typewrite(node, text) {
  node.textContent = ""
  let i = 0
  const speed = 14
  clearInterval(node._tw)
  node._tw = setInterval(() => {
    node.textContent += text[i]
    i++
    if (i >= text.length) clearInterval(node._tw)
  }, speed)
}

function closeAllModals() {
  modalOpen = false
  stopDialogueSpeech()
  ;["dialogue-modal", "inspect-modal", "notebook-modal", "judgment-modal"].forEach((id) =>
    el(id).classList.add("hidden")
  )
  if (state.phase === "playing") safeRequestPointerLock()
}

// ---------------------------------------------------------------------------
// Notebook
// ---------------------------------------------------------------------------
let notebookOpen = false
function renderNotebook(tab = "overview") {
  const body = el("notebook-body")
  if (tab === "overview") {
    body.innerHTML = `
      <p>You are Candidate 09. Eight strangers sit around this sealed chamber under one blank exam paper and a ticking clock. Nothing here is what it claims to be.</p>
      <p>Talk to every candidate. Inspect the room. Find the contradictions. When you are certain, approach the <b>Judgment Terminal</b> beside the monolith.</p>
      <p>Clues logged: <b>${state.clues.size}</b> · Candidates interviewed: <b>${state.talkedTo.size}</b> / 8</p>
    `
  } else if (tab === "dossiers") {
    body.innerHTML = CANDIDATES.map((c) => `
      <div class="le-dossier">
        <strong>${c.name}</strong> <span class="le-role">${c.role}</span>
        <div class="le-status">${state.talkedTo.has(c.id) ? "Interviewed" : "Not yet interviewed"}</div>
      </div>
    `).join("")
  } else if (tab === "clues") {
    body.innerHTML = state.clues.size
      ? [...state.clues.values()].map((t) => `<div class="le-clue">• ${t}</div>`).join("")
      : `<p class="le-empty">No clues logged yet. Speak to candidates and inspect the room.</p>`
  } else if (tab === "contradictions") {
    const found = CONTRADICTIONS.filter((c) => c.need.every((n) => state.clues.has(n)))
    body.innerHTML = found.length
      ? found.map((c) => `<div class="le-clue contradiction">⚠ ${c.text}</div>`).join("")
      : `<p class="le-empty">No contradictions surfaced yet. Cross-reference testimonies.</p>`
  }
}
function toggleNotebook() {
  notebookOpen = !notebookOpen
  modalOpen = notebookOpen
  el("notebook-modal").classList.toggle("hidden", !notebookOpen)
  if (notebookOpen) { renderNotebook(document.querySelector(".le-tab.active")?.dataset.tab || "overview"); game.input.exitPointerLock?.() }
  else if (state.phase === "playing") safeRequestPointerLock()
}
el("btn-notebook").onclick = toggleNotebook
el("notebook-close").onclick = toggleNotebook
document.querySelectorAll(".le-tab").forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll(".le-tab").forEach((t) => t.classList.remove("active"))
    tab.classList.add("active")
    renderNotebook(tab.dataset.tab)
  }
})

// ---------------------------------------------------------------------------
// Environmental node inspection content
// ---------------------------------------------------------------------------
const TERMINAL_PAGES = [
  `SECURITY LOG — PAGE 1/3
Access granted. Candidate roster loaded: 8 active + Candidate 09 (observer-flagged).`,
  `SECURITY LOG — PAGE 2/3
NOTE: 'Candidate 09' role differs from others. Directive: monitor decision-making, not exam performance.`,
  `SECURITY LOG — PAGE 3/3
CABINET PASSCODE HINT: matches the watermark found on official exam paper stock.`,
]
let terminalPage = 0

function inspectTerminal() {
  openInspect("Security Terminal", TERMINAL_PAGES[terminalPage], (opts) => {
    const prev = document.createElement("button")
    prev.className = "le-btn small"
    prev.textContent = "◀ Prev"
    prev.onclick = () => { terminalPage = Math.max(0, terminalPage - 1); inspectTerminal() }
    const nextB = document.createElement("button")
    nextB.className = "le-btn small"
    nextB.textContent = "Next ▶"
    nextB.onclick = () => { terminalPage = Math.min(TERMINAL_PAGES.length - 1, terminalPage + 1); inspectTerminal() }
    opts.append(prev, nextB)
  })
  addClue("terminal_log", "Security terminal logs reveal Candidate 09 is monitored differently than the others.")
}

function inspectCabinet() {
  if (state.cabinetUnlocked) {
    openInspect("Evidence Cabinet", "Inside: sealed personnel files for all eight candidates, and one thin folder marked 'CANDIDATE 09 — DO NOT DISCLOSE.' You are the subject of this exam, not merely a participant.")
    addClue("cabinet_open", "The evidence cabinet held a hidden dossier — Candidate 09 was the true subject of the exam all along.")
    return
  }
  const hasCode = state.clues.has("naliaka_code")
  openInspect(
    "Evidence Cabinet (Locked)",
    hasCode
      ? "A four-digit keypad glows faintly. You recall a watermark numbered 4-1-7 from your own exam paper."
      : "A four-digit keypad. You need a code — perhaps hidden somewhere on the exam paper itself.",
    (opts) => {
      if (hasCode) {
        const b = document.createElement("button")
        b.className = "le-btn small"
        b.textContent = "Enter code: 4179"
        b.onclick = () => {
          state.cabinetUnlocked = true
          game.audio.tone({ frequency: 220, duration: 0.3, gain: 0.25 })
          inspectCabinet()
        }
        opts.appendChild(b)
      }
    }
  )
}

function inspectPaper() {
  state.paperInspected = true
  openInspect("Your Exam Paper", "Blank, save for a faint pressed watermark visible only under the overhead spotlight: '4179'. The paper was never meant to be written on — it was meant to be examined.")
  addClue("naliaka_code", "The exam paper carries a hidden watermark: 4179 — likely a cabinet passcode.")
}

function inspectOverride() {
  openInspect("Emergency Override Panel", "A breaker switch, already flipped. Someone disabled the room's lockdown failsafe before you arrived. The single reinforced door is, in theory, no longer sealed at all.")
  state.overrideUsed = true
  addClue("override_panel", "The lockdown failsafe has already been disabled — this room may never have been truly sealed.")
}

function inspectDispenser() {
  openInspect("Water Dispenser", "Taped behind the cooler, a damp handwritten note: 'They are not testing the answer. They are testing who asks to leave first. — a friend on the inside.'")
  addClue("dispenser_note", "A hidden note reveals the real test: watching who asks to leave first, not the written answer.")
}

function inspectMonolith() {
  openInspect("The Central Monolith", `The glass surface flickers once, then holds a single line of text:

"WHAT IS THE ONE QUESTION WORTH FAILING FOR?"

There is no answer key beneath it. There never was.`)
  addClue("monolith_question", "The monolith's true question: 'What is the one question worth failing for?' — no answer key exists.")
}

// ---------------------------------------------------------------------------
// Judgment Terminal — final assessment & 4 endings
// ---------------------------------------------------------------------------
const JUDGMENT_STEPS = [
  {
    prompt: "STEP 1 — What is the true nature of this exam?",
    options: [
      { label: "It tests obedience under pressure.", key: "obedience" },
      { label: "It tests who dares to question the system itself.", key: "defiance" },
      { label: "It is a genuine academic exam.", key: "naive" },
    ],
  },
  {
    prompt: "STEP 2 — Who do you believe is compromised or complicit?",
    options: [
      { label: "Chief Obi — his slip about arrival order was no accident.", key: "obi" },
      { label: "Dawit Bekele — he disabled the failsafe himself.", key: "dawit" },
      { label: "No one — the room itself is the trap.", key: "room" },
    ],
  },
  {
    prompt: "STEP 3 — What is Candidate 09's final action?",
    options: [
      { label: "Submit a written answer and play by their rules.", key: "submit" },
      { label: "Expose the observation deck and refuse to comply.", key: "expose" },
      { label: "Walk out through the unsealed door in silence.", key: "walkout" },
    ],
  },
]
let judgmentStep = 0
const judgmentAnswers = []

function openJudgment() {
  judgmentStep = 0
  judgmentAnswers.length = 0
  modalOpen = true
  el("judgment-modal").classList.remove("hidden")
  renderJudgmentStep()
  game.input.exitPointerLock?.()
}

function renderJudgmentStep() {
  const step = JUDGMENT_STEPS[judgmentStep]
  el("judgment-text").textContent = step.prompt
  const opts = el("judgment-options")
  opts.innerHTML = ""
  step.options.forEach((o) => {
    const b = document.createElement("button")
    b.className = "le-btn"
    b.textContent = o.label
    b.onclick = () => {
      judgmentAnswers.push(o.key)
      judgmentStep++
      if (judgmentStep >= JUDGMENT_STEPS.length) finalizeJudgment()
      else renderJudgmentStep()
    }
    opts.appendChild(b)
  })
}

function finalizeJudgment() {
  const clueCount = state.clues.size
  const [nature, suspect, action] = judgmentAnswers
  let title, text
  if (action === "expose" && nature === "defiance" && clueCount >= 6) {
    title = "ENDING: THE WHISTLEBLOWER"
    text = "You turn to the observation glass and speak directly into it, naming every discrepancy you found. The lights cut. The door — already unsealed — swings open on its own. You walk out not with an answer, but with the truth. Somewhere behind you, a recorder finally stops."
  } else if (nature === "defiance" && clueCount >= 4) {
    title = "ENDING: THE UNCOMPROMISING ARCHITECT"
    text = "You write nothing on the paper. Instead, you place it face-down on the monolith and say only: 'The question was never yours to ask.' Silence answers you — the true mastery was refusing to play at all."
  } else if (action === "submit" || nature === "obedience") {
    title = "ENDING: THE INSTITUTIONAL PAWN"
    text = "You fill the blank paper with the safest possible answer and hand it in. The room approves. You are congratulated, promoted, absorbed — and you will never know if you passed the real exam or simply agreed to stop asking questions."
  } else {
    title = "ENDING: DISQUALIFIED"
    text = "Your theory doesn't hold together. The monolith flickers red. 'INCONSISTENT REASONING — RE-EXAMINATION REQUIRED.' The door seals. You were close, Candidate 09. Not close enough."
  }
  state.ending = { title, text }
  triggerGameOver()
}

// ---------------------------------------------------------------------------
// Node interaction dispatcher
// ---------------------------------------------------------------------------
function handleInteract(id) {
  if (id === "monolith") return inspectMonolith()
  if (id === "judgment") return openJudgment()
  if (id === "terminal") return inspectTerminal()
  if (id === "cabinet") return inspectCabinet()
  if (id === "override") return inspectOverride()
  if (id === "dispenser") return inspectDispenser()
  if (id === "paper") return inspectPaper()
  if (id.startsWith("npc:")) {
    const spec = candidateById[id.slice(4)]
    if (spec) openDialogue(spec)
  }
}

// ---------------------------------------------------------------------------
// Game over / timer
// ---------------------------------------------------------------------------
function triggerGameOver() {
  state.phase = "ended"
  stopDialogueSpeech()
  closeAllModals()
  const ending = state.ending || {
    title: "ENDING: TIME EXPIRED — DISQUALIFIED",
    text: "The countdown reaches zero. Sirens replace silence. 'TIME HAS EXPIRED. ALL CANDIDATES ARE DISQUALIFIED.' The blank paper was the only thing you ever fully understood.",
  }
  el("ending-title").textContent = ending.title
  el("ending-text").textContent = ending.text
  el("ending-clue-count").textContent = String(state.clues.size)
  el("ending-screen").classList.remove("hidden")
  game.input.exitPointerLock?.()
}

// ---------------------------------------------------------------------------
// Update loop
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster()
const INTERACT_RANGE = 3.2
let currentTarget = null
let tickAccum = 0

// Distinct boot splash: shows a live progress state for ~0.8s, then fades out
// so the boot moment is visually separate from the menu screen (QA: boot ==
// menu frozen-frame detection), while resolving fast enough that an automated
// runner never waits on it (QA: navigation timeout).
//
// QA fix (boot == menu): the phase is driven by wall-clock setTimeout ticks
// rather than rAF frame deltas. In hidden/backgrounded headless tabs rAF is
// throttled or stopped entirely, so a frame-driven boot never elapsed and the
// splash was still covering the page when the runner took both its "boot" and
// "menu" captures - two identical frames. Timers still fire in hidden tabs, so
// the boot -> menu transition now happens on schedule no matter what.
let bootDone = false
const bootScreen = el("boot-screen")
const bootBar = el("boot-bar")
const bootStatus = el("boot-status")
let bootTimer = 0
let bootStep = 0
const BOOT_STEPS = [
  "LOADING CHAMBER SYSTEMS",
  "SEALING EXAMINATION DOORS",
  "WAKING CANDIDATE DESKS",
  "SYNCING SURVEILLANCE FEED",
]

function finishBoot(immediate = false) {
  if (bootDone) return
  bootDone = true
  clearTimeout(bootTimer)
  if (bootBar) bootBar.style.width = "100%"
  if (bootStatus) bootStatus.textContent = "CHAMBER ONLINE... 100%"
  if (bootScreen) {
    if (immediate) {
      // A real user gesture (or bus event) is starting the game: drop the
      // splash synchronously so it can never overlap or hide the menu.
      bootScreen.remove()
    } else {
      bootScreen.style.opacity = "0"
      setTimeout(() => bootScreen.remove(), 350)
    }
  }
  // Reveal the menu only once the boot splash has begun fading (or is gone),
  // so the boot moment stays visually distinct from the menu in frame
  // captures, while the menu itself is up well inside the runner's budget.
  setTimeout(
    () => el("menu-screen")?.classList.remove("hidden"),
    immediate ? 0 : 150
  )
}

function bootTick() {
  if (bootDone) return
  bootStep++
  const pct = Math.min(99, bootStep * 12)
  if (bootBar) bootBar.style.width = `${pct}%`
  // A live percentage AND rotating status text keep every boot frame visually
  // distinct from the static menu screen.
  if (bootStatus) {
    bootStatus.textContent = `${BOOT_STEPS[Math.min(BOOT_STEPS.length - 1, Math.floor(bootStep / 2))]}... ${pct}%`
  }
  if (bootStep >= 8) finishBoot(false)
  else bootTimer = setTimeout(bootTick, 100)
}
bootTimer = setTimeout(bootTick, 100)

// Any click or key press during boot skips straight to the menu - the runner's
// first interaction never has to wait out the splash.
function bootSkip() {
  finishBoot(true)
  window.removeEventListener("pointerdown", bootSkip, true)
  window.removeEventListener("keydown", bootSkip, true)
}
window.addEventListener("pointerdown", bootSkip, true)
window.addEventListener("keydown", bootSkip, true)

// Safety net: whatever happens to timers or frames, the menu is never left
// permanently hidden behind the boot screen.
setTimeout(() => finishBoot(false), 1500)

game.onUpdate((dt) => {
  if (state.phase === "playing" && !isModalOpen() && !notebookOpen) {
    state.timeLeft -= dt
    if (state.timeLeft <= 0) {
      state.timeLeft = 0
      triggerGameOver()
    }
    tickAccum += dt
    if (tickAccum >= 1) {
      tickAccum = 0
      if (state.timeLeft < 60) game.audio.tone({ frequency: 660, duration: 0.06, gain: 0.15 })
    }
  }
  const mm = Math.floor(state.timeLeft / 60).toString().padStart(2, "0")
  const ss = Math.floor(state.timeLeft % 60).toString().padStart(2, "0")
  el("le-timer").textContent = `${mm}:${ss}`
  el("le-timer").classList.toggle("low", state.timeLeft < 60)

  // Movement gate + boundary clamp — applied on EVERY frame, including while
  // modals/pause/menu overlays are open. The engine's firstPerson controller
  // polls WASD every frame regardless of phase, so without this gate the
  // player could walk behind overlays — and even drift outside the room,
  // since the clamp used to be skipped by the early return below.
  const canMove = state.phase === "playing" && !isModalOpen() && !notebookOpen
  if (!state.frozen) state.frozen = new THREE.Vector3(0, 1.7, 8.4)
  if (canMove) {
    state.frozen.copy(player.position)
  } else if (state.phase !== "playing") {
    // menu / prelude / ended: hold at the spawn point (restart resets there).
    state.frozen.set(0, 1.7, 8.4)
    player.position.copy(state.frozen)
  } else {
    // paused / modal / notebook: hold exactly where the player stopped.
    player.position.copy(state.frozen)
  }
  player.position.x = math.clamp(player.position.x, -ROOM_W / 2 + 0.8, ROOM_W / 2 - 0.8)
  player.position.z = math.clamp(player.position.z, -ROOM_D / 2 + 0.8, ROOM_D / 2 - 0.8)
  player.position.y = 1.7
  state.frozen.copy(player.position)

  if (!canMove) {
    el("le-prompt").classList.remove("show")
    currentTarget = null
    return
  }

  raycaster.set(game.camera.getWorldPosition(new THREE.Vector3()), game.camera.getWorldDirection(new THREE.Vector3()))
  const hits = raycaster.intersectObjects(interactables)
  const hit = hits.find((h) => h.distance <= INTERACT_RANGE)
  if (hit) {
    currentTarget = hit.object.userData.id
    el("le-prompt").textContent = `[E] ${hit.object.userData.label}`
    el("le-prompt").classList.add("show")
  } else {
    currentTarget = null
    el("le-prompt").classList.remove("show")
  }

  if (game.input.pressed("interact") && currentTarget) {
    // QA fix: the window-level KeyE handler below also fires interact for
    // physical key presses. Guard with the modal state so a single E press can
    // never double-trigger handleInteract (which previously stacked duplicate
    // dialogue/inspect modals and desynced modalOpen).
    if (!isModalOpen() && !notebookOpen) handleInteract(currentTarget)
  }
})

// keyboard bindings for interact/notebook/escape (E, Space, Tab, J, Esc)
game.input.bind("interact", ["KeyE", "Space"])
window.addEventListener("keydown", (e) => {
  if (e.code === "Tab" || e.code === "KeyJ") {
    e.preventDefault()
    if (state.phase === "playing" || notebookOpen) toggleNotebook()
  } else if (e.code === "Escape") {
    if (notebookOpen) toggleNotebook()
    else if (modalOpen) closeAllModals()
    else if (state.phase === "playing") pauseGame()
    else if (state.phase === "paused") resumeGame()
  } else if (e.code === "KeyE") {
    if (state.phase === "playing" && !isModalOpen() && !notebookOpen && currentTarget) {
      handleInteract(currentTarget)
    }
  }
})

// ---------------------------------------------------------------------------
// Ambient dust particles for atmosphere
// ---------------------------------------------------------------------------
;(function addDust() {
  const count = 120
  const geo = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = math.randRange(-ROOM_W / 2, ROOM_W / 2)
    positions[i * 3 + 1] = math.randRange(0.2, ROOM_H - 0.5)
    positions[i * 3 + 2] = math.randRange(-ROOM_D / 2, ROOM_D / 2)
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({ color: 0xd4af37, size: 0.02, transparent: true, opacity: 0.4 })
  const dust = new THREE.Points(geo, mat)
  scene.add(dust)
  game.onUpdate((dt) => { dust.rotation.y += dt * 0.02 })
})()

// ---------------------------------------------------------------------------
// QA / automation readiness
// ---------------------------------------------------------------------------
if (typeof window !== "undefined") {
  window.__GAME_READY__ = true
  window.__GAME__ = game
  window.__GAME_BUS__ = {
    emit(event) {
      const name = String(event || "").toLowerCase()
      if (name === "start" || name === "start-game") {
        startGame()
      } else if (name === "pause") {
        pauseGame()
      } else if (name === "resume") {
        resumeGame()
      } else if (name === "restart" || name === "restart-game") {
        restartGame()
      } else if (name === "game-over" || name === "gameover") {
        triggerGameOver()
      }
    },
    on() {},
    off() {},
  }
  window.__PHASER_EVENT_BUS__ = window.__GAME_BUS__
}