import 'package:flutter/material.dart';

/// Brand & semantic palette. Blue→indigo is the brand (trust); emerald is
/// money-positive (income), rose is money-negative (expense) — a distinctly
/// fintech split rather than an all-green look.
class Brand {
  static const Color blue = Color(0xFF2563EB);
  static const Color indigo = Color(0xFF4F46E5);

  static const Color income = Color(0xFF10B981); // emerald
  static const Color expense = Color(0xFFF43F5E); // rose
  static const Color amber = Color(0xFFF59E0B);

  static const Color personal = Color(0xFF10B981);
  static const Color business = Color(0xFF6366F1);

  static const List<Color> brandGradient = [blue, indigo];

  // Ink surfaces used on auth/splash regardless of theme.
  static const Color ink = Color(0xFF0A0E1A);
  static const Color ink2 = Color(0xFF131C32);
}

/// Bundled font family (assets/fonts/Inter.ttf) — no runtime network fetch, so
/// it renders reliably offline / on emulators without DNS.
const String kFont = 'Inter';

class AppTheme {
  static ThemeData light() => _build(Brightness.light);
  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;

    final bg = isDark ? const Color(0xFF0A0E16) : const Color(0xFFF3F5FA);
    final surface = isDark ? const Color(0xFF121826) : Colors.white;
    final border = isDark ? const Color(0xFF222A3A) : const Color(0xFFE6E9F1);
    final onSurface = isDark ? const Color(0xFFEDF1F8) : const Color(0xFF0B1220);
    final onMuted = isDark ? const Color(0xFF8B95AB) : const Color(0xFF646E85);

    final scheme = ColorScheme.fromSeed(
      seedColor: Brand.blue,
      brightness: brightness,
    ).copyWith(
      primary: Brand.blue,
      onPrimary: Colors.white,
      secondary: Brand.indigo,
      surface: surface,
      onSurface: onSurface,
      onSurfaceVariant: onMuted,
      outline: border,
      error: Brand.expense,
    );

    final base = ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      fontFamily: kFont,
      scaffoldBackgroundColor: bg,
      splashFactory: InkSparkle.splashFactory,
    );

    return base.copyWith(
      textTheme: base.textTheme
          .apply(bodyColor: onSurface, displayColor: onSurface),
      appBarTheme: AppBarTheme(
        backgroundColor: bg,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: kFont,
          color: onSurface,
          fontSize: 24,
          fontWeight: FontWeight.w800,
          letterSpacing: -0.6,
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: border),
        ),
        margin: EdgeInsets.zero,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: Brand.blue,
          foregroundColor: Colors.white,
          disabledBackgroundColor: Brand.blue.withValues(alpha: 0.4),
          disabledForegroundColor: Colors.white70,
          minimumSize: const Size.fromHeight(54),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(15),
          ),
          textStyle: const TextStyle(
            fontFamily: kFont,
            fontSize: 16,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.2,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: Brand.blue,
          textStyle: const TextStyle(fontFamily: kFont, fontWeight: FontWeight.w600),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? const Color(0xFF0E1422) : const Color(0xFFF7F8FC),
        hintStyle: TextStyle(color: onMuted),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 17),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: Brand.blue, width: 1.8),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: Brand.expense, width: 1.4),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: Brand.expense, width: 1.8),
        ),
      ),
      chipTheme: base.chipTheme.copyWith(
        backgroundColor: isDark ? const Color(0xFF0E1422) : Colors.white,
        side: BorderSide(color: border),
        labelStyle: const TextStyle(fontFamily: kFont, fontWeight: FontWeight.w600),
        shape:
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: isDark
            ? const Color(0xFF0E1422).withValues(alpha: 0.92)
            : Colors.white.withValues(alpha: 0.92),
        surfaceTintColor: Colors.transparent,
        indicatorColor: Brand.blue.withValues(alpha: 0.14),
        height: 68,
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            fontFamily: kFont,
            fontSize: 11.5,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            color: selected ? Brand.blue : onMuted,
          );
        }),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
              color: selected ? Brand.blue : onMuted, size: 24);
        }),
      ),
      dividerTheme: DividerThemeData(color: border, thickness: 1, space: 1),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor:
            isDark ? const Color(0xFF1B2335) : const Color(0xFF111827),
        contentTextStyle: const TextStyle(fontFamily: kFont, color: Colors.white),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    );
  }
}

/// Tabular figures for money/numbers so columns don't jitter.
const List<FontFeature> kTabular = [FontFeature.tabularFigures()];
