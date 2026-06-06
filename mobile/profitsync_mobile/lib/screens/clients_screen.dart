import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_state.dart';
import '../models.dart';
import '../theme.dart';
import '../util.dart';
import '../widgets.dart';
import 'client_detail_screen.dart';
import 'client_form.dart';

class ClientsScreen extends StatefulWidget {
  const ClientsScreen({super.key});

  @override
  State<ClientsScreen> createState() => _ClientsScreenState();
}

class _ClientsScreenState extends State<ClientsScreen> {
  late Future<List<Client>> _future;
  String _query = '';
  String _status = 'all'; // all | active | inactive | archived
  String _sort = 'name_asc'; // name_asc | name_desc | net_desc | net_asc

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Client>> _load() async {
    final api = context.read<AppState>().api;
    final res = await api.get('/api/clients');
    return (res as List)
        .map((e) => Client.fromJson(e as Map<String, dynamic>))
        .where((c) => !c.isOwn)
        .toList();
  }

  List<Client> _apply(List<Client> all) {
    final list = all.where((c) {
      if (_status != 'all' && c.status != _status) return false;
      if (_query.isEmpty) return true;
      return c.name.toLowerCase().contains(_query) ||
          c.company.toLowerCase().contains(_query) ||
          c.email.toLowerCase().contains(_query);
    }).toList();
    switch (_sort) {
      case 'name_desc':
        list.sort((a, b) => b.name.toLowerCase().compareTo(a.name.toLowerCase()));
        break;
      case 'net_desc':
        list.sort((a, b) => b.net.compareTo(a.net));
        break;
      case 'net_asc':
        list.sort((a, b) => a.net.compareTo(b.net));
        break;
      case 'name_asc':
      default:
        list.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    }
    return list;
  }

  Future<void> _refresh() async {
    setState(() { _future = _load(); });
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(title: const Text('Clients')),
      floatingActionButton: state.canWrite
          ? FloatingActionButton.extended(
              onPressed: () async {
                final ok = await openClientForm(context);
                if (ok == true) _refresh();
              },
              icon: const Icon(Icons.person_add_alt_1_rounded),
              label: const Text('New client'),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<Client>>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError) {
              return ListView(children: [
                const SizedBox(height: 100),
                Center(child: Text('Failed to load\n${snap.error}',
                    textAlign: TextAlign.center)),
              ]);
            }
            final all = snap.data ?? [];
            final clients = _apply(all);
            return Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                  child: Row(
                    children: [
                      Expanded(
                        child: TextField(
                          onChanged: (v) =>
                              setState(() => _query = v.trim().toLowerCase()),
                          decoration: const InputDecoration(
                            prefixIcon: Icon(Icons.search_rounded),
                            hintText: 'Search clients',
                          ),
                        ),
                      ),
                      _ClientSortButton(
                        sort: _sort,
                        onChanged: (v) => setState(() => _sort = v),
                      ),
                    ],
                  ),
                ),
                SizedBox(
                  height: 44,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
                    children: [
                      for (final e in const {
                        'all': 'All',
                        'active': 'Active',
                        'inactive': 'Inactive',
                        'archived': 'Archived',
                      }.entries)
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            label: Text(e.value),
                            selected: _status == e.key,
                            showCheckmark: false,
                            selectedColor:
                                Theme.of(context).colorScheme.primary,
                            labelStyle: TextStyle(
                              fontWeight: FontWeight.w600,
                              color: _status == e.key
                                  ? Theme.of(context).colorScheme.onPrimary
                                  : Theme.of(context)
                                      .colorScheme
                                      .onSurfaceVariant,
                            ),
                            onSelected: (_) =>
                                setState(() => _status = e.key),
                          ),
                        ),
                    ],
                  ),
                ),
                Expanded(
                  child: clients.isEmpty
                      ? ListView(children: [
                          const SizedBox(height: 60),
                          EmptyState(
                            icon: Icons.people_alt_rounded,
                            title: all.isEmpty
                                ? 'No clients yet'
                                : 'No matches',
                            subtitle: all.isEmpty
                                ? 'Add your first client to start tracking deals.'
                                : 'Try a different search.',
                          ),
                        ])
                      : ListView.builder(
                          padding:
                              const EdgeInsets.fromLTRB(16, 4, 16, 110),
                          itemCount: clients.length,
                          itemBuilder: (context, i) {
                            final c = clients[i];
                            return _ClientTile(
                              c: c,
                              currency: state.currency,
                              onTap: () async {
                                await Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) =>
                                        ClientDetailScreen(clientId: c.id),
                                  ),
                                );
                                _refresh();
                              },
                            );
                          },
                        ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _ClientSortButton extends StatelessWidget {
  const _ClientSortButton({required this.sort, required this.onChanged});
  final String sort;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      tooltip: 'Sort',
      initialValue: sort,
      onSelected: onChanged,
      icon: Icon(Icons.swap_vert_rounded,
          color: Theme.of(context).colorScheme.onSurfaceVariant),
      itemBuilder: (_) => const [
        PopupMenuItem(value: 'name_asc', child: Text('Name: A → Z')),
        PopupMenuItem(value: 'name_desc', child: Text('Name: Z → A')),
        PopupMenuItem(value: 'net_desc', child: Text('Net: high → low')),
        PopupMenuItem(value: 'net_asc', child: Text('Net: low → high')),
      ],
    );
  }
}

class _ClientTile extends StatelessWidget {
  const _ClientTile(
      {required this.c, required this.currency, required this.onTap});
  final Client c;
  final String currency;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Theme.of(context).dividerColor),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              children: [
                InitialsAvatar(name: c.name, size: 44),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(c.name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                    fontWeight: FontWeight.w700,
                                    fontSize: 15.5,
                                    color: scheme.onSurface)),
                          ),
                          const SizedBox(width: 8),
                          StatusChip(
                              label: c.status, color: statusColor(c.status)),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(
                        c.company.isNotEmpty ? c.company : (c.email.isNotEmpty ? c.email : 'No company'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            color: scheme.onSurfaceVariant, fontSize: 13),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          _Pill(
                            label: '+${formatCompactMoney(c.totalIncoming, currency)}',
                            color: Brand.income,
                          ),
                          const SizedBox(width: 6),
                          _Pill(
                            label: '-${formatCompactMoney(c.totalOutgoing, currency)}',
                            color: Brand.expense,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Align(
                              alignment: Alignment.centerRight,
                              child: FittedBox(
                                fit: BoxFit.scaleDown,
                                alignment: Alignment.centerRight,
                                child: Text(formatMoney(c.net, currency),
                                    maxLines: 1,
                                    style: TextStyle(
                                        fontWeight: FontWeight.w700,
                                        color: c.net >= 0
                                            ? Brand.income
                                            : Brand.expense)),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.label, required this.color});
  final String label;
  final Color color;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(label,
          style: TextStyle(
              color: color, fontWeight: FontWeight.w700, fontSize: 12)),
    );
  }
}
