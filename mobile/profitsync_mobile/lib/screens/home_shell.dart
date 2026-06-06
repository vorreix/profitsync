import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_state.dart';
import 'clients_screen.dart';
import 'dashboard_screen.dart';
import 'profile_screen.dart';
import 'quotations_screen.dart';
import 'transactions_screen.dart';

/// Bottom-tab shell. Tabs adapt to the workspace type: business workspaces get
/// Clients + Quotations; personal workspaces keep it to the essentials.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final isBusiness = app.isBusiness;
    final orgId = app.activeOrgId;

    final tabs = <_Tab>[
      _Tab(
        icon: Icons.space_dashboard_outlined,
        active: Icons.space_dashboard_rounded,
        label: 'Home',
        screen: const DashboardScreen(),
      ),
      if (isBusiness)
        _Tab(
          icon: Icons.people_alt_outlined,
          active: Icons.people_alt_rounded,
          label: 'Clients',
          screen: const ClientsScreen(),
        ),
      _Tab(
        icon: Icons.receipt_long_outlined,
        active: Icons.receipt_long_rounded,
        label: 'Transactions',
        screen: const TransactionsScreen(),
      ),
      if (isBusiness)
        _Tab(
          icon: Icons.description_outlined,
          active: Icons.description_rounded,
          label: 'Quotes',
          screen: const QuotationsScreen(),
        ),
      _Tab(
        icon: Icons.person_outline_rounded,
        active: Icons.person_rounded,
        label: 'Profile',
        screen: const ProfileScreen(),
      ),
    ];

    final safeIndex = _index.clamp(0, tabs.length - 1);

    return Scaffold(
      // Render only the active tab so revisiting a tab re-mounts it and reloads
      // its data (served from the API GET cache when still fresh). This keeps
      // data consistent across tabs after edits made elsewhere. Keying on the
      // active org id forces a fresh load of the current tab right after an org
      // switch, so the screen never shows the previous workspace's data.
      body: KeyedSubtree(
        key: ValueKey('${orgId ?? 'none'}#$safeIndex'),
        child: tabs[safeIndex].screen,
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: safeIndex,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          for (final t in tabs)
            NavigationDestination(
              icon: Icon(t.icon),
              selectedIcon: Icon(t.active),
              label: t.label,
            ),
        ],
      ),
    );
  }
}

class _Tab {
  _Tab({
    required this.icon,
    required this.active,
    required this.label,
    required this.screen,
  });
  final IconData icon;
  final IconData active;
  final String label;
  final Widget screen;
}
