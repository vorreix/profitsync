import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../app_state.dart';
import '../categories.dart';
import '../models.dart';
import '../theme.dart';
import '../util.dart';

/// Opens the transaction sheet for create (or edit when [existing] is given).
/// Returns `true` if saved.
Future<bool?> openTransactionForm(
  BuildContext context, {
  String? clientId,
  Transaction? existing,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => TransactionForm(presetClientId: clientId, existing: existing),
  );
}

class TransactionForm extends StatefulWidget {
  const TransactionForm({super.key, this.presetClientId, this.existing});
  final String? presetClientId;
  final Transaction? existing;

  @override
  State<TransactionForm> createState() => _TransactionFormState();
}

class _TransactionFormState extends State<TransactionForm> {
  late String _type;
  late final TextEditingController _amountCtrl;
  late final TextEditingController _descCtrl;
  String _category = '';
  late DateTime _date;
  String? _clientId;
  List<Client> _clients = [];
  bool _loadingClients = true;
  bool _saving = false;
  String? _error;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    _type = e?.type ?? 'incoming';
    _amountCtrl = TextEditingController(
        text: e != null ? _trimAmount(e.amount) : '');
    _descCtrl = TextEditingController(text: e?.description ?? '');
    _category = e?.category ?? '';
    _date = e != null ? (DateTime.tryParse(e.date) ?? DateTime.now()) : DateTime.now();
    _clientId = e?.clientId ?? widget.presetClientId;
    _loadClients();
  }

  static String _trimAmount(double v) =>
      v % 1 == 0 ? v.toStringAsFixed(0) : v.toString();

  Future<void> _loadClients() async {
    try {
      final api = context.read<AppState>().api;
      final res = await api.get('/api/clients');
      final clients = (res as List)
          .map((e) => Client.fromJson(e as Map<String, dynamic>))
          .toList();
      setState(() {
        _clients = clients;
        _loadingClients = false;
        if (_clientId == null && clients.isNotEmpty) {
          final own = clients.where((c) => c.isOwn);
          _clientId = own.isNotEmpty ? own.first.id : clients.first.id;
        }
      });
    } catch (e) {
      setState(() {
        _loadingClients = false;
        _error = _clean(e);
      });
    }
  }

  @override
  void dispose() {
    _amountCtrl.dispose();
    _descCtrl.dispose();
    super.dispose();
  }

  String _clean(Object e) => e.toString().replaceFirst('Exception: ', '');

  Future<void> _save() async {
    FocusScope.of(context).unfocus();
    final amount = double.tryParse(_amountCtrl.text.trim());
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Enter a valid amount');
      return;
    }
    if (_clientId == null) {
      setState(() => _error = 'Select a client');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final api = context.read<AppState>().api;
    final body = {
      'type': _type,
      'amount': amount,
      'description': _descCtrl.text.trim(),
      'category': _category.trim(),
      'date': _date.toIso8601String().split('T').first,
    };
    try {
      if (_isEdit) {
        await api.patch('/api/transactions/${widget.existing!.id}', body);
      } else {
        await api.post('/api/transactions', {'client_id': _clientId, ...body});
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      setState(() {
        _saving = false;
        _error = _clean(e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final currency = context.read<AppState>().currency;

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.9),
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
                Center(child: _grabber(scheme)),
                const SizedBox(height: 18),
                Text(_isEdit ? 'Edit transaction' : 'New transaction',
                    style: TextStyle(
                        fontSize: 21,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.4,
                        color: scheme.onSurface)),
                const SizedBox(height: 18),
                _SegToggle(
                  value: _type,
                  onChanged: (v) => setState(() => _type = v),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _amountCtrl,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                  ],
                  style:
                      const TextStyle(fontSize: 26, fontWeight: FontWeight.w800),
                  decoration: InputDecoration(
                    prefixIcon: Padding(
                      padding: const EdgeInsets.only(left: 16, right: 8),
                      child: Text(currencySymbol(currency),
                          style: TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.w700,
                              color: scheme.onSurfaceVariant)),
                    ),
                    prefixIconConstraints:
                        const BoxConstraints(minWidth: 0, minHeight: 0),
                    hintText: '0',
                  ),
                ),
                const SizedBox(height: 14),
                if (!_isEdit) ...[
                  if (_loadingClients)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 8),
                      child: LinearProgressIndicator(),
                    )
                  else if (_clients.isNotEmpty)
                    _LabeledField(
                      label: 'Client',
                      child: DropdownButtonFormField<String>(
                        initialValue: _clientId,
                        isExpanded: true,
                        items: _clients
                            .map((c) => DropdownMenuItem(
                                  value: c.id,
                                  child: Text(
                                      c.isOwn ? '${c.name} (own)' : c.name,
                                      overflow: TextOverflow.ellipsis),
                                ))
                            .toList(),
                        onChanged: (v) => setState(() => _clientId = v),
                        decoration: const InputDecoration(),
                      ),
                    ),
                  const SizedBox(height: 12),
                ],
                _LabeledField(
                  label: 'Description',
                  child: TextField(
                    controller: _descCtrl,
                    textCapitalization: TextCapitalization.sentences,
                    decoration:
                        const InputDecoration(hintText: 'What was it for?'),
                  ),
                ),
                const SizedBox(height: 14),
                _LabeledField(
                  label: 'Category',
                  child: CategoryField(
                    type: _type,
                    value: _category,
                    onChanged: (c) => setState(() => _category = c),
                  ),
                ),
                const SizedBox(height: 14),
                _LabeledField(
                  label: 'Date',
                  child: InkWell(
                    borderRadius: BorderRadius.circular(14),
                    onTap: () async {
                      final picked = await showDatePicker(
                        context: context,
                        initialDate: _date,
                        firstDate: DateTime(2015),
                        lastDate: DateTime(2100),
                      );
                      if (picked != null) setState(() => _date = picked);
                    },
                    child: InputDecorator(
                      decoration: const InputDecoration(),
                      child: Row(
                        children: [
                          Icon(Icons.calendar_today_rounded,
                              size: 17, color: scheme.onSurfaceVariant),
                          const SizedBox(width: 10),
                          Text(formatDate(
                              _date.toIso8601String().split('T').first)),
                        ],
                      ),
                    ),
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!,
                      style:
                          const TextStyle(color: Brand.expense, fontSize: 13)),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _saving ? null : _save,
                  child: _saving
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                              strokeWidth: 2.4, color: Colors.white))
                      : Text(_isEdit ? 'Save changes' : 'Save transaction'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _grabber(ColorScheme scheme) => Container(
        width: 40,
        height: 4,
        decoration: BoxDecoration(
          color: scheme.onSurfaceVariant.withValues(alpha: 0.3),
          borderRadius: BorderRadius.circular(4),
        ),
      );
}

/// Managed category picker — chips for the active type, add new, long-press to
/// delete. Persists to [CategoryStore].
class CategoryField extends StatefulWidget {
  const CategoryField({
    super.key,
    required this.type,
    required this.value,
    required this.onChanged,
  });
  final String type; // incoming | outgoing
  final String value;
  final ValueChanged<String> onChanged;

  @override
  State<CategoryField> createState() => _CategoryFieldState();
}

class _CategoryFieldState extends State<CategoryField> {
  Map<String, List<String>> _cats = {'incoming': [], 'outgoing': []};
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    CategoryStore.load().then((c) {
      if (mounted) {
        setState(() {
          _cats = c;
          _loaded = true;
        });
      }
    });
  }

  List<String> get _list => _cats[widget.type] ?? const [];

  Future<void> _persist() => CategoryStore.save(_cats);

  Future<void> _addDialog() async {
    final ctrl = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('New category'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(hintText: 'e.g. Marketing'),
          onSubmitted: (v) => Navigator.pop(d, v.trim()),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(d, ctrl.text.trim()),
              child: const Text('Add')),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;
    if (!_list.any((c) => c.toLowerCase() == name.toLowerCase())) {
      setState(() => _cats[widget.type] = [..._list, name]);
      await _persist();
    }
    widget.onChanged(name);
  }

  Future<void> _delete(String cat) async {
    setState(() => _cats[widget.type] = _list.where((c) => c != cat).toList());
    if (widget.value == cat) widget.onChanged('');
    await _persist();
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 8),
        child: LinearProgressIndicator(),
      );
    }
    final scheme = Theme.of(context).colorScheme;
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final c in _list)
          GestureDetector(
            onLongPress: () => _confirmDelete(c),
            child: ChoiceChip(
              label: Text(c),
              selected: widget.value == c,
              showCheckmark: false,
              selectedColor: scheme.primary,
              labelStyle: TextStyle(
                fontWeight: FontWeight.w600,
                color: widget.value == c ? Colors.white : scheme.onSurface,
              ),
              onSelected: (_) => widget.onChanged(widget.value == c ? '' : c),
            ),
          ),
        ActionChip(
          avatar: Icon(Icons.add_rounded, size: 18, color: scheme.primary),
          label: const Text('Add'),
          labelStyle: TextStyle(
              fontWeight: FontWeight.w600, color: scheme.primary),
          onPressed: _addDialog,
        ),
      ],
    );
  }

  void _confirmDelete(String cat) {
    showModalBottomSheet(
      context: context,
      builder: (s) => SafeArea(
        child: Wrap(children: [
          ListTile(
            leading: const Icon(Icons.delete_outline_rounded,
                color: Brand.expense),
            title: Text('Delete "$cat" category'),
            subtitle: const Text('Existing transactions keep their category.'),
            onTap: () {
              Navigator.pop(s);
              _delete(cat);
            },
          ),
        ]),
      ),
    );
  }
}

class _SegToggle extends StatelessWidget {
  const _SegToggle({required this.value, required this.onChanged});
  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    Widget seg(String key, String label, IconData icon, Color color) {
      final selected = value == key;
      return Expanded(
        child: GestureDetector(
          onTap: () => onChanged(key),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            padding: const EdgeInsets.symmetric(vertical: 12),
            decoration: BoxDecoration(
              color:
                  selected ? color.withValues(alpha: 0.14) : Colors.transparent,
              borderRadius: BorderRadius.circular(11),
              border: Border.all(
                color: selected ? color : Theme.of(context).dividerColor,
                width: selected ? 1.6 : 1,
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon,
                    size: 18,
                    color: selected
                        ? color
                        : Theme.of(context).colorScheme.onSurfaceVariant),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(label,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontWeight: FontWeight.w700,
                          color: selected
                              ? color
                              : Theme.of(context).colorScheme.onSurfaceVariant)),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Row(
      children: [
        seg('incoming', 'Income', Icons.south_west_rounded, Brand.income),
        const SizedBox(width: 10),
        seg('outgoing', 'Expense', Icons.north_east_rounded, Brand.expense),
      ],
    );
  }
}

class _LabeledField extends StatelessWidget {
  const _LabeledField({required this.label, required this.child});
  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 2, bottom: 6),
          child: Text(label,
              style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: Theme.of(context).colorScheme.onSurfaceVariant)),
        ),
        child,
      ],
    );
  }
}
