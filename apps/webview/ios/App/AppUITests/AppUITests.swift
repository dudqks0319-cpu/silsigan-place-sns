import XCTest

final class AppUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testStagingAppLaunchesAndExposesLiveHome() throws {
        let app = launchApp()

        XCTAssertTrue(
            app.buttons["지금컷 올리기"].waitForExistence(timeout: 12),
            "The live home should expose the direct upload action."
        )
        capture(app, name: "staging-home")
    }

    @MainActor
    func testPrimaryNavigationSurfaces() throws {
        let app = launchApp()

        for destination in ["검색", "지도", "마이", "홈"] {
            let button = app.buttons[destination]
            XCTAssertTrue(
                button.waitForExistence(timeout: 10),
                "The \(destination) navigation button should be available."
            )
            button.tap()
            capture(app, name: "navigation-\(destination)")
        }
    }

    @MainActor
    func testUploadRequestsCurrentLocationWithoutPlacePicker() throws {
        let app = launchApp(resetLocationAuthorization: true)
        app.buttons["올리기"].tap()

        allowLocationIfRequested()

        XCTAssertFalse(
            app.staticTexts["장소를 먼저 선택해 주세요"].waitForExistence(timeout: 2),
            "The upload flow must not require a manual place picker."
        )

        let linkedPlace = app.staticTexts["기기 위치 자동 연결"]
        let retryLocation = app.buttons["현재 위치 다시 확인"]
        let noNearbyPlace = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "300m 안에 등록된 장소가 없습니다")
        ).firstMatch

        XCTAssertTrue(
            linkedPlace.waitForExistence(timeout: 12)
                || retryLocation.waitForExistence(timeout: 2)
                || noNearbyPlace.waitForExistence(timeout: 2),
            "The upload flow should either auto-link a nearby place or show a truthful current-location recovery state."
        )

        capture(app, name: "upload-current-location")
    }

    @MainActor
    func testPhotoUploadRemainsFailClosedUntilRightsConfirmation() throws {
        let app = launchApp()
        app.buttons["올리기"].tap()
        allowLocationIfRequested()

        guard app.staticTexts["기기 위치 자동 연결"].waitForExistence(timeout: 12) else {
            throw XCTSkip("The physical device is not within the allowed radius of a registered staging place.")
        }

        let rightsConfirmation = app.checkBoxes.firstMatch
        let uploadButton = app.buttons["권한 확인 후 사진 올리기"]
        XCTAssertTrue(
            rightsConfirmation.waitForExistence(timeout: 10),
            "The photo rights confirmation should be visible before media selection."
        )
        XCTAssertTrue(
            uploadButton.waitForExistence(timeout: 10),
            "The upload button should explain why it is disabled."
        )
        XCTAssertFalse(uploadButton.isEnabled, "Photo selection must fail closed before rights confirmation.")

        rightsConfirmation.tap()

        let enabledUploadButton = app.buttons["사진 올리기"]
        XCTAssertTrue(
            enabledUploadButton.waitForExistence(timeout: 5) && enabledUploadButton.isEnabled,
            "Explicit rights confirmation should enable photo selection."
        )
        capture(app, name: "photo-rights-confirmed")
    }

    @MainActor
    private func launchApp(resetLocationAuthorization: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        if resetLocationAuthorization {
            app.resetAuthorizationStatus(for: .location)
        }
        app.launch()

        XCTAssertTrue(
            app.webViews.firstMatch.waitForExistence(timeout: 20),
            "The staging app should expose its web content on a real device."
        )
        XCTAssertTrue(
            app.staticTexts["실시간 데이터"].waitForExistence(timeout: 20),
            "The staging app should settle into live mode instead of the fail-closed directory fallback."
        )
        return app
    }

    @MainActor
    private func allowLocationIfRequested() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts.firstMatch
        guard alert.waitForExistence(timeout: 5) else {
            return
        }

        let allowButton = alert.buttons.matching(
            NSPredicate(
                format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@",
                "앱을 사용하는 동안 허용",
                "Allow While Using App"
            )
        ).firstMatch
        XCTAssertTrue(
            allowButton.waitForExistence(timeout: 5),
            "The location prompt should offer foreground-only access."
        )
        allowButton.tap()
    }

    @MainActor
    private func capture(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)

        print("SILSIGAN_UI_HIERARCHY_BEGIN \(name)")
        print(app.debugDescription)
        print("SILSIGAN_UI_HIERARCHY_END \(name)")
    }
}
