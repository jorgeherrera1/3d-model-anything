import Foundation
import ObjectiveC
import Observation

enum AppLanguage: String, CaseIterable, Identifiable, Sendable {
  case esMX = "es-MX"
  case enUS = "en-US"

  var id: String { rawValue }

  static let storageKey = "HouseCapture.language"

  static func resolve(stored: String?) -> AppLanguage {
    switch stored?.trimmingCharacters(in: .whitespacesAndNewlines) {
    case "es-MX", "es_MX": .esMX
    case "en-US", "en_US": .enUS
    default: .esMX
    }
  }

  var locale: Locale { Locale(identifier: rawValue.replacingOccurrences(of: "-", with: "_")) }

  var endonym: String {
    switch self {
    case .esMX: "Español (México)"
    case .enUS: "English (US)"
    }
  }

  func scanDate(_ date: Date, time: Bool = false, timeZone: TimeZone? = nil) -> String {
    let formatter = DateFormatter()
    formatter.locale = locale
    formatter.calendar = Calendar(identifier: .gregorian)
    if let timeZone { formatter.timeZone = timeZone }
    formatter.setLocalizedDateFormatFromTemplate(time ? "yMMMdjm" : "yMMMd")
    return formatter.string(from: date)
  }

  func text(_ key: String) -> String {
    guard let bundle = Self.lproj(self) else { return key }
    let found = bundle.localizedString(forKey: key, value: key, table: nil)
    return found
  }

  func format(_ key: String, _ args: [CVarArg]) -> String {
    String(format: text(key), locale: locale, arguments: args)
  }

  func format(_ key: String, _ args: CVarArg...) -> String {
    format(key, args)
  }

  func count(_ n: Int, one: String, other: String) -> String {
    let format = text(n == 1 ? one : other)
    return String(format: format, locale: locale, Int64(n))
  }

  @discardableResult
  static func boot(defaults: UserDefaults) -> AppLanguage {
    let language = resolve(stored: defaults.string(forKey: storageKey))
    defaults.set(language.rawValue, forKey: storageKey)
    defaults.set([language.rawValue], forKey: "AppleLanguages")
    if defaults === UserDefaults.standard {
      current = language
      activate()
    }
    return language
  }

  @discardableResult
  static func persist(_ language: AppLanguage, defaults: UserDefaults) -> AppLanguage {
    defaults.set(language.rawValue, forKey: storageKey)
    defaults.set([language.rawValue], forKey: "AppleLanguages")
    if defaults === UserDefaults.standard { current = language }
    return language
  }

  static func activate() {
    warmBundles()
    let bundle: AnyObject = Bundle.main
    guard object_getClass(bundle) !== HouseLocalizedBundle.self else { return }
    object_setClass(bundle, HouseLocalizedBundle.self)
  }

  private static let stateLock = NSRecursiveLock()
  private static var stored = AppLanguage.esMX
  private static var bundleCache: [AppLanguage: Bundle] = [:]

  static var current: AppLanguage {
    get { stateLock.lock(); defer { stateLock.unlock() }; return stored }
    set { stateLock.lock(); stored = newValue; stateLock.unlock() }
  }

  static func lproj(_ language: AppLanguage) -> Bundle? {
    stateLock.lock()
    if let cached = bundleCache[language] {
      stateLock.unlock()
      return cached
    }
    stateLock.unlock()
    guard let path = Bundle.main.path(forResource: language.rawValue, ofType: "lproj"),
          let bundle = Bundle(path: path) else { return nil }
    stateLock.lock()
    bundleCache[language] = bundle
    stateLock.unlock()
    return bundle
  }

  private static func warmBundles() {
    for language in allCases { _ = lproj(language) }
  }
}

func L(_ key: String) -> String { AppLanguage.current.text(key) }

func Lf(_ key: String, _ args: CVarArg...) -> String { AppLanguage.current.format(key, args) }

func Lp(_ n: Int, _ one: String, _ other: String) -> String {
  AppLanguage.current.count(n, one: one, other: other)
}

@MainActor
@Observable
final class LanguageChoice {
  private(set) var language: AppLanguage

  init(defaults: UserDefaults = .standard) {
    language = AppLanguage.boot(defaults: defaults)
  }

  func choose(_ language: AppLanguage) {
    self.language = AppLanguage.persist(language, defaults: .standard)
  }
}

@objc(HouseLocalizedBundle)
final class HouseLocalizedBundle: Bundle, @unchecked Sendable {
  override func localizedString(forKey key: String, value: String?, table tableName: String?) -> String {
    let marker = "HouseLocalizedBundle.lookup"
    if Thread.current.threadDictionary[marker] != nil {
      return super.localizedString(forKey: key, value: value, table: tableName)
    }
    Thread.current.threadDictionary[marker] = true
    defer { Thread.current.threadDictionary.removeObject(forKey: marker) }
    let language = AppLanguage.current
    if let bundle = AppLanguage.lproj(language) {
      let found = bundle.localizedString(forKey: key, value: key, table: tableName)
      if found != key { return found }
    }
    return super.localizedString(forKey: key, value: value, table: tableName)
  }
}
