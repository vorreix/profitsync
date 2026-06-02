import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_state.dart';
import '../theme.dart';
import '../widgets.dart';

void showOrgSwitcher(BuildContext context) {
  showModalBottomSheet(
    context: context,
    backgroundColor: Colors.transparent,
    builder: (_) => const _OrgSwitcherSheet(),
  );
}

class _OrgSwitcherSheet extends StatelessWidget {
  const _OrgSwitcherSheet();

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final scheme = Theme.of(context).colorScheme;

    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).scaffoldBackgroundColor,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 12),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: scheme.onSurfaceVariant.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(4),
              ),
            ),
            const SizedBox(height: 16),
            Align(
              alignment: Alignment.centerLeft,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Text('Workspaces',
                    style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: scheme.onSurface)),
              ),
            ),
            const SizedBox(height: 8),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.fromLTRB(12, 4, 12, 16),
                children: [
                  for (final org in state.orgs)
                    ListTile(
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14)),
                      leading: InitialsAvatar(
                        name: org.name,
                        size: 40,
                        color: org.isBusiness ? Brand.business : Brand.personal,
                      ),
                      title: Text(org.name,
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text(
                          '${org.isBusiness ? 'Business' : 'Personal'} · ${org.role}'),
                      trailing: org.id == state.activeOrgId
                          ? const Icon(Icons.check_circle_rounded,
                              color: Brand.income)
                          : null,
                      onTap: () {
                        Navigator.pop(context);
                        state.switchOrg(org.id);
                      },
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
