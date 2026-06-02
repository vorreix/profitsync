import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:profitsync_mobile/api.dart';
import 'package:profitsync_mobile/app_state.dart';
import 'package:profitsync_mobile/screens/dashboard_screen.dart';
import 'package:profitsync_mobile/screens/home_shell.dart';
import 'package:profitsync_mobile/screens/onboarding_screen.dart';
import 'package:profitsync_mobile/screens/transactions_screen.dart';
import 'package:profitsync_mobile/theme.dart';

/// In-memory API stand-in so screens can be exercised without a network.
class FakeApi extends ApiClient {
  FakeApi({this.onboarded = false})
      : super(tokenProvider: _noToken, orgIdProvider: _org);

  static Future<String?> _noToken() async => 'test-token';
  static String? _org() => 'org_1';

  bool onboarded;
  final List<Map<String, dynamic>> posted = [];

  Map<String, dynamic> get _profile => {
        'id': 'user_1',
        'email': 'jane@acme.com',
        'full_name': 'Jane Doe',
        'currency': 'USD',
        'language': 'en',
        'current_organization_id': 'org_1',
        'onboarded_at': onboarded ? '2026-01-01T00:00:00Z' : null,
      };

  List<Map<String, dynamic>> get _orgs => [
        {
          'id': 'org_1',
          'name': 'Acme Inc.',
          'slug': 'acme',
          'is_personal': false,
          'account_type': 'business',
          'currency': 'USD',
          'role': 'owner',
          'plan_key': 'free',
          'plan_status': 'active',
        }
      ];

  final List<Map<String, dynamic>> _clients = [
    {
      'id': 'c1',
      'name': 'Globex',
      'company': 'Globex Corp',
      'email': 'hi@globex.com',
      'phone': '',
      'status': 'active',
      'notes': '',
      'is_own': false,
      'total_incoming': 1200,
      'total_outgoing': 200,
    },
    {
      'id': 'own',
      'name': 'Acme Inc.',
      'company': '',
      'email': '',
      'phone': '',
      'status': 'active',
      'notes': '',
      'is_own': true,
      'total_incoming': 0,
      'total_outgoing': 0,
    },
  ];

  final List<Map<String, dynamic>> _txns = [
    {
      'id': 't1',
      'client_id': 'c1',
      'client_name': 'Globex',
      'type': 'incoming',
      'amount': 1200,
      'description': 'Invoice #100',
      'category': 'Sales',
      'date': '2026-05-20',
    },
    {
      'id': 't2',
      'client_id': 'c1',
      'client_name': 'Globex',
      'type': 'outgoing',
      'amount': 200,
      'description': 'Hosting',
      'category': 'Infra',
      'date': '2026-05-18',
    },
  ];

  @override
  Future<dynamic> get(String path, {bool useCache = true}) async {
    if (path == '/api/profile') return _profile;
    if (path == '/api/organizations') return _orgs;
    if (path == '/api/clients') return _clients;
    if (path.startsWith('/api/transactions')) return _txns;
    if (path == '/api/quotations') return <dynamic>[];
    return <dynamic>[];
  }

  @override
  Future<dynamic> post(String path, [dynamic body]) async {
    posted.add({'path': path, 'body': body});
    if (path == '/api/onboarding') {
      onboarded = true;
      return {'organization_id': 'org_1', 'account_type': body['account_type']};
    }
    return {'id': 'new'};
  }

  @override
  Future<dynamic> patch(String path, [dynamic body]) async => {'ok': true};

  @override
  Future<dynamic> delete(String path, [dynamic body]) async => {'ok': true};

  @override
  void clearCache() {}
}

Widget _wrap(AppState state, Widget child) {
  return ChangeNotifierProvider.value(
    value: state,
    child: MaterialApp(theme: AppTheme.light(), home: child),
  );
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('onboarding lets you choose an account type and completes',
      (tester) async {
    final api = FakeApi(onboarded: false);
    final state = AppState(api: api);
    await state.bootstrap();
    expect(state.needsOnboarding, isTrue);

    await tester.pumpWidget(_wrap(state, const OnboardingScreen()));
    await tester.pump();

    expect(find.text('How will you use ProfitSync?'), findsOneWidget);
    expect(find.text('Personal'), findsOneWidget);
    expect(find.text('Business'), findsOneWidget);
    // Greeting uses the profile name we already fetched.
    expect(find.textContaining('Jane'), findsOneWidget);

    // Continue is disabled until a choice is made.
    final continueBtn = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Continue'),
    );
    expect(continueBtn.onPressed, isNull);

    await tester.tap(find.text('Personal'));
    await tester.pump();

    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    // Onboarding POST fired with the chosen account type.
    expect(api.posted.any((p) => p['path'] == '/api/onboarding'), isTrue);
    expect(api.posted.first['body']['account_type'], 'personal');
    expect(state.needsOnboarding, isFalse);
  });

  testWidgets('dashboard renders net balance and recent activity',
      (tester) async {
    final state = AppState(api: FakeApi(onboarded: true));
    await state.bootstrap();

    await tester.pumpWidget(_wrap(state, const DashboardScreen()));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.text('Net balance'), findsOneWidget);
    expect(find.text('Income'), findsOneWidget);
    expect(find.text('Expenses'), findsOneWidget);
    // Net = 1200 - 200 = 1000 → "$1,000".
    expect(find.textContaining('1,000'), findsWidgets);
    expect(find.text('Invoice #100'), findsOneWidget);
  });

  testWidgets('transactions screen lists and filters', (tester) async {
    final state = AppState(api: FakeApi(onboarded: true));
    await state.bootstrap();

    await tester.pumpWidget(_wrap(state, const TransactionsScreen()));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.text('Invoice #100'), findsOneWidget);
    expect(find.text('Hosting'), findsOneWidget);

    // Filter to expenses only.
    await tester.tap(find.text('Expenses'));
    await tester.pump();
    expect(find.text('Hosting'), findsOneWidget);
    expect(find.text('Invoice #100'), findsNothing);
  });

  testWidgets('home shell shows business tabs and switches', (tester) async {
    final state = AppState(api: FakeApi(onboarded: true));
    await state.bootstrap();

    await tester.pumpWidget(_wrap(state, const HomeShell()));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    // Business workspace → Clients + Quotes tabs present.
    expect(find.text('Clients'), findsWidgets);
    expect(find.text('Quotes'), findsWidgets);
    expect(find.text('Home'), findsWidgets);

    await tester.tap(find.text('Transactions'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.byType(TransactionsScreen), findsOneWidget);
  });
}
