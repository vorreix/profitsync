import 'package:clerk_auth/clerk_auth.dart' as clerk;
import 'package:clerk_flutter/clerk_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'package:profitsync_mobile/config.dart';
import 'package:profitsync_mobile/main.dart';

/// Real end-to-end on the simulator: authenticate against the live Clerk dev
/// instance (test mode), then drive onboarding against the live backend and
/// land on the dashboard.
///
/// Clerk test mode: an email containing `+clerk_test` accepts verification
/// code `424242` without a real inbox.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  const email = 'profitsync.e2e+clerk_test@example.com';
  const password = 'Sup3r-Secret-Pass-123';

  Future<void> settle(WidgetTester tester,
      {int frames = 40,
      Duration step = const Duration(milliseconds: 200)}) async {
    for (var i = 0; i < frames; i++) {
      await tester.runAsync(() => Future.delayed(step));
      await tester.pump();
    }
  }

  testWidgets('sign in -> onboarding -> dashboard', (tester) async {
    late ClerkAuthState authState;
    late AppContainer container;

    await tester.runAsync(() async {
      final config =
          ClerkAuthConfig(publishableKey: AppConfig.clerkPublishableKey);
      authState = await ClerkAuthState.create(config: config);

      if (authState.user == null) {
        // Try an existing account first; fall back to sign-up + verification.
        try {
          await authState.attemptSignIn(
            strategy: clerk.Strategy.password,
            identifier: email,
            password: password,
          );
        } catch (_) {}

        if (authState.user == null) {
          await authState.attemptSignUp(
            strategy: clerk.Strategy.password,
            emailAddress: email,
            password: password,
            passwordConfirmation: password,
            legalAccepted: true,
          );
          if (authState.user == null) {
            try {
              await authState.attemptSignUp(
                strategy: clerk.Strategy.emailCode,
                code: '424242',
              );
            } catch (_) {}
          }
        }
      }
      container = AppContainer(authState);
    });

    expect(authState.user, isNotNull,
        reason: 'Clerk authentication did not establish a session');

    await tester.pumpWidget(
      ProfitSyncApp(authState: authState, appState: container.state),
    );

    // Wait out the boot fetch (profile + organizations).
    await settle(tester);

    // New accounts land on onboarding; previously-onboarded ones skip it.
    if (find.text('How will you use ProfitSync?').evaluate().isNotEmpty) {
      await tester.tap(find.text('Personal'));
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
      await settle(tester);
    }

    // Either way we should now be in the app shell on the dashboard.
    expect(find.text('Net balance'), findsOneWidget,
        reason: 'Dashboard did not render after onboarding');
  });
}
