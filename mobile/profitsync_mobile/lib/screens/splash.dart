import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../theme.dart';
import '../widgets.dart';

/// Branded splash shown while auth initializes / app boots.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key, this.message});
  final String? message;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Brand.ink,
      body: Stack(
        children: [
          const Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Brand.ink2, Brand.ink],
                ),
              ),
            ),
          ),
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const LogoMark(size: 76, radius: 22)
                    .animate()
                    .scale(
                        begin: const Offset(0.7, 0.7),
                        end: const Offset(1, 1),
                        duration: 500.ms,
                        curve: Curves.easeOutBack)
                    .fadeIn(duration: 400.ms),
                const SizedBox(height: 20),
                Text('ProfitSync',
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 26,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.6))
                    .animate()
                    .fadeIn(delay: 150.ms, duration: 400.ms),
                const SizedBox(height: 28),
                SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.2,
                    color: Colors.white.withValues(alpha: 0.85),
                  ),
                ).animate().fadeIn(delay: 350.ms),
                if (message != null) ...[
                  const SizedBox(height: 16),
                  Text(message!,
                      style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.6),
                          fontSize: 13)),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
