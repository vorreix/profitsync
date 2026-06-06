import 'package:clerk_auth/clerk_auth.dart' as clerk;
import 'package:clerk_flutter/clerk_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'package:profitsync_mobile/config.dart';
import 'package:profitsync_mobile/main.dart';
import 'package:profitsync_mobile/theme_controller.dart';

/// Drives the real app through every screen on the simulator, pausing on each
/// (with a log marker) so an external watcher can capture screenshots.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  Future<void> settle(WidgetTester tester,
      {int frames = 40, Duration step = const Duration(milliseconds: 200)}) async {
    for (var i = 0; i < frames; i++) {
      await tester.runAsync(() => Future.delayed(step));
      await tester.pump();
    }
  }

  Future<bool> waitFor(WidgetTester tester, Finder finder,
      {int maxSeconds = 40}) async {
    for (var i = 0; i < maxSeconds * 5; i++) {
      if (finder.evaluate().isNotEmpty) return true;
      await tester.runAsync(() => Future.delayed(const Duration(milliseconds: 200)));
      await tester.pump();
    }
    return finder.evaluate().isNotEmpty;
  }

  Future<void> hold(WidgetTester tester, String marker, {int seconds = 11}) async {
    await tester.pump();
    debugPrint('SHOWCASE_MARKER:$marker');
    for (var i = 0; i < seconds * 5; i++) {
      await tester.runAsync(() => Future.delayed(const Duration(milliseconds: 200)));
      await tester.pump();
    }
  }

  testWidgets('showcase all screens', (tester) async {
    final ts = DateTime.now().millisecondsSinceEpoch;
    final email = 'ps.show.$ts+clerk_test@example.com';
    const password = 'Sup3r-Secret-Pass-123';

    late ClerkAuthState authState;
    await tester.runAsync(() async {
      final config =
          ClerkAuthConfig(publishableKey: AppConfig.clerkPublishableKey);
      authState = await ClerkAuthState.create(config: config);
      if (authState.user != null) await authState.signOut();
    });

    final container = AppContainer(authState);
    await tester.pumpWidget(
        ProfitSyncApp(authState: authState, appState: container.state, themeController: ThemeController()));
    await settle(tester, frames: 12);

    // Signed-out → custom login.
    await hold(tester, 'login');

    // Toggle to the sign-up view.
    if (find.text('Sign up').evaluate().isNotEmpty) {
      await tester.tap(find.text('Sign up').last);
      await settle(tester, frames: 8);
      await hold(tester, 'signup');
    }

    // Authenticate for real (test mode), which flips the app into the gate.
    await tester.runAsync(() async {
      await authState.attemptSignUp(
        strategy: clerk.Strategy.password,
        emailAddress: email,
        password: password,
        passwordConfirmation: password,
        firstName: 'Jordan',
        lastName: 'Avery',
        legalAccepted: true,
      );
      if (authState.user == null && authState.signUp != null) {
        await authState.attemptSignUp(strategy: clerk.Strategy.emailCode);
        await authState.attemptSignUp(
            strategy: clerk.Strategy.emailCode, code: '424242');
      }
    });
    debugPrint('SHOWCASE_DIAG: user=${authState.user?.id}');

    // Onboarding (wait out the authenticated bootstrap).
    final onOnboarding =
        await waitFor(tester, find.text('How will you use ProfitSync?'),
            maxSeconds: 30);
    debugPrint('SHOWCASE_DIAG: onboarding=$onOnboarding '
        'loading=${container.state.loading} '
        'error=${container.state.error} '
        'orgs=${container.state.orgs.length} '
        'onboardedAt=${container.state.profile?.onboardedAt}');
    await hold(tester, 'onboarding');
    if (!onOnboarding) return;

    await tester.tap(find.text('Business'));
    await settle(tester, frames: 6);
    final companyField = find.byType(TextField);
    if (companyField.evaluate().isNotEmpty) {
      await tester.enterText(companyField.first, 'Acme Studio');
      await tester.pump();
    }
    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    final onDashboard = await waitFor(tester, find.text('Net balance'));
    expect(onDashboard, isTrue);

    // Seed data, pull-to-refresh.
    await tester.runAsync(() async {
      final client = await container.api.post('/api/clients', {
        'name': 'Globex Corp',
        'company': 'Globex',
        'email': 'ap@globex.com',
        'status': 'active',
      });
      final clientId = (client as Map)['id'];
      await container.api.post('/api/transactions', {
        'client_id': clientId,
        'type': 'incoming',
        'amount': 4200,
        'description': 'Project milestone',
        'category': 'Consulting',
        'date': '2026-05-22',
      });
      await container.api.post('/api/transactions', {
        'client_id': clientId,
        'type': 'outgoing',
        'amount': 850,
        'description': 'Subcontractor',
        'category': 'Services',
        'date': '2026-05-19',
      });
    });
    await tester.fling(find.text('Net balance'), const Offset(0, 420), 1500);
    await settle(tester, frames: 60);
    await hold(tester, 'dashboard');

    // Add-transaction form with the category picker.
    await tester.tap(find.widgetWithText(FloatingActionButton, 'Add'));
    await settle(tester, frames: 8);
    await hold(tester, 'txnform');
    await tester.tapAt(const Offset(8, 8)); // dismiss the sheet via the barrier
    await settle(tester, frames: 6);

    if (find.text('Clients').evaluate().isNotEmpty) {
      await tester.tap(find.text('Clients').first);
      await settle(tester);
      await hold(tester, 'clients');
    }

    await tester.tap(find.text('Transactions').first);
    await settle(tester);
    await hold(tester, 'activity');

    await tester.tap(find.text('Profile').first);
    await settle(tester);
    await hold(tester, 'profile');

    // Subscription screen (upgrade/downgrade).
    if (find.text('Plan').evaluate().isNotEmpty) {
      await tester.tap(find.text('Plan'));
      await waitFor(tester, find.text('CURRENT PLAN'), maxSeconds: 20);
      await hold(tester, 'subscription');
    }
  });
}
