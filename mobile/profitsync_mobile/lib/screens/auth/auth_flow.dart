import 'dart:async';

import 'package:clerk_auth/clerk_auth.dart' as clerk;
import 'package:clerk_flutter/clerk_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../../theme.dart';
import '../../widgets.dart';

enum _Mode { signIn, signUp, verify }

/// Custom, branded auth experience built on the Clerk SDK (no prebuilt widget).
/// Handles email/password sign-in, sign-up, and email-code verification on a
/// premium dark hero.
class AuthFlow extends StatefulWidget {
  const AuthFlow({super.key});

  @override
  State<AuthFlow> createState() => _AuthFlowState();
}

class _AuthFlowState extends State<AuthFlow> {
  ClerkAuthState? _auth;
  StreamSubscription<clerk.ClerkError>? _errSub;

  _Mode _mode = _Mode.signIn;
  bool _loading = false;
  bool _obscure = true;
  String? _error;

  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _auth = ClerkAuth.of(context, listen: false);
      _errSub = _auth!.errorStream.listen((e) {
        if (mounted) {
          setState(() {
            _error = e.message;
            _loading = false;
          });
        }
      });
    });
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    _code.dispose();
    _errSub?.cancel();
    super.dispose();
  }

  void _go(_Mode m) => setState(() {
        _mode = m;
        _error = null;
      });

  Future<void> _signIn() async {
    FocusScope.of(context).unfocus();
    if (_email.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'Enter your email and password');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    await _auth!.attemptSignIn(
      strategy: clerk.Strategy.password,
      identifier: _email.text.trim(),
      password: _password.text,
    );
    // Success flips ClerkAuthBuilder to the signed-in tree automatically.
    if (mounted && _auth!.user == null) setState(() => _loading = false);
  }

  Future<void> _signUp() async {
    FocusScope.of(context).unfocus();
    if (_email.text.trim().isEmpty || _password.text.length < 8) {
      setState(() => _error = 'Enter an email and a password (8+ characters)');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    final name = _name.text.trim();
    final first = name.contains(' ') ? name.split(' ').first : name;
    final last = name.contains(' ') ? name.split(' ').sublist(1).join(' ') : '';
    await _auth!.attemptSignUp(
      strategy: clerk.Strategy.password,
      emailAddress: _email.text.trim(),
      password: _password.text,
      passwordConfirmation: _password.text,
      firstName: first.isEmpty ? null : first,
      lastName: last.isEmpty ? null : last,
      legalAccepted: true,
    );
    if (!mounted) return;
    if (_auth!.user != null) return; // signed up + auto-verified
    if (_auth!.signUp != null) {
      // Email verification required — send the code, then collect it.
      await _auth!.attemptSignUp(strategy: clerk.Strategy.emailCode);
      if (mounted) {
        setState(() {
          _mode = _Mode.verify;
          _loading = false;
        });
      }
    } else if (mounted) {
      setState(() => _loading = false);
    }
  }

  Future<void> _verify() async {
    FocusScope.of(context).unfocus();
    if (_code.text.trim().length < 4) {
      setState(() => _error = 'Enter the code from your email');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    await _auth!.attemptSignUp(
      strategy: clerk.Strategy.emailCode,
      code: _code.text.trim(),
    );
    if (mounted && _auth!.user == null) setState(() => _loading = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Brand.ink,
      body: Stack(
        children: [
          // Gradient + glow background.
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
          Positioned(
            top: -120,
            left: -80,
            child: _Glow(color: Brand.blue.withValues(alpha: 0.45), size: 360),
          ),
          Positioned(
            bottom: -140,
            right: -100,
            child: _Glow(color: Brand.indigo.withValues(alpha: 0.35), size: 380),
          ),
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 440),
                  child: _mode == _Mode.verify ? _buildVerify() : _buildAuth(),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _header(String title, String subtitle) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const LogoMark(size: 60, radius: 18),
        const SizedBox(height: 22),
        Text(title,
            style: const TextStyle(
                color: Colors.white,
                fontSize: 30,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.8)),
        const SizedBox(height: 8),
        Text(subtitle,
            style: TextStyle(
                color: Colors.white.withValues(alpha: 0.66),
                fontSize: 15,
                height: 1.4)),
      ],
    ).animate().fadeIn(duration: 400.ms).slideY(begin: 0.08, end: 0);
  }

  Widget _buildAuth() {
    final isSignUp = _mode == _Mode.signUp;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _header(
          isSignUp ? 'Create your account' : 'Welcome back',
          isSignUp
              ? 'Start tracking clients, cash flow and quotations.'
              : 'Sign in to your ProfitSync workspace.',
        ),
        const SizedBox(height: 28),
        if (isSignUp) ...[
          _DarkField(
            controller: _name,
            label: 'Full name',
            hint: 'Jane Doe',
            icon: Icons.person_outline_rounded,
            textCapitalization: TextCapitalization.words,
          ),
          const SizedBox(height: 14),
        ],
        _DarkField(
          controller: _email,
          label: 'Email',
          hint: 'you@company.com',
          icon: Icons.mail_outline_rounded,
          keyboardType: TextInputType.emailAddress,
        ),
        const SizedBox(height: 14),
        _DarkField(
          controller: _password,
          label: 'Password',
          hint: isSignUp ? 'At least 8 characters' : 'Your password',
          icon: Icons.lock_outline_rounded,
          obscure: _obscure,
          onToggleObscure: () => setState(() => _obscure = !_obscure),
        ),
        if (_error != null) ...[
          const SizedBox(height: 14),
          _ErrorText(_error!),
        ],
        const SizedBox(height: 22),
        GradientButton(
          label: isSignUp ? 'Create account' : 'Sign in',
          loading: _loading,
          onPressed: isSignUp ? _signUp : _signIn,
        ),
        _buildSso(),
        const SizedBox(height: 18),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              isSignUp ? 'Already have an account?' : "Don't have an account?",
              style: TextStyle(color: Colors.white.withValues(alpha: 0.6)),
            ),
            TextButton(
              onPressed: _loading
                  ? null
                  : () => _go(isSignUp ? _Mode.signIn : _Mode.signUp),
              child: Text(isSignUp ? 'Sign in' : 'Sign up',
                  style: const TextStyle(
                      color: Colors.white, fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      ],
    ).animate().fadeIn(duration: 350.ms);
  }

  Widget _buildSso() {
    final auth = ClerkAuth.of(context);
    final factors = auth.env.config.firstFactors;
    final hasGoogle = factors.any((s) => s.isOauth && s.provider == 'google');
    final hasApple = factors.any((s) => s.isOauth && s.provider == 'apple');
    if (!hasGoogle && !hasApple) return const SizedBox.shrink();

    Widget divider() => Expanded(
          child: Divider(color: Colors.white.withValues(alpha: 0.14)),
        );

    return Column(
      children: [
        const SizedBox(height: 20),
        Row(
          children: [
            divider(),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Text('or continue with',
                  style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.5),
                      fontSize: 12.5)),
            ),
            divider(),
          ],
        ),
        const SizedBox(height: 16),
        if (hasGoogle)
          _OAuthButton(
            label: 'Continue with Google',
            provider: 'google',
            onTap: _loading ? null : () => _sso(clerk.Strategy.oauthGoogle),
          ),
        if (hasGoogle && hasApple) const SizedBox(height: 12),
        if (hasApple)
          _OAuthButton(
            label: 'Continue with Apple',
            provider: 'apple',
            onTap: _loading ? null : () => _sso(clerk.Strategy.oauthApple),
          ),
      ],
    );
  }

  Future<void> _sso(clerk.Strategy strategy) async {
    FocusScope.of(context).unfocus();
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await _auth!.ssoSignIn(context, strategy);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
    // Success flips ClerkAuthBuilder to the signed-in tree automatically.
    if (mounted && _auth!.user == null) setState(() => _loading = false);
  }

  Widget _buildVerify() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _header('Verify your email',
            'We sent a 6-digit code to ${_email.text.trim()}.'),
        const SizedBox(height: 28),
        _DarkField(
          controller: _code,
          label: 'Verification code',
          hint: '123456',
          icon: Icons.shield_outlined,
          keyboardType: TextInputType.number,
        ),
        if (_error != null) ...[
          const SizedBox(height: 14),
          _ErrorText(_error!),
        ],
        const SizedBox(height: 22),
        GradientButton(
          label: 'Verify & continue',
          loading: _loading,
          onPressed: _verify,
        ),
        const SizedBox(height: 14),
        Center(
          child: TextButton(
            onPressed: _loading ? null : () => _go(_Mode.signUp),
            child: Text('Back',
                style: TextStyle(color: Colors.white.withValues(alpha: 0.7))),
          ),
        ),
      ],
    ).animate().fadeIn(duration: 350.ms);
  }
}

class _Glow extends StatelessWidget {
  const _Glow({required this.color, required this.size});
  final Color color;
  final double size;
  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(colors: [color, color.withValues(alpha: 0)]),
        ),
      ),
    );
  }
}

class _ErrorText extends StatelessWidget {
  const _ErrorText(this.message);
  final String message;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      decoration: BoxDecoration(
        color: Brand.expense.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Brand.expense.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline_rounded,
              color: Color(0xFFFFB4BE), size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(message,
                style: const TextStyle(
                    color: Color(0xFFFFC9D0), fontSize: 13.5, height: 1.3)),
          ),
        ],
      ),
    );
  }
}

/// Text field styled for the dark auth hero.
class _DarkField extends StatelessWidget {
  const _DarkField({
    required this.controller,
    required this.label,
    required this.hint,
    required this.icon,
    this.keyboardType,
    this.obscure = false,
    this.onToggleObscure,
    this.textCapitalization = TextCapitalization.none,
  });

  final TextEditingController controller;
  final String label;
  final String hint;
  final IconData icon;
  final TextInputType? keyboardType;
  final bool obscure;
  final VoidCallback? onToggleObscure;
  final TextCapitalization textCapitalization;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 7),
          child: Text(label,
              style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.8),
                  fontSize: 13,
                  fontWeight: FontWeight.w600)),
        ),
        TextField(
          controller: controller,
          keyboardType: keyboardType,
          obscureText: obscure,
          textCapitalization: textCapitalization,
          style: const TextStyle(color: Colors.white, fontSize: 16),
          cursorColor: Colors.white,
          decoration: InputDecoration(
            isDense: true,
            filled: true,
            fillColor: Colors.white.withValues(alpha: 0.06),
            hintText: hint,
            hintStyle: TextStyle(color: Colors.white.withValues(alpha: 0.4)),
            prefixIcon: Icon(icon, color: Colors.white.withValues(alpha: 0.6), size: 20),
            suffixIcon: onToggleObscure == null
                ? null
                : IconButton(
                    onPressed: onToggleObscure,
                    icon: Icon(
                        obscure
                            ? Icons.visibility_off_outlined
                            : Icons.visibility_outlined,
                        color: Colors.white.withValues(alpha: 0.6),
                        size: 20),
                  ),
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide:
                  BorderSide(color: Colors.white.withValues(alpha: 0.12)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide:
                  BorderSide(color: Colors.white.withValues(alpha: 0.12)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: Brand.blue, width: 1.8),
            ),
          ),
        ),
      ],
    );
  }
}

/// Social sign-in button (white pill) for the dark auth hero.
class _OAuthButton extends StatelessWidget {
  const _OAuthButton({required this.label, required this.provider, this.onTap});
  final String label;
  final String provider;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Pressable(
      onTap: onTap,
      child: Opacity(
        opacity: onTap == null ? 0.6 : 1,
        child: Container(
          height: 52,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _glyph(),
              const SizedBox(width: 10),
              Text(label,
                  style: const TextStyle(
                      color: Color(0xFF1A1A1A),
                      fontWeight: FontWeight.w700,
                      fontSize: 15)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _glyph() {
    if (provider == 'apple') {
      return const Icon(Icons.apple, color: Colors.black, size: 22);
    }
    // Google "G" mark.
    return Container(
      width: 20,
      height: 20,
      alignment: Alignment.center,
      child: const Text('G',
          style: TextStyle(
              color: Color(0xFF4285F4),
              fontWeight: FontWeight.w800,
              fontSize: 18)),
    );
  }
}
