import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Income/expense category suggestions, managed on-device (matches the web app).
/// Categories are not a DB entity — `transaction.category` is free text; these
/// are editable suggestion lists persisted locally.
class CategoryStore {
  static const _key = 'ps_categories_v1';

  static const Map<String, List<String>> defaults = {
    'incoming': ['Payment', 'Retainer', 'Project Fee', 'Consultation', 'Other'],
    'outgoing': [
      'Hosting',
      'Design',
      'Development',
      'Advertising',
      'Salary',
      'Software',
      'Travel',
      'Taxes',
      'Miscellaneous',
    ],
  };

  static Future<Map<String, List<String>>> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw != null) {
      try {
        final m = jsonDecode(raw) as Map<String, dynamic>;
        return {
          'incoming': List<String>.from(m['incoming'] as List? ?? const []),
          'outgoing': List<String>.from(m['outgoing'] as List? ?? const []),
        };
      } catch (_) {/* fall through to defaults */}
    }
    return {
      'incoming': [...defaults['incoming']!],
      'outgoing': [...defaults['outgoing']!],
    };
  }

  static Future<void> save(Map<String, List<String>> cats) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(cats));
  }
}
