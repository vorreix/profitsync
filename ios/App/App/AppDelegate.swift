import UIKit
import Capacitor
import FirebaseCore

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        configureFirebaseIfNeeded()
        return true
    }

    /// The Firebase Messaging Capacitor plugin calls `FirebaseApp.configure()`
    /// the instant it loads (during the bridge's plugin registration). Without a
    /// bundled `GoogleService-Info.plist` that call throws and crashes the app
    /// before the login screen ever appears. iOS push is provisioned separately
    /// (APNs key + a Firebase iOS app + `GoogleService-Info.plist`, kept out of
    /// git like Android's `google-services.json`), so until that config lands we
    /// configure an inert default app here — ahead of the bridge — so the plugin
    /// finds an existing `FirebaseApp` and never force-configures. Core features
    /// work regardless; push stays dormant until a real plist is added, at which
    /// point Firebase initialises normally with zero code changes.
    private func configureFirebaseIfNeeded() {
        guard FirebaseApp.app() == nil else { return }
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
            return
        }
        // Placeholder options in Firebase's required formats (39-char "AIza…"
        // key, "1:num:ios:hex" app id) so `configure` passes validation without
        // crashing. They grant NO access to any Firebase project — no real
        // credential ships in the app. A real GoogleService-Info.plist (added
        // when push is provisioned) takes over via the branch above.
        let options = FirebaseOptions(googleAppID: "1:000000000000:ios:0000000000000000",
                                      gcmSenderID: "000000000000")
        options.apiKey = "AIzaSyUNCONFIGURED000000000000000000000" // secret-scan:ignore — inert placeholder, grants no access
        options.projectID = "profitsync-unconfigured"
        options.bundleID = Bundle.main.bundleIdentifier ?? "com.vorreix.profitsync"
        FirebaseApp.configure(options: options)
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
