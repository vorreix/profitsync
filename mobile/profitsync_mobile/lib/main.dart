import 'package:clerk_flutter/clerk_flutter.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'api.dart';
import 'app_state.dart';
import 'config.dart';
import 'screens/auth/auth_flow.dart';
import 'screens/gate.dart';
import 'screens/splash.dart';
import 'theme.dart';

/// Wires the Clerk auth state to the API client (bearer token) and app state
/// (active org header). Kept as one object so `main()` and tests share the
/// exact same construction.
class AppContainer {
  AppContainer(this.authState) {
    api = ApiClient(
      tokenProvider: () async {
        if (authState.user == null) return null;
        try {
          final token = await authState.sessionToken();
          return token.jwt;
        } catch (_) {
          return null;
        }
      },
      orgIdProvider: () => state.activeOrgId,
    );
    state = AppState(api: api);
  }

  final ClerkAuthState authState;
  late final ApiClient api;
  late final AppState state;
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final config = ClerkAuthConfig(publishableKey: AppConfig.clerkPublishableKey);
  final authState = await ClerkAuthState.create(config: config);
  final container = AppContainer(authState);

  runApp(ProfitSyncApp(authState: authState, appState: container.state));
}

class ProfitSyncApp extends StatelessWidget {
  const ProfitSyncApp({
    super.key,
    required this.authState,
    required this.appState,
  });

  final ClerkAuthState authState;
  final AppState appState;

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider.value(
      value: appState,
      child: MaterialApp(
        title: 'ProfitSync',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light(),
        darkTheme: AppTheme.dark(),
        themeMode: ThemeMode.system,
        // ClerkAuth wraps the navigator (and all overlays/dialogs it pushes) so
        // `ClerkAuth.of(context)` resolves everywhere — including from sheets and
        // toasts. This is why ClerkAuth lives in `builder`, not as `home`.
        builder: (context, child) => ClerkAuth(
          authState: authState,
          child: ClerkErrorListener(child: child!),
        ),
        home: ClerkAuthBuilder(
          signedInBuilder: (context, _) => const Gate(),
          signedOutBuilder: (context, _) => const AuthFlow(),
          builder: (context, _) => const SplashScreen(),
        ),
      ),
    );
  }
}
