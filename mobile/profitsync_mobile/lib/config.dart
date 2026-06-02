/// App-wide configuration. Values are injected at build/run time via
/// `--dart-define` so the same binary can point at local dev or production.
///
/// Example:
///   flutter run \
///     --dart-define=API_BASE_URL=http://localhost:3001 \
///     --dart-define=CLERK_PUBLISHABLE_KEY=pk_test_xxx
class AppConfig {
  /// Base URL for the ProfitSync API. On the iOS simulator `localhost`
  /// reaches the host Mac, so the local `vercel dev` server works directly.
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3001',
  );

  /// Clerk publishable key (development instance: warm-oyster-76).
  static const String clerkPublishableKey = String.fromEnvironment(
    'CLERK_PUBLISHABLE_KEY',
    defaultValue: 'pk_test_d2FybS1veXN0ZXItNzYuY2xlcmsuYWNjb3VudHMuZGV2JA',
  );
}
