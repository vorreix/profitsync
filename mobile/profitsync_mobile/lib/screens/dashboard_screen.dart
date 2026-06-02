import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_state.dart';
import '../models.dart';
import '../theme.dart';
import '../util.dart';
import '../widgets.dart';
import 'org_switcher_sheet.dart';
import 'transaction_form.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  late Future<_DashData> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_DashData> _load() async {
    final api = context.read<AppState>().api;
    final results = await Future.wait([
      api.get('/api/clients').catchError((_) => <dynamic>[]),
      api.get('/api/transactions'),
    ]);
    final clients = (results[0] as List)
        .map((e) => Client.fromJson(e as Map<String, dynamic>))
        .toList();
    final txns = (results[1] as List)
        .map((e) => Transaction.fromJson(e as Map<String, dynamic>))
        .toList();
    return _DashData(clients, txns);
  }

  Future<void> _refresh() async {
    setState(() { _future = _load(); });
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final org = state.activeOrg;

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: CustomScrollView(
          slivers: [
            SliverAppBar(
              floating: true,
              titleSpacing: 16,
              title: _OrgButton(
                name: org?.name ?? 'ProfitSync',
                subtitle: org?.isBusiness == true ? 'Business' : 'Personal',
                onTap: () => showOrgSwitcher(context),
              ),
            ),
            SliverToBoxAdapter(
              child: FutureBuilder<_DashData>(
                future: _future,
                builder: (context, snap) {
                  if (snap.connectionState == ConnectionState.waiting) {
                    return const Padding(
                      padding: EdgeInsets.only(top: 120),
                      child: Center(child: CircularProgressIndicator()),
                    );
                  }
                  if (snap.hasError) {
                    return Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text('Failed to load: ${snap.error}'),
                    );
                  }
                  final data = snap.data!;
                  return _Content(data: data, currency: state.currency);
                },
              ),
            ),
          ],
        ),
      ),
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
    );
  }
}

class _Content extends StatelessWidget {
  const _Content({required this.data, required this.currency});
  final _DashData data;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final income =
        data.txns.where((t) => t.isIncoming).fold<double>(0, (s, t) => s + t.amount);
    final expense = data.txns
        .where((t) => !t.isIncoming)
        .fold<double>(0, (s, t) => s + t.amount);
    final net = income - expense;
    final recent = [...data.txns]..sort((a, b) => b.date.compareTo(a.date));
    final topClients = data.clients.where((c) => !c.isOwn).toList()
      ..sort((a, b) => b.net.abs().compareTo(a.net.abs()));

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 110),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _NetCard(net: net, currency: currency),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _MiniStat(
                  label: 'Income',
                  value: formatMoney(income, currency),
                  color: Brand.income,
                  icon: Icons.south_west_rounded,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _MiniStat(
                  label: 'Expenses',
                  value: formatMoney(expense, currency),
                  color: Brand.expense,
                  icon: Icons.north_east_rounded,
                ),
              ),
            ],
          ),
          if (topClients.isNotEmpty) ...[
            const SizedBox(height: 26),
            _SectionHeader(title: 'Top clients'),
            const SizedBox(height: 10),
            ...topClients.take(3).map((c) => _ClientRow(c: c, currency: currency)),
          ],
          const SizedBox(height: 26),
          _SectionHeader(title: 'Recent transactions'),
          const SizedBox(height: 10),
          if (recent.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Center(
                child: Text('No transactions yet',
                    style: TextStyle(
                        color: Theme.of(context).colorScheme.onSurfaceVariant)),
              ),
            )
          else
            ...recent.take(8).map((t) => _TxnRow(t: t, currency: currency)),
        ],
      ),
    );
  }
}

class _NetCard extends StatelessWidget {
  const _NetCard({required this.net, required this.currency});
  final double net;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final positive = net >= 0;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: LinearGradient(
          colors: positive
              ? [Brand.income, const Color(0xFF059669)]
              : [const Color(0xFFFB7185), const Color(0xFFE11D48)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        boxShadow: [
          BoxShadow(
            color: (positive ? Brand.income : Brand.expense)
                .withValues(alpha: 0.32),
            blurRadius: 24,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Net balance',
              style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.85),
                  fontSize: 14,
                  fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Text(
            formatMoney(net, currency),
            style: const TextStyle(
              color: Colors.white,
              fontSize: 36,
              fontWeight: FontWeight.w800,
              letterSpacing: -1,
            ),
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Icon(positive ? Icons.trending_up : Icons.trending_down,
                  color: Colors.white.withValues(alpha: 0.9), size: 18),
              const SizedBox(width: 6),
              Text(positive ? 'In the green' : 'Spending exceeds income',
                  style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.9),
                      fontSize: 13)),
            ],
          ),
        ],
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  const _MiniStat({
    required this.label,
    required this.value,
    required this.color,
    required this.icon,
  });
  final String label;
  final String value;
  final Color color;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Theme.of(context).dividerColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.13),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: color, size: 19),
          ),
          const SizedBox(height: 12),
          Text(label,
              style: TextStyle(
                  color: scheme.onSurfaceVariant,
                  fontSize: 13,
                  fontWeight: FontWeight.w500)),
          const SizedBox(height: 2),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(value,
                style: TextStyle(
                    color: scheme.onSurface,
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.5)),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});
  final String title;
  @override
  Widget build(BuildContext context) {
    return Text(title,
        style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.3,
            color: Theme.of(context).colorScheme.onSurface));
  }
}

class _TxnRow extends StatelessWidget {
  const _TxnRow({required this.t, required this.currency});
  final Transaction t;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = t.isIncoming ? Brand.income : Brand.expense;
    return Container(
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
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.13),
              borderRadius: BorderRadius.circular(11),
            ),
            child: Icon(
                t.isIncoming
                    ? Icons.south_west_rounded
                    : Icons.north_east_rounded,
                color: color,
                size: 19),
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
                      fontSize: 14.5),
                ),
                const SizedBox(height: 2),
                Text(
                  '${t.clientName ?? t.category} · ${formatShortDate(t.date)}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style:
                      TextStyle(color: scheme.onSurfaceVariant, fontSize: 12.5),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '${t.isIncoming ? '+' : '-'}${formatMoney(t.amount, currency)}',
            style: TextStyle(
                color: color, fontWeight: FontWeight.w700, fontSize: 14.5),
          ),
        ],
      ),
    );
  }
}

class _ClientRow extends StatelessWidget {
  const _ClientRow({required this.c, required this.currency});
  final Client c;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final positive = c.net >= 0;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Theme.of(context).dividerColor),
      ),
      child: Row(
        children: [
          InitialsAvatar(name: c.name, size: 38),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(c.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: scheme.onSurface,
                        fontSize: 14.5)),
                if (c.company.isNotEmpty)
                  Text(c.company,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          color: scheme.onSurfaceVariant, fontSize: 12.5)),
              ],
            ),
          ),
          Text(formatMoney(c.net, currency),
              style: TextStyle(
                  color: positive ? Brand.income : Brand.expense,
                  fontWeight: FontWeight.w700,
                  fontSize: 14.5)),
        ],
      ),
    );
  }
}

class _OrgButton extends StatelessWidget {
  const _OrgButton(
      {required this.name, required this.subtitle, required this.onTap});
  final String name;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(subtitle.toUpperCase(),
                    style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.8,
                        color: scheme.onSurfaceVariant)),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 200),
                      child: Text(name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              fontSize: 21,
                              fontWeight: FontWeight.w800,
                              letterSpacing: -0.5,
                              color: scheme.onSurface)),
                    ),
                    Icon(Icons.expand_more_rounded,
                        color: scheme.onSurfaceVariant, size: 22),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _DashData {
  final List<Client> clients;
  final List<Transaction> txns;
  _DashData(this.clients, this.txns);
}
