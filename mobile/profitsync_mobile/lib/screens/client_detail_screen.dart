import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_state.dart';
import '../models.dart';
import '../theme.dart';
import '../util.dart';
import '../widgets.dart';
import 'client_form.dart';
import 'transaction_form.dart';

class ClientDetailScreen extends StatefulWidget {
  const ClientDetailScreen({super.key, required this.clientId});
  final String clientId;

  @override
  State<ClientDetailScreen> createState() => _ClientDetailScreenState();
}

class _ClientDetailScreenState extends State<ClientDetailScreen> {
  late Future<_ClientDetailData> _future;
  Client? _client;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_ClientDetailData> _load() async {
    final api = context.read<AppState>().api;
    final results = await Future.wait([
      api.get('/api/clients/${widget.clientId}'),
      api.get('/api/transactions?clientId=${widget.clientId}'),
    ]);
    final client = Client.fromJson(results[0] as Map<String, dynamic>);
    final txns = (results[1] as List)
        .map((e) => Transaction.fromJson(e as Map<String, dynamic>))
        .toList()
      ..sort((a, b) => b.date.compareTo(a.date));
    if (mounted) setState(() => _client = client);
    return _ClientDetailData(client, txns);
  }

  Future<void> _refresh() async {
    setState(() {
      _future = _load();
    });
    await _future;
  }

  void _toast(String m) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  Future<void> _editClient() async {
    if (_client == null) return;
    final ok = await openClientForm(context, existing: _client);
    if (ok == true) _refresh();
  }

  Future<void> _editTxn(Transaction t) async {
    if (!context.read<AppState>().canWrite) return;
    final ok = await openTransactionForm(context, existing: t);
    if (ok == true) _refresh();
  }

  Future<void> _deleteClient() async {
    final c = _client;
    if (c == null) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text('Delete ${c.name}?'),
        content: const Text(
            'The client and its transactions move to trash. You can restore from Trash.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(d, false),
              child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Brand.expense),
            onPressed: () => Navigator.pop(d, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    final nav = Navigator.of(context);
    final api = context.read<AppState>().api;
    try {
      await api.delete('/api/clients/${c.id}');
      _toast('Client deleted');
      nav.pop(true);
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''));
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final c = _client;
    final canEdit = c != null && !c.isOwn && state.canWrite;
    return Scaffold(
      appBar: AppBar(
        actions: [
          if (canEdit)
            IconButton(
              tooltip: 'Edit client',
              icon: const Icon(Icons.edit_outlined),
              onPressed: _editClient,
            ),
          if (c != null && !c.isOwn && state.canDelete)
            IconButton(
              tooltip: 'Delete client',
              icon: const Icon(Icons.delete_outline_rounded),
              onPressed: _deleteClient,
            ),
        ],
      ),
      floatingActionButton: state.canWrite
          ? FloatingActionButton.extended(
              onPressed: () async {
                final ok = await openTransactionForm(context,
                    clientId: widget.clientId);
                if (ok == true) _refresh();
              },
              icon: const Icon(Icons.add),
              label: const Text('Transaction'),
            )
          : null,
      body: FutureBuilder<_ClientDetailData>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return Center(child: Text('Failed to load\n${snap.error}',
                textAlign: TextAlign.center));
          }
          final data = snap.data!;
          final c = data.client;
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 110),
              children: [
                Row(
                  children: [
                    InitialsAvatar(name: c.name, size: 60),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(c.name,
                              style: const TextStyle(
                                  fontSize: 22,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: -0.4)),
                          if (c.company.isNotEmpty)
                            Text(c.company,
                                style: TextStyle(
                                    color: Theme.of(context)
                                        .colorScheme
                                        .onSurfaceVariant)),
                          const SizedBox(height: 6),
                          StatusChip(
                              label: c.status, color: statusColor(c.status)),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                Row(
                  children: [
                    Expanded(
                      child: _SummaryBox(
                        label: 'Received',
                        value: formatMoney(c.totalIncoming, state.currency),
                        color: Brand.income,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _SummaryBox(
                        label: 'Paid out',
                        value: formatMoney(c.totalOutgoing, state.currency),
                        color: Brand.expense,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _SummaryBox(
                  label: 'Net',
                  value: formatMoney(c.net, state.currency),
                  color: c.net >= 0 ? Brand.income : Brand.expense,
                  wide: true,
                ),
                if (c.email.isNotEmpty || c.phone.isNotEmpty) ...[
                  const SizedBox(height: 18),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Theme.of(context).cardColor,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: Theme.of(context).dividerColor),
                    ),
                    child: Column(
                      children: [
                        if (c.email.isNotEmpty)
                          _ContactRow(
                              icon: Icons.mail_outline_rounded, text: c.email),
                        if (c.email.isNotEmpty && c.phone.isNotEmpty)
                          const Divider(height: 18),
                        if (c.phone.isNotEmpty)
                          _ContactRow(
                              icon: Icons.phone_outlined, text: c.phone),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 22),
                Text('Transactions',
                    style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                        color: Theme.of(context).colorScheme.onSurface)),
                const SizedBox(height: 10),
                if (data.txns.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 20),
                    child: Center(
                      child: Text('No transactions for this client yet',
                          style: TextStyle(
                              color: Theme.of(context)
                                  .colorScheme
                                  .onSurfaceVariant)),
                    ),
                  )
                else
                  ...data.txns.map((t) => _TxnLine(
                        t: t,
                        currency: state.currency,
                        onTap: state.canWrite ? () => _editTxn(t) : null,
                      )),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _SummaryBox extends StatelessWidget {
  const _SummaryBox({
    required this.label,
    required this.value,
    required this.color,
    this.wide = false,
  });
  final String label;
  final String value;
  final Color color;
  final bool wide;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: wide ? double.infinity : null,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Theme.of(context).dividerColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                  fontSize: 13,
                  fontWeight: FontWeight.w500)),
          const SizedBox(height: 4),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(value,
                style: TextStyle(
                    color: color,
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.5)),
          ),
        ],
      ),
    );
  }
}

class _ContactRow extends StatelessWidget {
  const _ContactRow({required this.icon, required this.text});
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18, color: Theme.of(context).colorScheme.onSurfaceVariant),
        const SizedBox(width: 10),
        Expanded(child: Text(text)),
      ],
    );
  }
}

class _TxnLine extends StatelessWidget {
  const _TxnLine({required this.t, required this.currency, this.onTap});
  final Transaction t;
  final String currency;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = t.isIncoming ? Brand.income : Brand.expense;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: Theme.of(context).cardColor,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Theme.of(context).dividerColor),
        ),
        child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.13),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(
                t.isIncoming
                    ? Icons.south_west_rounded
                    : Icons.north_east_rounded,
                color: color,
                size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                    t.description.isNotEmpty ? t.description : t.category,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: scheme.onSurface)),
                Text(formatShortDate(t.date),
                    style: TextStyle(
                        color: scheme.onSurfaceVariant, fontSize: 12.5)),
              ],
            ),
          ),
            Text(
                '${t.isIncoming ? '+' : '-'}${formatMoney(t.amount, currency)}',
                style: TextStyle(color: color, fontWeight: FontWeight.w700)),
          ],
        ),
      ),
    );
  }
}

class _ClientDetailData {
  final Client client;
  final List<Transaction> txns;
  _ClientDetailData(this.client, this.txns);
}
