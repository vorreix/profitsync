import 'package:clerk_flutter/clerk_flutter.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_state.dart';
import '../theme.dart';

/// First-run account-type choice. Mirrors the web onboarding's step 1 but
/// rebuilt for mobile: a single safe-area scroll view with a keyboard-aware
/// sticky CTA, so nothing is clipped on small screens or behind the keyboard.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  String? _accountType;
  final _companyCtrl = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _companyCtrl.dispose();
    super.dispose();
  }

  Future<void> _continue() async {
    if (_accountType == null || _submitting) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await context.read<AppState>().completeOnboarding(
            accountType: _accountType!,
            companyName: _companyCtrl.text.trim(),
          );
      // Gate rebuilds automatically once needsOnboarding flips to false.
    } catch (e) {
      if (mounted) {
        setState(() {
          _submitting = false;
          _error = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final fullName = context.read<AppState>().profile?.fullName.trim() ?? '';
    final firstName = fullName.isNotEmpty ? fullName.split(' ').first : null;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                children: [
                  Row(
                    children: [
                      Container(
                        width: 32,
                        height: 32,
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [Brand.blue, Brand.indigo],
                          ),
                          borderRadius: BorderRadius.circular(9),
                        ),
                        child: const Icon(Icons.trending_up_rounded,
                            color: Colors.white, size: 18),
                      ),
                      const SizedBox(width: 8),
                      const Text('ProfitSync',
                          style: TextStyle(
                              fontWeight: FontWeight.w700, fontSize: 15)),
                      const Spacer(),
                      TextButton(
                        onPressed: () =>
                            ClerkAuth.of(context, listen: false).signOut(),
                        child: const Text('Sign out'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 28),
                  Text(
                    firstName != null ? 'Welcome, $firstName' : 'Welcome',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 1.2,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'How will you use ProfitSync?',
                    style: TextStyle(
                      fontSize: 26,
                      height: 1.15,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.6,
                      color: scheme.onSurface,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Pick the setup that fits. You can change it later.',
                    style: TextStyle(
                        fontSize: 15, color: scheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: 24),
                  _ChoiceCard(
                    type: 'personal',
                    icon: Icons.person_rounded,
                    accent: Brand.personal,
                    title: 'Personal',
                    tagline: 'Track your own income & expenses',
                    points: const [
                      'Simple cash-flow tracking',
                      'Categorised transactions',
                      'Clean dashboard & insights',
                    ],
                    selected: _accountType == 'personal',
                    onTap: () => setState(() => _accountType = 'personal'),
                  ),
                  const SizedBox(height: 14),
                  _ChoiceCard(
                    type: 'business',
                    icon: Icons.business_rounded,
                    accent: Brand.business,
                    title: 'Business',
                    tagline: 'Manage clients, deals & quotations',
                    points: const [
                      'Client directory & per-client P&L',
                      'Quotations you can convert to clients',
                      'Team members & roles',
                    ],
                    selected: _accountType == 'business',
                    onTap: () => setState(() => _accountType = 'business'),
                  ),
                  AnimatedSize(
                    duration: const Duration(milliseconds: 200),
                    curve: Curves.easeOut,
                    child: _accountType == 'business'
                        ? Padding(
                            padding: const EdgeInsets.only(top: 16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Company name',
                                    style: TextStyle(
                                        fontSize: 14,
                                        fontWeight: FontWeight.w600,
                                        color: scheme.onSurface)),
                                const SizedBox(height: 8),
                                TextField(
                                  controller: _companyCtrl,
                                  textCapitalization:
                                      TextCapitalization.words,
                                  decoration: const InputDecoration(
                                    hintText: 'Acme Inc.',
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text('Optional — you can add it later.',
                                    style: TextStyle(
                                        fontSize: 12.5,
                                        color: scheme.onSurfaceVariant)),
                              ],
                            ),
                          )
                        : const SizedBox.shrink(),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 16),
                    Text(_error!,
                        style: const TextStyle(color: Brand.expense, fontSize: 13)),
                  ],
                ],
              ),
            ),
            // Keyboard-aware sticky CTA.
            AnimatedPadding(
              duration: const Duration(milliseconds: 150),
              padding: EdgeInsets.only(bottom: bottomInset),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
                decoration: BoxDecoration(
                  color: Theme.of(context).scaffoldBackgroundColor,
                  border: Border(
                    top: BorderSide(color: Theme.of(context).dividerColor),
                  ),
                ),
                child: FilledButton(
                  onPressed:
                      _accountType == null || _submitting ? null : _continue,
                  child: _submitting
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                              strokeWidth: 2.4, color: Colors.white),
                        )
                      : const Text('Continue'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ChoiceCard extends StatelessWidget {
  const _ChoiceCard({
    required this.type,
    required this.icon,
    required this.accent,
    required this.title,
    required this.tagline,
    required this.points,
    required this.selected,
    required this.onTap,
  });

  final String type;
  final IconData icon;
  final Color accent;
  final String title;
  final String tagline;
  final List<String> points;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOut,
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: selected ? accent : Theme.of(context).dividerColor,
          width: selected ? 2 : 1,
        ),
        boxShadow: selected
            ? [
                BoxShadow(
                  color: accent.withValues(alpha: 0.18),
                  blurRadius: 20,
                  offset: const Offset(0, 8),
                ),
              ]
            : null,
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        color: accent.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(13),
                      ),
                      child: Icon(icon, color: accent, size: 26),
                    ),
                    const Spacer(),
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      width: 24,
                      height: 24,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: selected ? accent : Colors.transparent,
                        border: Border.all(
                          color: selected
                              ? accent
                              : Theme.of(context).dividerColor,
                          width: 2,
                        ),
                      ),
                      child: selected
                          ? const Icon(Icons.check,
                              size: 15, color: Colors.white)
                          : null,
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Text(title,
                    style: TextStyle(
                        fontSize: 19,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.3,
                        color: scheme.onSurface)),
                const SizedBox(height: 2),
                Text(tagline,
                    style: TextStyle(
                        fontSize: 14, color: scheme.onSurfaceVariant)),
                const SizedBox(height: 14),
                ...points.map(
                  (p) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          margin: const EdgeInsets.only(top: 6),
                          width: 6,
                          height: 6,
                          decoration: BoxDecoration(
                              color: accent, shape: BoxShape.circle),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(p,
                              style: TextStyle(
                                  fontSize: 14,
                                  color: scheme.onSurface
                                      .withValues(alpha: 0.85))),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
