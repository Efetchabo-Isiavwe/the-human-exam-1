// Runtime-only audio polish for THE LAGOS EXAMINATION.
// Keeps the existing game/audio architecture intact.

const MALE_HINTS = [
  " male", " man", "david", "daniel", "george", "james", "john", "mark",
  "michael", "richard", "thomas", "alex", "ryan", "guy", "microsoft david",
  "microsoft mark", "google uk english male", "google us english male",
]
const FEMALE_HINTS = [
  " female", " woman", "zira", "aria", "emma", "susan", "samantha", "jenny",
  "hazel", "sophie", "clara", "libby", "microsoft zira", "microsoft aria",
  "google uk english female", "google us english female",
]

function voiceMatchesGender(voice, gender) {
  const hay = `${voice?.name || ""} ${voice?.lang || ""}`.toLowerCase()
  const hints = gender === "female" ? FEMALE_HINTS : MALE_HINTS
  return hints.some((hint) => hay.includes(hint))
}

function detectGenderFromSpeaker(name) {
  const n = String(name || "").toLowerCase()
  if (["kofi mensah", "dawit bekeke", "dawit bekle", "dawit bekuele", "karim el-masry", "chief obi"].some((x) => n.includes(x))) return "male"
  if (["mama ese okiemute", "dr. naliaka wekesa", "thandeka maseko", "uwase niyonzima", "fatou ndiaye"].some((x) => n.includes(x))) return "female"
  return null
}

function findGenderedVoice(voices, gender, preferredLang) {
  const usable = Array.from(voices || [])
  if (!usable.length || !gender) return null

  const langBase = String(preferredLang || "en").toLowerCase().split("-")[0]
  const sameLanguage = usable.filter((v) => String(v.lang || "").toLowerCase().startsWith(langBase))
  const pools = [sameLanguage, usable]

  for (const pool of pools) {
    const hinted = pool.find((v) => voiceMatchesGender(v, gender))
    if (hinted) return hinted
  }
  return null
}

export function installAudioAtmosphere() {
  let started = false
  let ambientTimer = null

  function startAmbient() {
    if (started) return
    const game = window.__GAME__
    if (!game?.audio) return

    started = true
    const audio = game.audio
    audio.unlock()

    const playBed = () => {
      if (!game.audio || game.audio.muted) return
      // Low electrical/HVAC hum. Very quiet so it never competes with speech.
      audio.tone({ frequency: 54, type: "sine", duration: 2.3, gain: 0.018 })
      audio.tone({ frequency: 108, type: "sine", duration: 1.9, gain: 0.008, delay: 0.25 })
      // Soft filtered room/equipment air noise.
      audio.noise({ duration: 1.2, frequency: 220, type: "lowpass", gain: 0.012, Q: 0.7, delay: 0.4 })
    }

    playBed()
    ambientTimer = window.setInterval(playBed, 2200)
  }

  const gesture = () => startAmbient()
  for (const event of ["pointerdown", "keydown", "touchstart"]) {
    window.addEventListener(event, gesture, { passive: true })
  }

  // The game's own dialogue box uses Web Speech Synthesis. At speak time,
  // inspect the visible speaker name and prefer a voice whose name strongly
  // indicates the correct gender. This avoids the browser's arbitrary first
  // English voice selection without changing dialogue text.
  const synth = window.speechSynthesis
  if (synth && typeof synth.speak === "function") {
    const nativeSpeak = synth.speak.bind(synth)
    synth.speak = function (utterance) {
      try {
        const nameEl = document.getElementById("dialogue-name")
        const speaker = nameEl?.textContent || ""
        const gender = detectGenderFromSpeaker(speaker)
        if (gender && utterance) {
          const voices = synth.getVoices ? synth.getVoices() : []
          const replacement = findGenderedVoice(voices, gender, utterance.lang)
          if (replacement) utterance.voice = replacement
        }
      } catch (_err) {
        // Never let the optional voice correction break dialogue.
      }
      return nativeSpeak(utterance)
    }
  }

  // Runtime-only name cleanup. This keeps the visible UI consistent even
  // while the underlying candidate id remains legacy-compatible.
  const replaceLegacyNames = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const replacements = []
    let node
    while ((node = walker.nextNode())) {
      if (node.nodeValue?.includes("Chief Obi")) replacements.push(node)
    }
    for (const textNode of replacements) {
      textNode.nodeValue = textNode.nodeValue.replace(/Chief Obi/g, "Karim El-Masry")
    }
  }

  const observer = new MutationObserver(replaceLegacyNames)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  replaceLegacyNames()

  window.addEventListener("beforeunload", () => {
    if (ambientTimer) window.clearInterval(ambientTimer)
    observer.disconnect()
  }, { once: true })
}

installAudioAtmosphere()
