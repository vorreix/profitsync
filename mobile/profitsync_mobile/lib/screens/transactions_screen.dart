import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_state.dart';
import '../models.dart';
import '../theme.dart';
import '../util.dart';
import '../widgets.dart';
import 'transaction_form.dart';

class TransactionsScreen extends StatefulWidget {
  const TransactionsScreen({super.key});

  @override
  State<TransactionsScreen> createState() => _TransactionsScreenState();
}

class _TransactionsScreenState extends State<TransactionsScreen> {
  late Future<List<Transaction>> _future;
  String _filter = 'all'; // all | incoming | outgoing
  String _range = 'all'; // all | month | d30 | year
  String _sort = 'date_desc'; // date_desc | date_asc | amount_desc | amount_asc

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Transaction>> _load() async {
    final api = context.read<AppState>().api;
    final res = await api.get('/api/transactions');
    return (res as List)
        .map((e) => Transaction.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Apply the active type/date filters and sort order.
  List<Transaction> _apply(List<Transaction> all) {
    final now = DateTime.now();
    bool inRange(Transaction t) {
      if (_range == 'all') return true;
      final d = DateTime.tryParse(t.date);
      if (d == null) return true;
      switch (_range) {
        case 'month':
          return d.year == now.year && d.month == now.month;
        case 'd30':
          return d.isAfter(now.subtract(const Duration(days: 30)));
        case 'year':
          return d.year == now.year;
        default:
          return true;
      }
    }

    final list = all
        .where((t) => _filter == 'all' || t.type == _filter)
        .where(inRange)
        .toList();
    switch (_sort) {
      case 'date_asc':
        list.sort((a, b) => a.date.compareTo(b.date));
        break;
      case 'amount_desc':
        list.sort((a, b) => b.amount.compareTo(a.amount));
        break;
      case 'amount_asc':
        list.sort((a, b) => a.amount.compareTo(b.amount));
        break;
      case 'date_desc':
      default:
        list.sort((a, b) => b.date.compareTo(a.date));
    }
    return list;
  }

  Future<void> _refresh() async {
    setState(() {
      _future = _load();
    });
    await _future;
  }

  Future<void> _edit(Transaction t) async {
    if (!context.read<AppState>().canWrite) return;
    final ok = await openTransactionForm(context, existing: t);
    if (ok == true) _refresh();
  }

  Future<bool> _delete(Transaction t) async {
    final state = context.read<AppState>();
    if (!state.canDelete) {
      _toast('Only owners and admins can delete transactions.');
      return false;
    }
    try {
      await state.api.delete('/api/transactions/${t.id}');
      _toast('Transaction deleted');
      _refresh();
      return true;
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''));
      return false;
    }
  }

  void _toast(String m) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(title: const Text('Transactions')),
      floatingActionButton: state.canWrite
          ? FloatingActionButton.extended(
              onPressed: () async {
                final ok = await openTransactionForm(context);
                if (ok == true) _refresh();
              },
              icon: const Icon(Icons.add),
              label: const Text('Add'),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<Transaction>>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError) {
              return _ErrorList(message: '${snap.error}');
            }
            final all = snap.data ?? [];
            final txns = _apply(all);
            return Column(
              children: [
                _FilterBar(
                  value: _filter,
                  onChanged: (v) => setState(() => _filter = v),
                  range: _range,
                  onRangeChanged: (v) => setState(() => _range = v),
                  sort: _sort,
                  onSortChanged: (v) => setState(() => _sort = v),
                ),
                Expanded(
                  child: txns.isEmpty
                      ? ListView(
                          children: [
                            const SizedBox(height: 80),
                            EmptyState(
                              icon: Icons.receipt_long_rounded,
                              title: all.isEmpty
                                  ? 'No transactions'
                                  : 'No matches',
                              subtitle: all.isEmpty
                                  ? 'Tap Add to record your first transaction.'
                                  : 'Try a different filter or date range.',
                            ),
                          ],
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.fromLTRB(16, 4, 16, 110),
                          itemCount: txns.length,
                          itemBuilder: (context, i) {
                            final t = txns[i];
                            final tile = _TxnTile(
                              t: t,
                              currency: state.currency,
                              onTap: state.canWrite ? () => _edit(t) : null,
                            );
                            if (!state.canDelete) return tile;
                            return Dismissible(
                              key: ValueKey(t.id),
                              direction: DismissDirection.endToStart,
                              background: _deleteBg(),
                              confirmDismiss: (_) => _confirmDelete(t),
                              child: tile,
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

  Widget _deleteBg() => Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.only(right: 22),
        alignment: Alignment.centerRight,
        decoration: BoxDecoration(
          color: Brand.expense,
          borderRadius: BorderRadius.circular(14),
        ),
        child: const Icon(Icons.delete_outline_rounded, color: Colors.white),
      );

  Future<bool> _confirmDelete(Transaction t) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Delete transaction?'),
        content: const Text('This moves it to trash.'),
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
    if (ok != true) return false;
    return _delete(t);
  }
}

class _FilterBar extends StatelessWidget {
  const _FilterBar({
    required this.value,
    required this.onChanged,
    required this.range,
    required this.onRangeChanged,
    required this.sort,
    required this.onSortChanged,
  });
  final String value;
  final ValueChanged<String> onChanged;
  final String range;
  final ValueChanged<String> onRangeChanged;
  final String sort;
  final ValueChanged<String> onSortChanged;

  static const _ranges = {
    'all': 'All time',
    'month': 'This month',
    'd30': 'Last 30 days',
    'year': 'This year',
  };

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    Widget chip(String key, String label,
        {required bool selected, required ValueChanged<String> onTap}) {
      return Padding(
        padding: const EdgeInsets.only(right: 8),
        child: ChoiceChip(
          label: Text(label),
          selected: selected,
          showCheckmark: false,
          labelStyle: TextStyle(
            fontWeight: FontWeight.w600,
            color: selected ? scheme.onPrimary : scheme.onSurfaceVariant,
          ),
          selectedColor: scheme.primary,
          onSelected: (_) => onTap(key),
        ),
      );
    }

    return Column(
      children: [
        // Type filter + sort menu.
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 8, 4),
          child: Row(
            children: [
              Expanded(
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      chip('all', 'All',
                          selected: value == 'all', onTap: onChanged),
                      chip('incoming', 'Income',
                          selected: value == 'incoming', onTap: onChanged),
                      chip('outgoing', 'Expenses',
                          selected: value == 'outgoing', onTap: onChanged),
                    ],
                  ),
                ),
              ),
              _SortButton(sort: sort, onChanged: onSortChanged),
            ],
          ),
        ),
        // Date range.
        SizedBox(
          height: 44,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
            children: [
              for (final e in _ranges.entries)
                chip(e.key, e.value,
                    selected: range == e.key, onTap: onRangeChanged),
            ],
          ),
        ),
      ],
    );
  }
}

/// Reusable sort menu for list screens (date/amount/name).
class _SortButton extends StatelessWidget {
  const _SortButton({required this.sort, required this.onChanged});
  final String sort;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return PopupMenuButton<String>(
      tooltip: 'Sort',
      initialValue: sort,
      onSelected: onChanged,
      icon: Icon(Icons.swap_vert_rounded, color: scheme.onSurfaceVariant),
      itemBuilder: (_) => const [
        PopupMenuItem(value: 'date_desc', child: Text('Newest first')),
        PopupMenuItem(value: 'date_asc', child: Text('Oldest first')),
        PopupMenuItem(value: 'amount_desc', child: Text('Amount: high → low')),
        PopupMenuItem(value: 'amount_asc', child: Text('Amount: low → high')),
      ],
    );
  }
}

class _TxnTile extends StatelessWidget {
  const _TxnTile({required this.t, required this.currency, this.onTap});
  final Transaction t;
  final String currency;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = t.isIncoming ? Brand.income : Brand.expense;
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
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.13),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                      t.isIncoming
                          ? Icons.south_west_rounded
                          : Icons.north_east_rounded,
                      color: color,
                      size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        t.description.isNotEmpty
                            ? t.description
                            : (t.clientName ?? t.category),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: scheme.onSurface,
                            fontSize: 15),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        [
                          if (t.clientName != null && t.clientName!.isNotEmpty)
                            t.clientName,
                          if (t.category.isNotEmpty) t.category,
                          formatShortDate(t.date),
                        ].whereType<String>().join(' · '),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            color: scheme.onSurfaceVariant, fontSize: 12.5),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  '${t.isIncoming ? '+' : '-'}${formatMoney(t.amount, currency)}',
                  style: TextStyle(
                      color: color,
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                      fontFeatures: kTabular),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ErrorList extends StatelessWidget {
  const _ErrorList({required this.message});
  final String message;
  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        const SizedBox(height: 100),
        Center(
            child: Text('Failed to load\n$message',
                textAlign: TextAlign.center)),
      ],
    );
  }
}
