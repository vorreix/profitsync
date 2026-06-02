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
  String _status = 'all'; // all | draft | sent | accepted | rejected
  String _sort = 'amount_desc'; // amount_desc | amount_asc | title_asc

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

  List<Quotation> _apply(List<Quotation> all) {
    final list =
        all.where((q) => _status == 'all' || q.status == _status).toList();
    switch (_sort) {
      case 'amount_asc':
        list.sort((a, b) => a.amount.compareTo(b.amount));
        break;
      case 'title_asc':
        list.sort(
            (a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()));
        break;
      case 'amount_desc':
      default:
        list.sort((a, b) => b.amount.compareTo(a.amount));
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
            final all = snap.data ?? [];
            final quotes = _apply(all);
            return Column(
              children: [
                _QuoteFilterBar(
                  status: _status,
                  onStatusChanged: (v) => setState(() => _status = v),
                  sort: _sort,
                  onSortChanged: (v) => setState(() => _sort = v),
                ),
                Expanded(
                  child: quotes.isEmpty
                      ? ListView(children: [
                          const SizedBox(height: 60),
                          EmptyState(
                            icon: Icons.description_rounded,
                            title: all.isEmpty
                                ? 'No quotations'
                                : 'No matches',
                            subtitle: all.isEmpty
                                ? 'Create a quote and convert it to a client later.'
                                : 'Try a different status filter.',
                          ),
                        ])
                      : ListView.builder(
                          padding: const EdgeInsets.fromLTRB(16, 4, 16, 110),
                          itemCount: quotes.length,
                          itemBuilder: (context, i) {
                            final q = quotes[i];
                            final tile = _QuoteTile(
                              q: q,
                              currency: state.currency,
                              onTap: () => _showDetail(q),
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
                        ),
                ),
              ],
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

  /// Quotation actions: change status, edit, convert to client, delete.
  Future<void> _showDetail(Quotation q) async {
    final state = context.read<AppState>();
    final result = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => _QuotationDetailSheet(
        quotation: q,
        currency: state.currency,
        canWrite: state.canWrite,
        canDelete: state.canDelete,
      ),
    );
    if (!mounted) return;
    switch (result) {
      case 'edit':
        await _edit(q);
        break;
      case 'changed':
      case 'converted':
      case 'deleted':
        _refresh();
        break;
    }
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

class _QuoteFilterBar extends StatelessWidget {
  const _QuoteFilterBar({
    required this.status,
    required this.onStatusChanged,
    required this.sort,
    required this.onSortChanged,
  });
  final String status;
  final ValueChanged<String> onStatusChanged;
  final String sort;
  final ValueChanged<String> onSortChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(0, 8, 8, 4),
      child: Row(
        children: [
          Expanded(
            child: SizedBox(
              height: 44,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.only(left: 16),
                children: [
                  for (final e in const {
                    'all': 'All',
                    'draft': 'Draft',
                    'sent': 'Sent',
                    'accepted': 'Accepted',
                    'rejected': 'Rejected',
                  }.entries)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(e.value),
                        selected: status == e.key,
                        showCheckmark: false,
                        selectedColor: scheme.primary,
                        labelStyle: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: status == e.key
                              ? scheme.onPrimary
                              : scheme.onSurfaceVariant,
                        ),
                        onSelected: (_) => onStatusChanged(e.key),
                      ),
                    ),
                ],
              ),
            ),
          ),
          PopupMenuButton<String>(
            tooltip: 'Sort',
            initialValue: sort,
            onSelected: onSortChanged,
            icon: Icon(Icons.swap_vert_rounded, color: scheme.onSurfaceVariant),
            itemBuilder: (_) => const [
              PopupMenuItem(
                  value: 'amount_desc', child: Text('Amount: high → low')),
              PopupMenuItem(
                  value: 'amount_asc', child: Text('Amount: low → high')),
              PopupMenuItem(value: 'title_asc', child: Text('Title: A → Z')),
            ],
          ),
        ],
      ),
    );
  }
}

/// Bottom sheet with quotation details + actions: change status inline, edit,
/// convert to client, delete. Pops with a result string the list reacts to.
class _QuotationDetailSheet extends StatefulWidget {
  const _QuotationDetailSheet({
    required this.quotation,
    required this.currency,
    required this.canWrite,
    required this.canDelete,
  });
  final Quotation quotation;
  final String currency;
  final bool canWrite;
  final bool canDelete;

  @override
  State<_QuotationDetailSheet> createState() => _QuotationDetailSheetState();
}

class _QuotationDetailSheetState extends State<_QuotationDetailSheet> {
  late String _status;
  bool _busy = false;
  String? _error;

  static const _statuses = ['draft', 'sent', 'accepted', 'rejected'];

  bool get _converted => widget.quotation.linkedClientId != null;

  @override
  void initState() {
    super.initState();
    _status = widget.quotation.status;
  }

  Future<void> _setStatus(String s) async {
    if (s == _status || _busy) return;
    final prev = _status;
    setState(() {
      _status = s;
      _busy = true;
      _error = null;
    });
    try {
      await context
          .read<AppState>()
          .api
          .patch('/api/quotations/${widget.quotation.id}', {'status': s});
    } catch (e) {
      setState(() {
        _status = prev;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _convert() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context
          .read<AppState>()
          .api
          .post('/api/quotations/${widget.quotation.id}/convert');
      if (mounted) Navigator.pop(context, 'converted');
    } catch (e) {
      setState(() {
        _busy = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _delete() async {
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
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      await context
          .read<AppState>()
          .api
          .delete('/api/quotations/${widget.quotation.id}');
      if (mounted) Navigator.pop(context, 'deleted');
    } catch (e) {
      setState(() {
        _busy = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final q = widget.quotation;
    return Container(
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
              Text(q.title,
                  style: TextStyle(
                      fontSize: 21,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.4,
                      color: scheme.onSurface)),
              const SizedBox(height: 4),
              Text(
                [
                  if (q.prospectName.isNotEmpty) q.prospectName,
                  if (q.company.isNotEmpty) q.company,
                ].join(' · '),
                style: TextStyle(color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: 14),
              Text(formatMoney(q.amount, widget.currency),
                  style: TextStyle(
                      fontSize: 30,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.8,
                      color: scheme.onSurface)),
              if (_converted) ...[
                const SizedBox(height: 10),
                Row(
                  children: [
                    Icon(Icons.check_circle_rounded,
                        size: 18, color: Brand.income),
                    const SizedBox(width: 6),
                    Text('Converted to a client',
                        style: TextStyle(
                            color: Brand.income, fontWeight: FontWeight.w600)),
                  ],
                ),
              ],
              const SizedBox(height: 20),
              Text('Status',
                  style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: scheme.onSurfaceVariant)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _statuses.map((s) {
                  final selected = _status == s;
                  final c = statusColor(s);
                  return ChoiceChip(
                    label: Text(s[0].toUpperCase() + s.substring(1)),
                    selected: selected,
                    showCheckmark: false,
                    selectedColor: c,
                    backgroundColor: Theme.of(context).cardColor,
                    side: BorderSide(
                        color: selected ? c : Theme.of(context).dividerColor),
                    labelStyle: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: selected ? Colors.white : scheme.onSurface,
                    ),
                    onSelected: widget.canWrite && !_busy
                        ? (_) => _setStatus(s)
                        : null,
                  );
                }).toList(),
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!,
                    style: const TextStyle(color: Brand.expense, fontSize: 13)),
              ],
              const SizedBox(height: 22),
              if (widget.canWrite && !_converted)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: GradientButton(
                    label: 'Convert to client',
                    icon: Icons.person_add_alt_1_rounded,
                    loading: _busy,
                    onPressed: _convert,
                    height: 50,
                  ),
                ),
              Row(
                children: [
                  if (widget.canWrite)
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed:
                            _busy ? null : () => Navigator.pop(context, 'edit'),
                        icon: const Icon(Icons.edit_outlined, size: 18),
                        label: const Text('Edit'),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size.fromHeight(48),
                          side: BorderSide(
                              color: Theme.of(context).dividerColor),
                        ),
                      ),
                    ),
                  if (widget.canWrite && widget.canDelete)
                    const SizedBox(width: 10),
                  if (widget.canDelete)
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _busy ? null : _delete,
                        icon: const Icon(Icons.delete_outline_rounded,
                            size: 18),
                        label: const Text('Delete'),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size.fromHeight(48),
                          foregroundColor: Brand.expense,
                          side: BorderSide(
                              color: Brand.expense.withValues(alpha: 0.5)),
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
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
