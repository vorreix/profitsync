import 'package:intl/intl.dart';

const _symbols = {
  'USD': '\$',
  'EUR': '€',
  'GBP': '£',
  'INR': '₹',
  'JPY': '¥',
  'CNY': '¥',
  'CAD': 'CA\$',
  'AUD': 'A\$',
  'CHF': 'CHF ',
  'SEK': 'kr ',
  'NZD': 'NZ\$',
};

String currencySymbol(String code) => _symbols[code] ?? '$code ';

String formatMoney(num amount, String currency) {
  final fractionDigits = (amount % 1 == 0) ? 0 : 2;
  final f = NumberFormat.currency(
    symbol: currencySymbol(currency),
    decimalDigits: fractionDigits,
  );
  return f.format(amount);
}

String formatCompactMoney(num amount, String currency) {
  final sym = currencySymbol(currency);
  final abs = amount.abs();
  String n;
  if (abs >= 1000000) {
    n = '${(amount / 1000000).toStringAsFixed(abs % 1000000 == 0 ? 0 : 1)}M';
  } else if (abs >= 1000) {
    n = '${(amount / 1000).toStringAsFixed(abs % 1000 == 0 ? 0 : 1)}K';
  } else {
    n = amount.toStringAsFixed(amount % 1 == 0 ? 0 : 2);
  }
  return '$sym$n';
}

String formatDate(String iso) {
  final d = DateTime.tryParse(iso);
  if (d == null) return iso;
  return DateFormat('MMM d, yyyy').format(d.toLocal());
}

String formatShortDate(String iso) {
  final d = DateTime.tryParse(iso);
  if (d == null) return iso;
  return DateFormat('MMM d').format(d.toLocal());
}
