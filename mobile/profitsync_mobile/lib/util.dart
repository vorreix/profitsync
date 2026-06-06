import 'package:intl/intl.dart';

import 'currencies.dart';

final Map<String, String> _symbols = {
  for (final c in kCurrencies) c.code: c.symbol,
};

String currencySymbol(String code) {
  final s = _symbols[code];
  if (s == null || s.isEmpty) return '$code ';
  // Pad multi-letter symbols (e.g. "Fr", "kr") so amounts don't crowd them.
  return s.length > 1 && RegExp(r'[A-Za-z]$').hasMatch(s) ? '$s ' : s;
}

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

/// Human-friendly plan label from a plan key (`free`, `personal`, `business`,
/// `premium`, …). Falls back to a title-cased key.
String planDisplayName(String? key) {
  switch (key) {
    case null:
    case '':
    case 'free':
      return 'Free';
    case 'personal':
      return 'Personal Pro';
    case 'business':
      return 'Business';
    case 'premium':
      return 'Premium';
    default:
      return key[0].toUpperCase() + key.substring(1);
  }
}

String formatFileSize(int bytes) {
  if (bytes >= 1024 * 1024) {
    return '${(bytes / (1024 * 1024)).toStringAsFixed(bytes % (1024 * 1024) == 0 ? 0 : 1)} MB';
  }
  if (bytes >= 1024) {
    return '${(bytes / 1024).toStringAsFixed(0)} KB';
  }
  return '$bytes B';
}
