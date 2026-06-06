import 'package:flutter/material.dart';

import '../currencies.dart';
import '../theme.dart';

/// Searchable currency selector. Returns the chosen ISO code, or null if
/// dismissed. Mirrors the web's CurrencyCombobox (code — name (country)).
Future<String?> pickCurrency(BuildContext context, {String? current}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _CurrencyPicker(current: current),
  );
}

class _CurrencyPicker extends StatefulWidget {
  const _CurrencyPicker({this.current});
  final String? current;

  @override
  State<_CurrencyPicker> createState() => _CurrencyPickerState();
}

class _CurrencyPickerState extends State<_CurrencyPicker> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final q = _query.trim().toLowerCase();
    final items = q.isEmpty
        ? kCurrencies
        : kCurrencies
            .where((c) =>
                c.code.toLowerCase().contains(q) ||
                c.name.toLowerCase().contains(q) ||
                c.country.toLowerCase().contains(q))
            .toList();

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        height: MediaQuery.of(context).size.height * 0.78,
        decoration: BoxDecoration(
          color: Theme.of(context).scaffoldBackgroundColor,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: SafeArea(
          top: false,
          child: Column(
            children: [
              const SizedBox(height: 12),
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
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 14, 20, 8),
                child: Row(
                  children: [
                    Text('Choose currency',
                        style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                            color: scheme.onSurface)),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: TextField(
                  autofocus: true,
                  onChanged: (v) => setState(() => _query = v),
                  decoration: const InputDecoration(
                    prefixIcon: Icon(Icons.search_rounded),
                    hintText: 'Search code, name or country',
                  ),
                ),
              ),
              Expanded(
                child: items.isEmpty
                    ? Center(
                        child: Text('No matches',
                            style: TextStyle(color: scheme.onSurfaceVariant)))
                    : ListView.builder(
                        padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                        itemCount: items.length,
                        itemBuilder: (context, i) {
                          final c = items[i];
                          final selected = c.code == widget.current;
                          return ListTile(
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12)),
                            leading: Container(
                              width: 44,
                              height: 36,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                color: scheme.primary.withValues(alpha: 0.10),
                                borderRadius: BorderRadius.circular(9),
                              ),
                              child: Text(c.symbol,
                                  maxLines: 1,
                                  overflow: TextOverflow.clip,
                                  style: TextStyle(
                                      fontWeight: FontWeight.w700,
                                      color: scheme.primary)),
                            ),
                            title: Text('${c.code} — ${c.name}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w600)),
                            subtitle: Text(c.country,
                                maxLines: 1, overflow: TextOverflow.ellipsis),
                            trailing: selected
                                ? const Icon(Icons.check_circle_rounded,
                                    color: Brand.income)
                                : null,
                            onTap: () => Navigator.pop(context, c.code),
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
