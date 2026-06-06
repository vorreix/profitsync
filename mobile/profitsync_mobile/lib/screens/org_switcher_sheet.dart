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
                padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
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
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text(
                          '${org.isBusiness ? 'Business' : 'Personal'} · ${org.role}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis),
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
            const Divider(height: 1),
            ListTile(
              leading: Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: scheme.primary.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(Icons.add_rounded, color: scheme.primary),
              ),
              title: const Text('Create workspace',
                  style: TextStyle(fontWeight: FontWeight.w700)),
              subtitle: const Text('A separate business workspace with its own data'),
              onTap: () async {
                Navigator.pop(context);
                await _showCreateOrgDialog(context);
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}

Future<void> _showCreateOrgDialog(BuildContext context) async {
  final state = context.read<AppState>();
  final messenger = ScaffoldMessenger.of(context);
  await showDialog<void>(
    context: context,
    builder: (_) => _CreateOrgDialog(state: state, messenger: messenger),
  );
}

class _CreateOrgDialog extends StatefulWidget {
  const _CreateOrgDialog({required this.state, required this.messenger});
  final AppState state;
  final ScaffoldMessengerState messenger;

  @override
  State<_CreateOrgDialog> createState() => _CreateOrgDialogState();
}

class _CreateOrgDialogState extends State<_CreateOrgDialog> {
  final _ctrl = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    final name = _ctrl.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Enter a workspace name');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.state.createOrg(name);
      if (mounted) Navigator.pop(context);
      widget.messenger.showSnackBar(
        SnackBar(content: Text('Switched to "$name"')),
      );
    } catch (e) {
      setState(() {
        _busy = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Create workspace'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: _ctrl,
            autofocus: true,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(hintText: 'e.g. Acme Inc.'),
            onSubmitted: (_) => _busy ? null : _create(),
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(_error!,
                style: const TextStyle(color: Brand.expense, fontSize: 13)),
          ],
        ],
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _busy ? null : _create,
          child: _busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                      strokeWidth: 2.2, color: Colors.white))
              : const Text('Create'),
        ),
      ],
    );
  }
}
