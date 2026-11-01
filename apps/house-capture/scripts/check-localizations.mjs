import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const swiftRoot = path.join(root, "HouseCapture")
const catalogPath = path.join(swiftRoot, "Localizable.xcstrings")
const excluded = new Set([
  "Diagnostics.swift",
  "PreviewDebug.swift",
  "SelfTest.swift",
  "ScanBundle.swift",
  "Coverage.swift",
  "CoverageEngine.swift",
  "CameraControl.swift",
  "PhotoTextures.swift",
  "VertexColorBaker.swift",
  "ScanView.swift",
])
const sameTranslation = new Set([
  "3D Model Anything",
  "RoomPlan",
  "LiDAR",
  "iPhone",
  "iPad",
  "AirDrop",
  "OK",
  "3D",
])
const unitWords = new Set(["m", "cm", "fps", "MB", "s", "k", "M", "PLY", "ZIP", "GB", "TB"])
const ignoreExact = new Set([
  "Español (México)",
  "English (US)",
  "yyyy-MM-dd HH.mm.ss",
  "format binary_little_endian",
  "ARKit session interrupted",
  "ARKit session interruption ended",
  "relocalized but the live mesh didn't match the saved one",
  "not verified: no saved mesh in this zone",
  "relocalization not finished",
  "extending (saved before ARKit finished mapping: may relocalize less reliably)",
])

const problems = []

function stripComments(source) {
  let out = ""
  let i = 0
  while (i < source.length) {
    const c = source[i]
    const n = source[i + 1]
    if (c === "/" && n === "/") {
      while (i < source.length && source[i] !== "\n") i++
      continue
    }
    if (c === "/" && n === "*") {
      i += 2
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++
      i += 2
      continue
    }
    if (c === "\"") {
      out += c
      i++
      while (i < source.length) {
        if (source[i] === "\\") {
          out += source[i] + (source[i + 1] ?? "")
          i += 2
          continue
        }
        out += source[i]
        if (source[i] === "\"") {
          i++
          break
        }
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}

function stringLiterals(source) {
  const found = []
  let i = 0
  let line = 1
  while (i < source.length) {
    if (source[i] === "\n") line++
    if (source[i] !== "\"") {
      i++
      continue
    }
    const startLine = line
    i++
    let text = ""
    let interpolated = false
    while (i < source.length) {
      if (source[i] === "\n") line++
      if (source[i] === "\\") {
        const next = source[i + 1]
        if (next === "(") {
          interpolated = true
          text += "\\("
          i += 2
          let depth = 1
          while (i < source.length && depth > 0) {
            if (source[i] === "\n") line++
            if (source[i] === "(") depth++
            else if (source[i] === ")") depth--
            i++
          }
          continue
        }
        const map = { n: "\n", t: "\t", r: "\r", "\"": "\"", "\\": "\\" }
        text += map[next] ?? next ?? ""
        i += 2
        continue
      }
      if (source[i] === "\"") {
        i++
        break
      }
      text += source[i]
      i++
    }
    found.push({ text, interpolated, line: startLine })
  }
  return found
}

function words(text) {
  const stripped = text.replace(/%%/g, " ").replace(/%(?:\d+\$)?[-+#0 ]*(?:\d+|\*)?(?:\.(?:\d+|\*))?(?:hh|h|ll|l|L|z|t|j)?[diuoxXfFeEgGaAcsp@]/g, " ")
  return stripped.match(/[A-Za-z]+/g) ?? []
}

function sentenceLike(text) {
  return /\s/.test(text) && words(text).some((word) => word.length >= 4)
}

function symbolOnly(text) {
  const list = words(text)
  return list.length > 0 && list.every((word) => unitWords.has(word))
}

function lineAt(source, index) {
  return source.slice(source.lastIndexOf("\n", index) + 1, source.indexOf("\n", index) === -1 ? source.length : source.indexOf("\n", index))
}

function skipLiteral(source, index, text) {
  const line = lineAt(source, index)
  if (line.includes(".log(") || line.includes("recordFailure") || line.includes("print(")) return true
  if (text.includes("#pragma") || text.includes("_geometry") || text.includes("_surface") || text.includes("scn_frame") || text.includes("end_header")) return true
  if (text.includes("binary_little_endian") || text.startsWith("element vertex")) return true
  if (ignoreExact.has(text) || text.includes("yyyy")) return true
  return false
}

function keysIn(source, file) {
  const keys = new Set()
  let match
  const quoted = /(?<![A-Za-z0-9_])(?:L|Lf)\(\s*"((?:\\.|[^"\\])*)"/g
  while ((match = quoted.exec(source))) keys.add(unescape(match[1]))
  const plural = /Lp\(\s*[^,\n]+,\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"/g
  while ((match = plural.exec(source))) {
    keys.add(unescape(match[1]))
    keys.add(unescape(match[2]))
  }
  const eyebrow = /FieldworkEyebrow\(\s*text:\s*"((?:\\.|[^"\\])*)"/g
  while ((match = eyebrow.exec(source))) keys.add(unescape(match[1]))
  const suggestions = source.match(/roomSuggestions = \[([\s\S]*?)\]/)
  if (suggestions) {
    for (const item of stringLiterals(suggestions[1])) if (!item.interpolated) keys.add(item.text)
  }
  const direct = /(?<![A-Za-z0-9_])(Text|Button|Label|Section|Toggle|Picker|Link|TextField|navigationTitle|alert|confirmationDialog|ContentUnavailableView|ProgressView|Menu|accessibilityLabel|accessibilityHint)\s*\(\s*"((?:\\.|[^"\\])*)"/g
  while ((match = direct.exec(source))) {
    const body = unescape(match[2])
    if (!body) continue
    const staticWords = body.replace(/\\\([\s\S]*$/, "")
    if (body.includes("\\(") && sentenceLike(staticWords) && !/\\\(\s*(?:L|Lf|Lp)\s*\(/.test(body)) {
      problems.push(`${file} interpolated UI string ${JSON.stringify(body)}`)
    } else if (!body.includes("\\(")) keys.add(body)
  }
  const literals = stringLiterals(source)
  let searchFrom = 0
  for (const item of literals) {
    const needle = `"${item.text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    const index = source.indexOf(needle, searchFrom)
    if (index < 0) continue
    searchFrom = index + needle.length
    if (item.interpolated || skipLiteral(source, index, item.text)) continue
    if (item.text && sentenceLike(item.text)) keys.add(item.text)
  }
  return keys
}

function unescape(text) {
  return text.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, "\"").replace(/\\\\/g, "\\")
}

const required = new Set()
for (const name of fs.readdirSync(swiftRoot)) {
  if (!name.endsWith(".swift") || excluded.has(name)) continue
  const source = stripComments(fs.readFileSync(path.join(swiftRoot, name), "utf8"))
  if (source.includes('== 1 ? "" : "s"') || source.includes(': "es"')) {
    problems.push(`${name} still builds an English plural suffix`)
  }
  for (const key of keysIn(source, name)) required.add(key)
}

const infoEs = path.join(swiftRoot, "es-MX.lproj", "InfoPlist.strings")
const infoEn = path.join(swiftRoot, "en-US.lproj", "InfoPlist.strings")
for (const file of [infoEs, infoEn]) {
  if (!fs.existsSync(file)) problems.push(`missing ${path.relative(root, file)}`)
}
if (fs.existsSync(infoEs)) {
  const text = fs.readFileSync(infoEs, "utf8")
  if (!text.includes("NSCameraUsageDescription")) problems.push("es-MX InfoPlist missing camera usage")
  if (!text.includes("CFBundleDisplayName")) problems.push("es-MX InfoPlist missing display name")
  if (!text.includes("3D Model Anything usa la cámara y el escáner LiDAR para medir tus cuartos y tomar fotos de referencia.")) {
    problems.push("es-MX camera usage is not the locked sentence")
  }
  if (!text.includes('"3D Model Anything"')) problems.push("es-MX display name changed")
}
for (const [file, count] of [["Support.json", 9], ["PrivacyPolicy.json", 7]]) {
  const es = path.join(swiftRoot, "es-MX.lproj", file)
  const en = path.join(swiftRoot, "en-US.lproj", file)
  const base = path.join(swiftRoot, file)
  if (!fs.existsSync(es) || !fs.existsSync(en)) {
    problems.push(`missing localized ${file}`)
    continue
  }
  const baseJson = JSON.parse(fs.readFileSync(base, "utf8"))
  const enJson = JSON.parse(fs.readFileSync(en, "utf8"))
  const esJson = JSON.parse(fs.readFileSync(es, "utf8"))
  if (JSON.stringify(enJson) !== JSON.stringify(baseJson)) problems.push(`en-US ${file} differs from the English root`)
  if (esJson.sections.length !== count) problems.push(`${file} section count is ${esJson.sections.length}`)
  if (esJson.updated !== "7 de octubre de 2026") problems.push(`${file} updated date is not 7 de octubre de 2026`)
  const blob = JSON.stringify(esJson)
  if (/\b(vosotros|vosotras|tenéis|sois|estáis|hacéis)\b/i.test(blob)) problems.push(`${file} uses vosotros`)
}
const supportPath = path.join(swiftRoot, "es-MX.lproj", "Support.json")
const privacyPath = path.join(swiftRoot, "es-MX.lproj", "PrivacyPolicy.json")
if (fs.existsSync(supportPath) && fs.existsSync(privacyPath)) {
  const support = JSON.parse(fs.readFileSync(supportPath, "utf8"))
  const privacy = JSON.parse(fs.readFileSync(privacyPath, "utf8"))
  if (support.title !== "Ayuda y soporte") problems.push("support title")
  if (privacy.title !== "Política de privacidad") problems.push("privacy title")
}

let catalog = null
if (!fs.existsSync(catalogPath)) problems.push("missing Localizable.xcstrings")
else catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"))

if (catalog) {
  if (catalog.sourceLanguage !== "en") problems.push("sourceLanguage must stay en")
  const strings = catalog.strings ?? {}
  for (const key of required) {
    const entry = strings[key]
    if (!entry) {
      problems.push(`missing key ${JSON.stringify(key)}`)
      continue
    }
    const en = entry.localizations?.["en-US"]?.stringUnit?.value
    const es = entry.localizations?.["es-MX"]?.stringUnit?.value
    if (en !== key) problems.push(`en-US differs for ${JSON.stringify(key)}`)
    if (!es) problems.push(`empty es-MX for ${JSON.stringify(key)}`)
    else if (es === key && !sameTranslation.has(key) && !symbolOnly(key) && words(key).length > 0) {
      problems.push(`es-MX matches English for ${JSON.stringify(key)}`)
    }
  }
  for (const [key, entry] of Object.entries(strings)) {
    const es = entry.localizations?.["es-MX"]?.stringUnit?.value ?? ""
    if (/\b(vosotros|vosotras|tenéis|sois|estáis|hacéis)\b/i.test(es)) problems.push(`vosotros in ${JSON.stringify(key)}`)
  }
}

const project = fs.readFileSync(path.join(root, "project.yml"), "utf8")
if (!project.includes("developmentLanguage: en")) problems.push("project.yml developmentLanguage")
if (!project.includes("DEVELOPMENT_LANGUAGE: en")) problems.push("project.yml DEVELOPMENT_LANGUAGE")
if (!project.includes("es-MX") || !project.includes("en-US")) problems.push("project.yml CFBundleLocalizations")

fs.writeFileSync("/tmp/required-keys.txt", [...required].sort().join("\n") + "\n")
if (problems.length) {
  console.error(problems.join("\n"))
  console.error(`\n${problems.length} problems, ${required.size} keys`)
  process.exit(1)
}
console.log(`ok ${required.size} keys`)
