import 'package:clerk_flutter/clerk_flutter.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_state.dart';
import '../theme.dart';
import '../widgets.dart';
import 'org_switcher_sheet.dart';
import 'subscription_screen.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final scheme = Theme.of(context).colorScheme;
    final profile = state.profile;
    final org = state.activeOrg;
    final name =
        (profile?.fullName.isNotEmpty ?? false) ? profile!.fullName : 'Your account';

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
        children: [
          // Identity header
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: Theme.of(context).cardColor,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: Theme.of(context).dividerColor),
            ),
            child: Row(
              children: [
                InitialsAvatar(name: name, size: 56),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w800,
                              color: scheme.onSurface)),
                      if (profile?.email.isNotEmpty ?? false)
                        Text(profile!.email,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(color: scheme.onSurfaceVariant)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          _SectionLabel('Workspace'),
          _Card(
            children: [
              _Tile(
                icon: org?.isBusiness == true
                    ? Icons.business_rounded
                    : Icons.person_rounded,
                iconColor: org?.isBusiness == true ? Brand.business : Brand.personal,
                title: org?.name ?? '—',
                subtitle:
                    '${org?.isBusiness == true ? 'Business' : 'Personal'} workspace',
                trailing: const Icon(Icons.swap_horiz_rounded),
                onTap: () => showOrgSwitcher(context),
              ),
              const Divider(height: 1),
              _Tile(
                icon: Icons.payments_outlined,
                title: 'Plan',
                subtitle: (org?.isPremium ?? false)
                    ? 'Premium · manage subscription'
                    : 'Free · upgrade available',
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _PlanBadge(premium: org?.isPremium ?? false),
                    const SizedBox(width: 6),
                    Icon(Icons.chevron_right_rounded,
                        color: Theme.of(context).colorScheme.onSurfaceVariant),
                  ],
                ),
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                      builder: (_) => const SubscriptionScreen()),
                ),
              ),
              const Divider(height: 1),
              _Tile(
                icon: Icons.attach_money_rounded,
                title: 'Currency',
                subtitle: state.currency,
              ),
            ],
          ),
          const SizedBox(height: 16),

          _SectionLabel('Account'),
          _Card(
            children: [
              _Tile(
                icon: Icons.refresh_rounded,
                title: 'Refresh data',
                onTap: () => context.read<AppState>().refresh(),
              ),
              const Divider(height: 1),
              _Tile(
                icon: Icons.logout_rounded,
                iconColor: Brand.expense,
                title: 'Sign out',
                titleColor: Brand.expense,
                onTap: () => _confirmSignOut(context),
              ),
            ],
          ),
          const SizedBox(height: 24),
          Center(
            child: Text('ProfitSync · Mobile',
                style: TextStyle(
                    color: scheme.onSurfaceVariant, fontSize: 12.5)),
          ),
        ],
      ),
    );
  }

  void _confirmSignOut(BuildContext context) {
    showDialog(
      context: context,
      builder: (dctx) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text('You can sign back in any time.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dctx),
              child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              Navigator.pop(dctx);
              context.read<AppState>().reset();
              ClerkAuth.of(context, listen: false).signOut();
            },
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(6, 4, 6, 8),
      child: Text(text.toUpperCase(),
          style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.8,
              color: Theme.of(context).colorScheme.onSurfaceVariant)),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Theme.of(context).dividerColor),
      ),
      child: Column(children: children),
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.iconColor,
    this.titleColor,
  });
  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final Color? iconColor;
  final Color? titleColor;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final c = iconColor ?? scheme.primary;
    return ListTile(
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      leading: Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(
          color: c.withValues(alpha: 0.13),
          borderRadius: BorderRadius.circular(11),
        ),
        child: Icon(icon, color: c, size: 20),
      ),
      title: Text(title,
          style: TextStyle(
              fontWeight: FontWeight.w600,
              color: titleColor ?? scheme.onSurface)),
      subtitle: subtitle != null ? Text(subtitle!) : null,
      trailing: trailing,
    );
  }
}

class _PlanBadge extends StatelessWidget {
  const _PlanBadge({required this.premium});
  final bool premium;
  @override
  Widget build(BuildContext context) {
    final color = premium ? Brand.amber : const Color(0xFF94A3B8);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(premium ? 'PREMIUM' : 'FREE',
          style: TextStyle(
              color: color, fontWeight: FontWeight.w800, fontSize: 11)),
    );
  }
}
