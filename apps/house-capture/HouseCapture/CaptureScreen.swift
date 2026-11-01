import ARKit
import RoomPlan
import SwiftUI

/// Full-screen capture: one pass per room. Camera + coverage mesh + RoomPlan's live walls.
struct CaptureScreen: View {
  @ObservedObject var controller: CaptureController
  let onClose: () -> Void
  @State private var reviewing = false
  @State private var confirmClose = false
  @FocusState private var nameFocused: Bool
  @Environment(\.scenePhase) private var scenePhase
  static let roomSuggestions = ["Living room", "Kitchen", "Dining room", "Office", "Bedroom", "Primary bedroom", "Bathroom", "Hallway", "Basement", "Playroom", "Laundry", "Garage"]

  private var scanning: Bool { controller.phase == .scanning }

  @Environment(LanguageChoice.self) private var languageChoice

  var body: some View {
    let _ = languageChoice.language
    ZStack {
      ARViewContainer(view: controller.scanView.view).ignoresSafeArea()

      VStack {
        topBar
        if let notice = controller.notice {
          Label(notice, systemImage: "checkmark.circle.fill")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.white)
            .padding(10)
            .background(.green.opacity(0.85), in: RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal)
            .transition(.opacity)
        }
        Spacer()
        if scanning, let issue = controller.trackingIssue {
          VStack(alignment: .leading, spacing: 6) {
            Label("Recovering your position", systemImage: "viewfinder.trianglebadge.exclamationmark")
              .font(.headline)
            Text(recoveryCopy(issue)).font(.subheadline)
            Text("Recording is paused. Saved photos are safe; capture resumes when your position is stable.").font(.caption)
            if let url = controller.recoveryPhoto, let image = UIImage(contentsOfFile: url.path) {
              Image(uiImage: image).resizable().scaledToFit().frame(height: 100)
              Text("Return to this view and pan slowly.").font(.caption)
            }
            Button("Save what I have", action: controller.finishRoom)
          }
          .padding(12)
          .frame(maxWidth: 500, alignment: .leading)
          .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
          .padding(.horizontal)
          .accessibilityElement(children: .combine)
        }
        if let warning = controller.lastWarning {
          Text(warning)
            .font(.footnote)
            .padding(10)
            .background(.orange.opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal)
        }
        bottomPanel
      }
      .padding(.bottom, 8)
      .animation(.easeInOut(duration: 0.3), value: controller.notice)
    }
    .confirmationDialog("Leave this session?", isPresented: $confirmClose, titleVisibility: .visible) {
      if !controller.rooms.isEmpty && controller.phase == .betweenRooms {
        Button(Lp(controller.rooms.count, "Save %lld room and finish", "Save %lld rooms and finish")) {
          Task { await controller.finishSession() }
        }
      }
      Button(controller.rooms.isEmpty ? L("Discard session") : Lp(controller.rooms.count, "Discard session and its %lld room", "Discard session and its %lld rooms"), role: .destructive) {
        controller.abandon()
        onClose()
      }
      Button("Keep scanning", role: .cancel) {}
    }
    .sheet(isPresented: $reviewing) {
      if let source = controller.reviewSource {
        NavigationStack { ScanReview(source: source).toolbar { Button("Done") { reviewing = false } } }
      }
    }
    .onChange(of: controller.phase) { old, next in
      if old == .finishingRoom, next == .betweenRooms, controller.reviewSource != nil, !controller.captureBudget.constrained { reviewing = true }
    }
    .onAppear { controller.begin() }
    .onChange(of: scenePhase) { _, phase in
      // leaving the app interrupts the camera: don't keep counting coverage across the gap
      if phase != .active { controller.pause() }
    }
    .statusBarHidden()
  }

  // MARK: top

  private var topBar: some View {
    HStack(alignment: .top) {
      Button {
        if controller.phase == .done { onClose() } else { confirmClose = true }
      } label: {
        Image(systemName: "xmark")
          .font(.headline)
          .frame(width: 44, height: 44)
          .background(.ultraThinMaterial, in: Circle())
      }
      Spacer()
      VStack(alignment: .trailing, spacing: 6) {
        HStack(spacing: 10) {
          if scanning {
            VStack(spacing: 3) {
              CoverageRing(percent: controller.stats.percent).frame(width: 44, height: 44)
              Text("Photo detail").font(.system(size: 9, weight: .semibold))
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Lf("Photo detail, %lld percent of observed surfaces", Int64(controller.stats.percent)))
          }
          VStack(alignment: .trailing, spacing: 2) {
            if scanning {
              Text(controller.roomName).font(.headline)
              Text(controller.meshReady ? Lp(controller.coverage.walls.count, "%lld wall measured", "%lld walls measured") : L("Starting LiDAR…"))
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            }
            Text("\(Lp(controller.rooms.count, "%lld room", "%lld rooms")) · \(Lp(controller.photoCount, "%lld photo", "%lld photos"))")
              .font(.caption.monospacedDigit())
            if controller.phase != .relocalizing {
              HStack(spacing: 6) {
                AlignmentBadge(alignment: controller.alignment)
                MapStatusDot(status: controller.mappingStatus)
              }
            }
          }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
        if controller.hasGhost, controller.alignment.method == "relocalized", controller.phase == .betweenRooms || scanning {
          Toggle(isOn: $controller.ghostVisible) {
            Label("Earlier scan", systemImage: controller.ghostVisible ? "eye" : "eye.slash")
              .font(.caption.weight(.semibold))
          }
          .toggleStyle(.button)
          .buttonStyle(.bordered)
          .controlSize(.small)
          .tint(.green)
        }
        if scanning {
          liveMap
        }
      }
    }
    .padding(.horizontal)
    .padding(.top, 8)
  }

  /// Heading-up map: walls go green once a sharp photo sees them roughly head-on
  private var liveMap: some View {
    VStack(spacing: 4) {
      CoverageMap(coverage: controller.coverage, camera: controller.cameraPose, photos: controller.photoPositions,
                  redSpots: controller.stats.redSpots)
        .frame(width: 130, height: 130)
    }
    .padding(8)
    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
  }

  // MARK: bottom

  @ViewBuilder
  private var bottomPanel: some View {
    switch controller.phase {
    case .relocalizing:
      RelocalizationPanel(controller: controller)
    case .betweenRooms:
      if controller.sessionNeedsRestart {
        panel {
          Label("Scan ended", systemImage: "exclamationmark.triangle.fill").font(.headline)
          Text("The phone lost its position. The available room data has been saved. Finish this session, then start a new capture from the house screen.")
            .font(.subheadline)
          roomList
          Button("Finish and keep saved rooms") { Task { await controller.finishSession() } }
            .buttonStyle(.borderedProminent)
        }
      } else { betweenRooms }
    case .scanning:
      if controller.paused { pausedPanel } else { scanControls }
    case .finishingRoom:
      status(Lf("Saving %@…", controller.roomName))
    case .finishing:
      status(controller.finishingStep.isEmpty ? L("Saving…") : controller.finishingStep)
    case .done:
      done
    case .failed(let message):
      panel {
        Text("Couldn't save the scan").font(.headline)
        Text(message).font(.footnote)
        Text("Keep this screen open while freeing storage, then retry. Files already written are kept.").font(.caption)
        Button("Retry saving") { Task { await controller.finishSession() } }.buttonStyle(.borderedProminent)
        Button("Close", action: onClose).buttonStyle(.bordered)
      }
    }
  }

  private var betweenRooms: some View {
    panel {
      if controller.rooms.isEmpty {
        if controller.alignment.method == "relocalized" {
          Text(linedUpCopy)
            .font(.subheadline)
        } else {
          Text("Scan each room once: as you move, a triangle mesh appears. **Green** means good photo coverage, including aligned earlier scans. **Red** needs more photos. Areas without triangles still need scanning. The white outlines are the walls, doors and windows being measured. **Photo detail** measures photography on surfaces already seen by LiDAR; it is not the percentage of the room scanned. Save and review for missing areas.")
            .font(.subheadline)
        }
      } else {
        CoverageMap(coverage: controller.coverage, camera: nil, photos: controller.photoPositions)
          .frame(height: 150)
          .frame(maxWidth: .infinity)
        if let last = controller.rooms.last {
          Text(roomSummary(last))
            .font(.footnote)
        }
        Button("Review saved room in 3D") { reviewing = true }.buttonStyle(.borderedProminent)
        Text("Inspect the textured scan before leaving. Use coverage colours in the preview to check gaps.").font(.caption)
        roomList
        Text("Walk into the next room, then start it. Stay in this session so the rooms line up.")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      if controller.requiresFreshScan {
        Text("This scan is saved. Finish this session, then tap Scan a room to continue with a fresh capture.").font(.headline)
      }
      Text("Which room are you in?").font(.subheadline.weight(.semibold))
      TextField("Room name", text: $controller.roomName)
        .textFieldStyle(.roundedBorder)
        .submitLabel(.go)
        .focused($nameFocused)
        .onSubmit(controller.startRoom)
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          // rooms scanned before in this area first: picking one rescans (replaces) it
          ForEach(controller.existingRooms) { existing in
            let name = existing.name
            Button {
              controller.selectRoom(existing)
            } label: {
              Label(name, systemImage: "arrow.triangle.2.circlepath")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .tint(controller.roomName == name ? .accentColor : .green)
          }
          ForEach(Self.roomSuggestions.filter { key in
            let name = L(key)
            return !scannedHere(name) && !controller.existingRoomNames.contains { HouseProject.roomKey($0) == HouseProject.roomKey(name) }
          }, id: \.self) { key in
            let name = L(key)
            Button(name) { controller.selectedRoomID = nil; controller.roomName = name }
              .buttonStyle(.bordered)
              .controlSize(.small)
              .tint(controller.roomName == name ? .accentColor : .secondary)
          }
        }
      }
      if controller.selectedRoomID != nil {
        Text(Lf("Rescan: this becomes %@'s active scan (the old one stays in its history).", controller.roomName))
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
      Toggle("High-resolution automatic photos", isOn: $controller.highResolutionPhotos)
        .font(.subheadline)
      Text("Regular photos use camera frames for a lighter scan. High-resolution photos add processing and are limited to one request every 3 seconds while the phone is cool. The shutter always saves a regular photo.")
        .font(.caption).foregroundStyle(.secondary)
      Button {
        controller.startRoom()
      } label: {
        Label(controller.canStartRoom ? Lf("Scan %@", controller.roomName) : L("Name the room to start"), systemImage: "viewfinder")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .controlSize(.large)
      .disabled(!controller.canStartRoom)
      if !controller.rooms.isEmpty {
        HStack {
          Button("Redo last room", role: .destructive, action: controller.discardLastRoom)
          Spacer()
          Button("Finish session") { Task { await controller.finishSession() } }
            .buttonStyle(.bordered)
        }
      }
    }
  }

  private func scannedHere(_ name: String) -> Bool {
    controller.rooms.contains { HouseProject.roomKey($0.name) == HouseProject.roomKey(name) }
  }

  private var linedUpCopy: String {
    if controller.priorPhotoCount > 0 {
      return Lf("You're lined up with %@. The faint green is what you scanned before; surfaces its %@ already cover start out green. Scan a new room, or rescan one to replace it.", controller.zoneName, Lp(controller.priorPhotoCount, "%lld photo", "%lld photos"))
    }
    return Lf("You're lined up with %@. The faint green is what you scanned before. Scan a new room, or rescan one to replace it.", controller.zoneName)
  }

  private func roomSummary(_ last: RoomRecord) -> String {
    let detail = last.photographedPercent.map { Lf("%lld%% photo detail", Int64($0)) } ?? L("not measured")
    let photos = Lp(last.detailPhotos ?? 0, "%lld photo", "%lld photos")
    let mesh = last.mesh == nil ? L(" · no mesh") : ""
    return Lf("%@: %@ · %@%@", last.name, detail, photos, mesh)
  }

  private func recoveryCopy(_ issue: TrackingRecovery.Issue) -> String {
    switch issue {
    case .starting: L("Finding your position. Aim at a well-lit doorway or furniture and move slowly.")
    case .motion: L("Slow down and hold steady. Keep a familiar doorway or furniture in view.")
    case .features: L("Aim at well-lit furniture, shelves or a doorway. Blank walls are hard to track.")
    case .relocalizing: L("Return to an area you just scanned and pan slowly so the phone can recognize it.")
    case .unavailable: L("Position tracking is unavailable. Hold steady with the room in view.")
    case .interrupted: L("Camera interrupted. Return to the app, then aim at an area you already scanned.")
    case .stalled: L("Camera updates have stalled. Hold steady. If this persists, finish the room to save what you have.")
    case .settling: L("Position found. Hold steady for a moment while tracking settles.")
    }
  }

  private var pausedPanel: some View {
    panel {
      Label("Paused", systemImage: "pause.circle.fill").font(.headline)
      Text("No photos, depth or coverage while paused. Tracking keeps running: keep the camera pointed at the room (not the floor or your pocket) so it doesn't lose its place.")
        .font(.footnote)
        .foregroundStyle(.secondary)
      Button {
        controller.resume()
      } label: {
        Label(Lf("Resume %@", controller.roomName), systemImage: "play.fill").frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .controlSize(.large)
      Button("Finish room and save what is available", action: controller.finishRoom)
        .buttonStyle(.bordered)
    }
  }

  private var roomList: some View {
    VStack(alignment: .leading, spacing: 4) {
      ForEach(controller.rooms) { room in
        HStack {
          Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
          Text(room.name)
          Spacer()
          if let pc = room.photographedPercent {
            Text(Lf("%lld%% photo detail", Int64(pc))).font(.caption.monospacedDigit().weight(.semibold)).foregroundStyle(pc >= 85 ? .green : .orange)
          }
          Text(Lf("%lldw %lldd %lldwin %lldobj", Int64(room.walls), Int64(room.doors + room.openings), Int64(room.windows), Int64(room.objects)))
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
      }
    }
  }

  private var scanControls: some View {
    VStack(spacing: 10) {
      if controller.captureReady {
        tip(controller.quality.ready ? controller.quality.message : (controller.instruction ?? controller.quality.message))
        if controller.coveragePlateau && !controller.quality.ready {
          tip(L("Photo detail isn't improving much. You can save and review what you have; you don't need to keep circling."))
        }
        if controller.captureBudget.constrained { Text("Reducing background capture to keep scanning responsive.").font(.caption).foregroundStyle(.white) }
      }
      HStack(spacing: 14) {
        Legend()
        Button(action: controller.pause) {
          Image(systemName: "pause.fill")
        }
        .buttonStyle(.bordered)
        shutter
        Button(controller.quality.ready ? "Finish room ✓" : "Save room", action: controller.finishRoom)
          .buttonStyle(.borderedProminent)
          .tint(controller.quality.ready ? .green : .accentColor)
          .controlSize(.large)
      }
    }
    .padding(.horizontal)
  }

  private var shutter: some View {
    Button(action: controller.takePhoto) {
      Image(systemName: "camera.fill")
        .font(.title2)
        .frame(width: 60, height: 60)
        .background(.white, in: Circle())
        .foregroundStyle(.black)
    }
    .disabled(!controller.canTakePhoto)
    .opacity(controller.canTakePhoto ? 1 : 0.4)
    .accessibilityLabel("Take reference photo")
  }

  private func tip(_ text: String) -> some View {
    Text(text)
      .font(.caption)
      .multilineTextAlignment(.center)
      .padding(8)
      .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
  }

  private var done: some View {
    panel {
      Label("Saved", systemImage: "checkmark.seal.fill").font(.headline).foregroundStyle(.green)
      roomList
      HStack(spacing: 8) {
        AlignmentBadge(alignment: controller.alignment)
        Text(controller.mapSummary ?? "Map not saved").font(.caption).foregroundStyle(.secondary)
      }
      Text("Come back any time and tap **Scan a room**, or open a saved room and choose **Continue scanning from this room**. Share from the house screen (AirDrop the .zip to your Mac).")
        .font(.footnote)
        .foregroundStyle(.secondary)
      Button("Close", action: onClose).buttonStyle(.borderedProminent)
    }
  }

  private func status(_ text: String) -> some View {
    panel {
      HStack(spacing: 12) {
        ProgressView()
        Text(text)
      }
    }
  }

  private func panel<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 12, content: content)
      .padding()
      .frame(maxWidth: 500)
      .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
      .padding(.horizontal)
  }
}

/// Continue: find your place in the zone's saved map
private struct RelocalizationPanel: View {
  @ObservedObject var controller: CaptureController

  private var r: CaptureController.Relocalization { controller.reloc }

  @Environment(LanguageChoice.self) private var languageChoice

  var body: some View {
    let _ = languageChoice.language
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        Text(title).font(.headline)
        Spacer()
        if r.seconds > 0 { Text(Lf("%lld s", Int64(r.seconds))).font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
      }
      Text(message).font(.subheadline)
      if r.stage == .checking {
        ProgressView(value: Double(r.progress))
          .tint(.green)
        if let c = r.check, c.known > 0 {
          Text(Lf("%lld%% of the walls you see match%@", Int64((c.wallKnown > 0 ? c.wallFraction : c.inlierFraction) * 100), c.median.map { Lf(" · off by %.1f cm", $0 * 100) } ?? ""))
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
          if c.needsCorner {
            Text("Now pan across a corner, a door frame or some furniture: one flat wall can't show whether it's slid sideways.")
              .font(.caption.weight(.semibold))
          } else if c.wallKnown < 100 {
            Text("Aim at walls and furniture you scanned before (not just the floor).")
              .font(.caption.weight(.semibold))
          }
        }
      }
      Text(r.tracking + " · " + r.reference).font(.caption).foregroundStyle(.secondary)
      if !controller.landmarks.isEmpty, r.stage == .searching || r.stage == .mismatch {
        Text("Spots you scanned before:").font(.caption.weight(.semibold))
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 6) {
            ForEach(controller.landmarks, id: \.self) { LandmarkThumb(url: $0) }
          }
        }
      }
      if r.seconds >= 20 || r.timedOut || r.stage == .mismatch {
        tips
      }
      if r.timedOut, r.stage != .mismatch {
        Text("Still can't find where you are.").font(.subheadline.weight(.semibold))
        HStack {
          Button("Keep trying", action: controller.keepTrying).buttonStyle(.bordered)
          Spacer()
          Button("Start a fresh scan", action: controller.startUnaligned).buttonStyle(.borderedProminent)
        }
      } else {
        HStack {
          if r.stage == .mismatch {
            Button("Try again", action: controller.retryRelocalization).buttonStyle(.borderedProminent)
          }
          Spacer()
          if r.seconds >= 20 || r.stage == .mismatch || isFailed {
            Button("Start a fresh scan", action: controller.startUnaligned).buttonStyle(.bordered)
          }
        }
      }
    }
    .padding()
    .frame(maxWidth: 500)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
    .padding(.horizontal)
  }

  private var isFailed: Bool {
    if case .failed = r.stage { return true }
    return false
  }

  private var title: String {
    switch r.stage {
    case .loadingMap: Lf("Loading %@…", controller.zoneName)
    case .searching: Lf("Continue in %@", controller.zoneName)
    case .checking: L("Found it: checking the fit")
    case .mismatch: L("This doesn't line up")
    case .done: L("Lined up")
    case .failed: L("Can't continue from the saved map")
    }
  }

  private var message: String {
    switch r.stage {
    case .loadingMap: L("Reading the saved map.")
    case .searching: L("Point at an area you already scanned and move slowly. When the phone recognizes it, your earlier scan appears in green.")
    case .checking: L("Hold on the area you scanned before. The green should sit right on the walls and furniture.")
    case .mismatch: L("The phone thinks it knows this place, but the green doesn't sit on the real surfaces. Try again from a spot with lots of detail, or start unaligned.")
    case .done: ""
    case .failed(let m): m + " " + L("You can still scan: the session gets its own frame. Use Connect room afterward to align it with another room.")
    }
  }

  private var tips: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text("• Turn on the same lights as last time.")
      Text("• Stand where you scanned before, like a doorway or a corner with furniture, 1–2 m back, and pan slowly.")
      Text("• Bare walls and floors don't work; aim at shelves, pictures, door frames.")
      Text("• Things moved since last time? Aim at something that didn't.")
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }
}

private struct LandmarkThumb: View {
  let url: URL
  @State private var image: CGImage?
  var body: some View {
    Group {
      if let image {
        Image(decorative: image, scale: 1).resizable().scaledToFill()
      } else {
        Color.gray.opacity(0.3)
      }
    }
    .frame(width: 84, height: 112)
    .clipShape(RoundedRectangle(cornerRadius: 8))
    .task {
      let u = url
      image = await Task.detached(priority: .utility) { PriorPhotos.thumbnail(u) }.value
    }
  }
}

struct AlignmentBadge: View {
  var alignment: HouseProject.Alignment
  @Environment(LanguageChoice.self) private var languageChoice

  var body: some View {
    let _ = languageChoice.language
    let (text, color): (String, Color) = switch alignment.method {
    case "first": (L("New scan"), .blue)
    case "relocalized": (alignment.residualMeters.map { Lf("Matched ±%.1f cm", $0 * 100) } ?? L("Matched"), .green)
    case "unaligned": (L("Not connected yet"), .orange)
    case "manual", "icp": (L("Connected"), .teal)
    default: (alignment.method, .gray)
    }
    Text(text)
      .font(.caption2.weight(.semibold))
      .padding(.horizontal, 6).padding(.vertical, 2)
      .background(color.opacity(0.25), in: Capsule())
      .foregroundStyle(color)
  }
}

private struct MapStatusDot: View {
  var status: ARFrame.WorldMappingStatus
  @Environment(LanguageChoice.self) private var languageChoice

  var body: some View {
    let _ = languageChoice.language
    let text = L("map")
    let color: Color = switch status {
    case .mapped: .green
    case .extending: .yellow
    case .limited: .orange
    default: .gray
    }
    HStack(spacing: 3) {
      Circle().fill(color).frame(width: 6, height: 6)
      Text(text).font(.caption2)
    }
  }
}

struct CoverageRing: View {
  var percent: Int
  @Environment(LanguageChoice.self) private var languageChoice

  var body: some View {
    let _ = languageChoice.language
    ZStack {
      Circle().stroke(.white.opacity(0.25), lineWidth: 5)
      Circle()
        .trim(from: 0, to: CGFloat(min(100, percent)) / 100)
        .stroke(percent >= 85 ? Color.green : percent >= 50 ? .orange : .red, style: StrokeStyle(lineWidth: 5, lineCap: .round))
        .rotationEffect(.degrees(-90))
        .animation(.easeOut(duration: 0.4), value: percent)
      Text(Lf("%lld%%", Int64(percent))).font(.caption2.monospacedDigit().weight(.bold))
    }
  }
}

private struct Legend: View {
  @Environment(LanguageChoice.self) private var languageChoice

  var body: some View {
    let _ = languageChoice.language
    VStack(alignment: .leading, spacing: 2) {
      ForEach([(Color.red, L("needs photos")), (.green, L("captured"))], id: \.1) { color, label in
        HStack(spacing: 4) {
          Circle().fill(color).frame(width: 7, height: 7)
          Text(label).font(.system(size: 9))
        }
      }
    }
    .padding(6)
    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
  }
}

/// Hosts the scan's ARSCNView (camera + coverage mesh + RoomPlan outlines)
struct ARViewContainer: UIViewRepresentable {
  let view: ARSCNView
  func makeUIView(context: Context) -> ARSCNView { view }
  func updateUIView(_ uiView: ARSCNView, context: Context) {}
}
