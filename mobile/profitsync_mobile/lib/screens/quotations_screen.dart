import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../app_state.dart';
import '../models.dart';
import '../theme.dart';
import '../util.dart';
import '../widgets.dart';

class QuotationsScreen extends StatefulWidget {
  const QuotationsScreen({super.key});

  @override
  State<QuotationsScreen> createState() => _QuotationsScreenState();
}

class _QuotationsScreenState extends State<QuotationsScreen> {
  late Future<List<Quotation>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Quotation>> _load() async {
    final api = context.read<AppState>().api;
    final res = await api.get('/api/quotations');
    return (res as List)
        .map((e) => Quotation.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> _refresh() async {
    setState(() { _future = _load(); });
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(title: const Text('Quotations')),
      floatingActionButton: state.canWrite
          ? FloatingActionButton.extended(
              onPressed: () async {
                final ok = await _openForm(context);
                if (ok == true) _refresh();
              },
              icon: const Icon(Icons.add),
              label: const Text('New quote'),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<Quotation>>(
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
            final quotes = snap.data ?? [];
            if (quotes.isEmpty) {
              return ListView(children: [
                const SizedBox(height: 60),
                EmptyState(
                  icon: Icons.description_rounded,
                  title: 'No quotations',
                  subtitle: 'Create a quote and convert it to a client later.',
                ),
              ]);
            }
            return ListView.builder(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 110),
              itemCount: quotes.length,
              itemBuilder: (context, i) {
                final q = quotes[i];
                final tile = _QuoteTile(
                  q: q,
                  currency: state.currency,
                  onTap: state.canWrite ? () => _edit(q) : null,
                );
                if (!state.canDelete) return tile;
                return Dismissible(
                  key: ValueKey(q.id),
                  direction: DismissDirection.endToStart,
                  background: Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.only(right: 22),
                    alignment: Alignment.centerRight,
                    decoration: BoxDecoration(
                      color: Brand.expense,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(Icons.delete_outline_rounded,
                        color: Colors.white),
                  ),
                  confirmDismiss: (_) => _confirmDelete(q),
                  child: tile,
                );
              },
            );
          },
        ),
      ),
    );
  }

  Future<void> _edit(Quotation q) async {
    final ok = await _openForm(context, existing: q);
    if (ok == true) _refresh();
  }

  void _toast(String m) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  Future<bool> _confirmDelete(Quotation q) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Delete quotation?'),
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
    final api = context.read<AppState>().api;
    try {
      await api.delete('/api/quotations/${q.id}');
      _toast('Quotation deleted');
      _refresh();
      return true;
    } catch (e) {
      _toast(e.toString().replaceFirst('Exception: ', ''));
      return false;
    }
  }

  Future<bool?> _openForm(BuildContext context, {Quotation? existing}) {
    return showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _QuotationForm(existing: existing),
    );
  }
}

class _QuoteTile extends StatelessWidget {
  const _QuoteTile({required this.q, required this.currency, this.onTap});
  final Quotation q;
  final String currency;
  final VoidCallback? onTap;

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
            padding: const EdgeInsets.all(14),
            child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(q.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 15.5,
                        color: scheme.onSurface)),
              ),
              const SizedBox(width: 8),
              StatusChip(label: q.status, color: statusColor(q.status)),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            [
              if (q.prospectName.isNotEmpty) q.prospectName,
              if (q.company.isNotEmpty) q.company,
            ].join(' · '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13),
          ),
          const SizedBox(height: 10),
          Text(formatMoney(q.amount, currency),
              style: TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 18,
                  letterSpacing: -0.4,
                  color: scheme.onSurface)),
            ],
          ),
            ),
          ),
        ),
      );
  }
}

class _QuotationForm extends StatefulWidget {
  const _QuotationForm({this.existing});
  final Quotation? existing;

  @override
  State<_QuotationForm> createState() => _QuotationFormState();
}

class _QuotationFormState extends State<_QuotationForm> {
  late final TextEditingController _title;
  late final TextEditingController _prospect;
  late final TextEditingController _company;
  late final TextEditingController _email;
  late final TextEditingController _amount;
  late String _status;
  bool _saving = false;
  String? _error;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final q = widget.existing;
    _title = TextEditingController(text: q?.title ?? '');
    _prospect = TextEditingController(text: q?.prospectName ?? '');
    _company = TextEditingController(text: q?.company ?? '');
    _email = TextEditingController(text: q?.email ?? '');
    _amount = TextEditingController(
        text: q != null && q.amount > 0
            ? (q.amount % 1 == 0
                ? q.amount.toStringAsFixed(0)
                : q.amount.toString())
            : '');
    _status = q?.status ?? 'draft';
  }

  @override
  void dispose() {
    _title.dispose();
    _prospect.dispose();
    _company.dispose();
    _email.dispose();
    _amount.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    FocusScope.of(context).unfocus();
    if (_title.text.trim().isEmpty || _prospect.text.trim().isEmpty) {
      setState(() => _error = 'Title and prospect name are required');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final api = context.read<AppState>().api;
    final body = {
      'title': _title.text.trim(),
      'prospect_name': _prospect.text.trim(),
      'company': _company.text.trim(),
      'email': _email.text.trim(),
      'amount': double.tryParse(_amount.text.trim()) ?? 0,
      'status': _status,
    };
    try {
      if (_isEdit) {
        await api.patch('/api/quotations/${widget.existing!.id}', body);
      } else {
        await api.post('/api/quotations', body);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      setState(() {
        _saving = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        decoration: BoxDecoration(
          color: Theme.of(context).scaffoldBackgroundColor,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: SafeArea(
          top: false,
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: scheme.onSurfaceVariant.withValues(alpha: 0.3),
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                Text(_isEdit ? 'Edit quotation' : 'New quotation',
                    style: TextStyle(
                        fontSize: 21,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.4,
                        color: scheme.onSurface)),
                const SizedBox(height: 18),
                _field('Title', _title, hint: 'Website redesign', cap: true),
                _field('Prospect name', _prospect, hint: 'Jane Doe', cap: true),
                _field('Company', _company, hint: 'Acme Inc.', cap: true),
                _field('Email', _email,
                    hint: 'jane@acme.com',
                    keyboard: TextInputType.emailAddress),
                _field('Amount', _amount,
                    hint: '0',
                    keyboard:
                        const TextInputType.numberWithOptions(decimal: true),
                    formatters: [
                      FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))
                    ]),
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _label('Status'),
                      Wrap(
                        spacing: 8,
                        children: ['draft', 'sent', 'accepted', 'rejected']
                            .map((s) => ChoiceChip(
                                  label: Text(s),
                                  selected: _status == s,
                                  showCheckmark: false,
                                  onSelected: (_) =>
                                      setState(() => _status = s),
                                ))
                            .toList(),
                      ),
                    ],
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 6),
                  Text(_error!,
                      style: const TextStyle(color: Brand.expense, fontSize: 13)),
                ],
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _saving ? null : _save,
                  child: _saving
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                              strokeWidth: 2.4, color: Colors.white))
                      : Text(_isEdit ? 'Save changes' : 'Save quotation'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _label(String t) => Padding(
        padding: const EdgeInsets.only(left: 2, bottom: 6),
        child: Text(t,
            style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: Theme.of(context).colorScheme.onSurfaceVariant)),
      );

  Widget _field(String label, TextEditingController ctrl,
      {String? hint,
      TextInputType? keyboard,
      bool cap = false,
      List<TextInputFormatter>? formatters}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _label(label),
          TextField(
            controller: ctrl,
            keyboardType: keyboard,
            inputFormatters: formatters,
            textCapitalization:
                cap ? TextCapitalization.sentences : TextCapitalization.none,
            decoration: InputDecoration(hintText: hint),
          ),
        ],
      ),
    );
  }
}
