import 'package:clerk_auth/clerk_auth.dart' as clerk;
import 'package:clerk_flutter/clerk_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'package:profitsync_mobile/config.dart';
import 'package:profitsync_mobile/main.dart';
import 'package:profitsync_mobile/theme_controller.dart';

/// Verifies the real create/edit flows through the UI (client create was
/// reported broken) and that opening the forms doesn't overflow — the test
/// framework fails on any RenderFlex overflow.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  Future<void> pumpFor(WidgetTester t, int frames) async {
    for (var i = 0; i < frames; i++) {
      await t.runAsync(() => Future.delayed(const Duration(milliseconds: 200)));
      await t.pump();
    }
  }

  Future<bool> waitFor(WidgetTester t, Finder f, {int maxSeconds = 30}) async {
    for (var i = 0; i < maxSeconds * 5; i++) {
      if (f.evaluate().isNotEmpty) return true;
      await t.runAsync(() => Future.delayed(const Duration(milliseconds: 200)));
      await t.pump();
    }
    return f.evaluate().isNotEmpty;
  }

  testWidgets('create a client through the UI', (tester) async {
    final ts = DateTime.now().millisecondsSinceEpoch;
    final email = 'ps.crud.$ts+clerk_test@example.com';
    const password = 'Sup3r-Secret-Pass-123';
    final clientName = 'Acme Widgets $ts';

    late ClerkAuthState authState;
    await tester.runAsync(() async {
      final config =
          ClerkAuthConfig(publishableKey: AppConfig.clerkPublishableKey);
      authState = await ClerkAuthState.create(config: config);
      if (authState.user != null) await authState.signOut();
      await authState.attemptSignUp(
        strategy: clerk.Strategy.password,
        emailAddress: email,
        password: password,
        passwordConfirmation: password,
        firstName: 'Casey',
        lastName: 'Lee',
        legalAccepted: true,
      );
      if (authState.user == null && authState.signUp != null) {
        await authState.attemptSignUp(strategy: clerk.Strategy.emailCode);
        await authState.attemptSignUp(
            strategy: clerk.Strategy.emailCode, code: '424242');
      }
    });
    expect(authState.user, isNotNull);

    final container = AppContainer(authState);
    await tester.pumpWidget(
        ProfitSyncApp(authState: authState, appState: container.state, themeController: ThemeController()));

    // Onboard as Business so Clients is available.
    expect(await waitFor(tester, find.text('How will you use ProfitSync?')),
        isTrue);
    await tester.tap(find.text('Business'));
    await pumpFor(tester, 6);
    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    expect(await waitFor(tester, find.text('Net balance')), isTrue);

    // Go to Clients.
    await tester.tap(find.text('Clients').first);
    await pumpFor(tester, 8);
    expect(find.widgetWithText(FloatingActionButton, 'New client'), findsOneWidget);

    // Open the New client sheet (confirm via its Save button — the title text
    // collides with the FAB label).
    await tester.tap(find.widgetWithText(FloatingActionButton, 'New client'));
    await pumpFor(tester, 8);
    expect(find.widgetWithText(FilledButton, 'Save client'), findsOneWidget);

    // Fill the name (first field) and save.
    await tester.enterText(find.byType(TextField).first, clientName);
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Save client'));

    // The new client must appear in the list.
    expect(await waitFor(tester, find.text(clientName)), isTrue,
        reason: 'Newly created client did not appear in the list');
  });

  testWidgets('add a transaction with a category', (tester) async {
    final ts = DateTime.now().millisecondsSinceEpoch;
    final email = 'ps.crud2.$ts+clerk_test@example.com';
    const password = 'Sup3r-Secret-Pass-123';

    late ClerkAuthState authState;
    await tester.runAsync(() async {
      final config =
          ClerkAuthConfig(publishableKey: AppConfig.clerkPublishableKey);
      authState = await ClerkAuthState.create(config: config);
      if (authState.user != null) await authState.signOut();
      await authState.attemptSignUp(
        strategy: clerk.Strategy.password,
        emailAddress: email,
        password: password,
        passwordConfirmation: password,
        legalAccepted: true,
      );
      if (authState.user == null && authState.signUp != null) {
        await authState.attemptSignUp(strategy: clerk.Strategy.emailCode);
        await authState.attemptSignUp(
            strategy: clerk.Strategy.emailCode, code: '424242');
      }
    });
    final container = AppContainer(authState);
    await tester.pumpWidget(
        ProfitSyncApp(authState: authState, appState: container.state, themeController: ThemeController()));

    expect(await waitFor(tester, find.text('How will you use ProfitSync?')),
        isTrue);
    await tester.tap(find.text('Personal'));
    await pumpFor(tester, 6);
    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    expect(await waitFor(tester, find.text('Net balance')), isTrue);

    // Open the add-transaction sheet from the dashboard FAB.
    await tester.tap(find.widgetWithText(FloatingActionButton, 'Add'));
    await pumpFor(tester, 10);
    expect(find.text('New transaction'), findsOneWidget);

    // Amount + a default category chip ("Payment" is a default income category).
    await tester.enterText(find.byType(TextField).first, '500');
    await tester.pump();
    expect(await waitFor(tester, find.widgetWithText(ChoiceChip, 'Payment')),
        isTrue);
    await tester.tap(find.widgetWithText(ChoiceChip, 'Payment'));
    await tester.pump();
    await tester.ensureVisible(
        find.widgetWithText(FilledButton, 'Save transaction'));
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Save transaction'));

    // The sheet must close on success (returns to the dashboard).
    final stillOpen = await waitFor(
        tester, find.widgetWithText(FilledButton, 'Save transaction'),
        maxSeconds: 1);
    for (var i = 0; i < 60 && stillOpen; i++) {
      if (find.widgetWithText(FilledButton, 'Save transaction')
          .evaluate()
          .isEmpty) break;
      await tester.runAsync(() => Future.delayed(const Duration(milliseconds: 200)));
      await tester.pump();
    }
    expect(find.widgetWithText(FilledButton, 'Save transaction'), findsNothing,
        reason: 'Transaction sheet did not close — save failed');
  });
}
