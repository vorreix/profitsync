import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_state.dart';
import '../models.dart';
import '../theme.dart';

/// Client sheet for create (or edit when [existing] is given). Returns `true`
/// on success.
Future<bool?> openClientForm(BuildContext context, {Client? existing}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => ClientForm(existing: existing),
  );
}

class ClientForm extends StatefulWidget {
  const ClientForm({super.key, this.existing});
  final Client? existing;

  @override
  State<ClientForm> createState() => _ClientFormState();
}

class _ClientFormState extends State<ClientForm> {
  late final TextEditingController _name;
  late final TextEditingController _company;
  late final TextEditingController _email;
  late final TextEditingController _phone;
  late final TextEditingController _notes;
  late String _status;
  bool _saving = false;
  String? _error;

  bool get _isEdit => widget.existing != null;

  // Web parity: the create form offers only active/inactive. "archived" is kept
  // selectable only when editing a client that is already archived, so its state
  // stays visible and changeable.
  List<String> get _statusOptions {
    final base = ['active', 'inactive'];
    if (widget.existing?.status == 'archived') base.add('archived');
    return base;
  }

  String _statusLabel(String s) => s[0].toUpperCase() + s.substring(1);

  @override
  void initState() {
    super.initState();
    final c = widget.existing;
    _name = TextEditingController(text: c?.name ?? '');
    _company = TextEditingController(text: c?.company ?? '');
    _email = TextEditingController(text: c?.email ?? '');
    _phone = TextEditingController(text: c?.phone ?? '');
    _notes = TextEditingController(text: c?.notes ?? '');
    _status = c?.status ?? 'active';
  }

  @override
  void dispose() {
    _name.dispose();
    _company.dispose();
    _email.dispose();
    _phone.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    FocusScope.of(context).unfocus();
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Name is required');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final api = context.read<AppState>().api;
    final body = {
      'name': _name.text.trim(),
      'company': _company.text.trim(),
      'email': _email.text.trim(),
      'phone': _phone.text.trim(),
      'status': _status,
      'notes': _notes.text.trim(),
    };
    try {
      if (_isEdit) {
        await api.patch('/api/clients/${widget.existing!.id}', body);
      } else {
        await api.post('/api/clients', body);
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
                Text(_isEdit ? 'Edit client' : 'New client',
                    style: TextStyle(
                        fontSize: 21,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.4,
                        color: scheme.onSurface)),
                const SizedBox(height: 18),
                _field('Name', _name, hint: 'Jane Doe', cap: true),
                _field('Company', _company, hint: 'Acme Inc.', cap: true),
                _field('Email', _email,
                    hint: 'jane@acme.com',
                    keyboard: TextInputType.emailAddress),
                _field('Phone', _phone,
                    hint: '+1 555 0100', keyboard: TextInputType.phone),
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _label('Status'),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: _statusOptions.map((s) {
                          final selected = _status == s;
                          return ChoiceChip(
                            label: Text(_statusLabel(s)),
                            selected: selected,
                            showCheckmark: false,
                            selectedColor: scheme.primary,
                            backgroundColor:
                                Theme.of(context).cardColor,
                            side: BorderSide(
                              color: selected
                                  ? scheme.primary
                                  : Theme.of(context).dividerColor,
                            ),
                            labelStyle: TextStyle(
                              fontWeight: FontWeight.w600,
                              color: selected
                                  ? Colors.white
                                  : scheme.onSurface,
                            ),
                            onSelected: (_) =>
                                setState(() => _status = s),
                          );
                        }).toList(),
                      ),
                    ],
                  ),
                ),
                _field('Notes', _notes, hint: 'Optional', cap: true, lines: 3),
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
                      : Text(_isEdit ? 'Save changes' : 'Save client'),
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
      int lines = 1}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _label(label),
          TextField(
            controller: ctrl,
            keyboardType: keyboard,
            minLines: lines,
            maxLines: lines,
            textCapitalization:
                cap ? TextCapitalization.sentences : TextCapitalization.none,
            decoration: InputDecoration(hintText: hint),
          ),
        ],
      ),
    );
  }
}
