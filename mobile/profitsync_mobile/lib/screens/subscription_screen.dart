import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app_state.dart';
import '../theme.dart';
import '../util.dart';
import '../widgets.dart';

class _Plan {
  final String key;
  final String name;
  final String? accountType;
  final String currency;
  final int monthly; // minor units
  final int yearly;
  final int monthlyDiscountPct;
  final int yearlyDiscountPct;

  _Plan({
    required this.key,
    required this.name,
    required this.accountType,
    required this.currency,
    required this.monthly,
    required this.yearly,
    required this.monthlyDiscountPct,
    required this.yearlyDiscountPct,
  });

  bool get isFree => key == 'free';

  factory _Plan.fromJson(Map<String, dynamic> j) {
    final lp = (j['local_pricing'] as Map?) ?? const {};
    int toInt(v) => v is num ? v.toInt() : int.tryParse('${v ?? 0}') ?? 0;
    return _Plan(
      key: j['key']?.toString() ?? '',
      name: j['name']?.toString() ?? '',
      accountType: j['account_type']?.toString(),
      currency: lp['currency']?.toString() ?? 'USD',
      monthly: toInt(lp['monthly']),
      yearly: toInt(lp['yearly']),
      monthlyDiscountPct: toInt(lp['monthly_discount_pct']),
      yearlyDiscountPct: toInt(lp['yearly_discount_pct']),
    );
  }
}

class _Pricing {
  final List<_Plan> plans;
  final String? currentPlanKey;
  final String? currentStatus;
  _Pricing(this.plans, this.currentPlanKey, this.currentStatus);
}

class SubscriptionScreen extends StatefulWidget {
  const SubscriptionScreen({super.key});

  @override
  State<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends State<SubscriptionScreen>
    with WidgetsBindingObserver {
  late Future<_Pricing> _future;
  String _cycle = 'monthly'; // monthly | yearly
  bool _busy = false;

  // Payment-return handling: after we launch the hosted checkout, we wait for
  // the user to return to the app and then reconcile with the server (mirrors
  // the web's `?dodo=return` → /api/billing/sync flow).
  bool _awaitingPayment = false;
  bool _checking = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _future = _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Came back from the browser checkout — confirm the payment automatically.
    if (state == AppLifecycleState.resumed &&
        _awaitingPayment &&
        !_checking) {
      _syncPayment();
    }
  }

  Future<_Pricing> _load() async {
    final app = context.read<AppState>();
    final fallbackPlanKey = app.activeOrg?.planKey;
    final res = await app.api.get('/api/billing/pricing');
    final map = res as Map<String, dynamic>;
    final plans = (map['plans'] as List? ?? [])
        .map((e) => _Plan.fromJson(e as Map<String, dynamic>))
        .toList();
    final cur = map['currentSubscription'] as Map?;
    return _Pricing(
      plans,
      cur?['plan_key']?.toString() ?? fallbackPlanKey,
      cur?['status']?.toString(),
    );
  }

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future;
  }

  int _price(_Plan p) => _cycle == 'yearly' ? p.yearly : p.monthly;
  int _discount(_Plan p) =>
      _cycle == 'yearly' ? p.yearlyDiscountPct : p.monthlyDiscountPct;
  int _final(_Plan p) {
    final base = _price(p);
    final pct = _discount(p);
    return pct > 0 ? (base * (100 - pct) / 100).round() : base;
  }

  Future<void> _choose(_Plan plan) async {
    final state = context.read<AppState>();
    if (!_isOwner) {
      _toast('Only the workspace owner can change the plan.');
      return;
    }
    setState(() => _busy = true);
    try {
      final res = await state.api.post('/api/billing/create-subscription', {
        'plan_key': plan.key,
        'cycle': _cycle,
      });
      final url = (res as Map)['checkout_url']?.toString();
      if (url != null && url.isNotEmpty) {
        final launched = await launchUrl(Uri.parse(url),
            mode: LaunchMode.externalApplication);
        if (launched) {
          setState(() => _awaitingPayment = true);
        } else {
          _toast('Could not open the checkout page.');
        }
      } else {
        // Stub / instant activation (no hosted checkout configured).
        _toast((res['message'] ?? 'Plan updated.').toString());
        await state.refresh();
        await _refresh();
      }
    } catch (e) {
      _toast(_clean(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Reconcile the latest subscription with the server. Polls a few times since
  /// the payment provider can take a moment to mark the subscription active.
  Future<void> _syncPayment() async {
    final state = context.read<AppState>();
    setState(() => _checking = true);
    String? lastStatus;
    try {
      for (var attempt = 0; attempt < 5; attempt++) {
        final res =
            await state.api.post('/api/billing/sync', <String, dynamic>{});
        final sub = (res as Map)['subscription'] as Map?;
        lastStatus = sub?['status']?.toString();
        if (lastStatus == 'active' || lastStatus == 'trialing') {
          await state.refresh();
          await _refresh();
          if (mounted) {
            setState(() => _awaitingPayment = false);
            _toast('Payment confirmed — you\'re on the new plan.');
          }
          return;
        }
        // Still pending — wait briefly and retry.
        await Future.delayed(const Duration(seconds: 2));
      }
      _toast(lastStatus == 'pending'
          ? 'Payment is still processing. Tap "Check payment status" in a moment.'
          : 'No completed payment found yet. If you paid, tap "Check payment status".');
    } catch (e) {
      _toast(_clean(e));
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  Future<void> _cancel() async {
    final state = context.read<AppState>();
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Cancel subscription?'),
        content: const Text(
            'Your premium access continues until the end of the current billing period, then reverts to Free.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(d, false),
              child: const Text('Keep plan')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Brand.expense),
            onPressed: () => Navigator.pop(d, true),
            child: const Text('Cancel plan'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      final res = await state.api.post('/api/billing/cancel');
      _toast((res as Map)['message']?.toString() ?? 'Subscription cancelled.');
      await state.refresh();
      await _refresh();
    } catch (e) {
      _toast(_clean(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  bool get _isOwner => context.read<AppState>().activeOrg?.role == 'owner';
  String _clean(Object e) => e.toString().replaceFirst('Exception: ', '');
  void _toast(String m) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Subscription')),
      body: FutureBuilder<_Pricing>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return Center(
                child: Text('Failed to load plans\n${_clean(snap.error!)}',
                    textAlign: TextAlign.center));
          }
          final data = snap.data!;
          final currentKey = data.currentPlanKey ?? 'free';
          final paidPlans = data.plans.where((p) => !p.isFree).toList();
          final currentName = data.plans
                  .where((p) => p.key == currentKey)
                  .map((p) => p.name)
                  .cast<String?>()
                  .firstWhere((_) => true, orElse: () => null) ??
              planDisplayName(currentKey);

          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 40),
              children: [
                _CurrentPlanCard(
                  planName: currentName,
                  isPremium: currentKey != 'free',
                  status: data.currentStatus,
                ),
                if (_awaitingPayment) ...[
                  const SizedBox(height: 16),
                  _AwaitingPaymentCard(
                    checking: _checking,
                    onCheck: _checking ? null : _syncPayment,
                  ),
                ],
                const SizedBox(height: 20),
                if (paidPlans.isNotEmpty) ...[
                  Center(
                    child: _CycleToggle(
                      value: _cycle,
                      yearlyDiscount: paidPlans.first.yearlyDiscountPct,
                      onChanged: (v) => setState(() => _cycle = v),
                    ),
                  ),
                  const SizedBox(height: 18),
                  ...paidPlans.map((p) => Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: _PlanCard(
                          name: p.name,
                          isCurrent: p.key == currentKey,
                          priceLabel: formatMoney(_final(p) / 100, p.currency),
                          originalLabel: _discount(p) > 0
                              ? formatMoney(_price(p) / 100, p.currency)
                              : null,
                          cycleLabel: _cycle == 'yearly' ? '/year' : '/month',
                          busy: _busy,
                          onSelect: () => _choose(p),
                        ),
                      )),
                ],
                const SizedBox(height: 8),
                if (currentKey != 'free')
                  TextButton(
                    onPressed: _busy ? null : _cancel,
                    child: Text('Cancel subscription',
                        style: TextStyle(
                            color: Brand.expense,
                            fontWeight: FontWeight.w600)),
                  ),
                if (!_isOwner)
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: Text(
                      'Only the workspace owner can change the plan.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                          fontSize: 12.5),
                    ),
                  ),
                Center(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text('Secured by Dodo Payments',
                        style: TextStyle(
                            color:
                                Theme.of(context).colorScheme.onSurfaceVariant,
                            fontSize: 12)),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _CurrentPlanCard extends StatelessWidget {
  const _CurrentPlanCard({
    required this.planName,
    required this.isPremium,
    required this.status,
  });
  final String planName;
  final bool isPremium;
  final String? status;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: LinearGradient(
          colors: isPremium
              ? const [Brand.blue, Brand.indigo]
              : [const Color(0xFF334155), const Color(0xFF1E293B)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        boxShadow: [
          BoxShadow(
            color: (isPremium ? Brand.blue : Colors.black)
                .withValues(alpha: 0.25),
            blurRadius: 22,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('CURRENT PLAN',
              style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.75),
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1)),
          const SizedBox(height: 8),
          Row(
            children: [
              Flexible(
                child: Text(planName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 26,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.5)),
              ),
              if (isPremium) ...[
                const SizedBox(width: 10),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: Brand.amber,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Text('PREMIUM',
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 10.5,
                          fontWeight: FontWeight.w800)),
                ),
              ],
            ],
          ),
          if (status != null) ...[
            const SizedBox(height: 6),
            Text(
              status == 'cancelled'
                  ? 'Cancels at the end of the period'
                  : 'Status: $status',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: Colors.white.withValues(alpha: 0.8)),
            ),
          ],
        ],
      ),
    );
  }
}

class _AwaitingPaymentCard extends StatelessWidget {
  const _AwaitingPaymentCard({required this.checking, required this.onCheck});
  final bool checking;
  final VoidCallback? onCheck;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Brand.amber.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Brand.amber.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.hourglass_top_rounded,
                  color: Brand.amber, size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Text('Finishing your payment',
                    style: TextStyle(
                        fontWeight: FontWeight.w700,
                        color: scheme.onSurface)),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Complete the checkout in your browser, then return here. We\'ll confirm it automatically.',
            style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: onCheck,
              child: checking
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2.2, color: Colors.white))
                  : const Text('Check payment status'),
            ),
          ),
        ],
      ),
    );
  }
}

class _CycleToggle extends StatelessWidget {
  const _CycleToggle({
    required this.value,
    required this.onChanged,
    required this.yearlyDiscount,
  });
  final String value;
  final ValueChanged<String> onChanged;
  final int yearlyDiscount;

  @override
  Widget build(BuildContext context) {
    Widget seg(String key, String label) {
      final selected = value == key;
      return Pressable(
        onTap: () => onChanged(key),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 9),
          decoration: BoxDecoration(
            color: selected ? Brand.blue : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text(label,
              style: TextStyle(
                  fontWeight: FontWeight.w700,
                  color: selected
                      ? Colors.white
                      : Theme.of(context).colorScheme.onSurfaceVariant)),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: Theme.of(context).dividerColor),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          seg('monthly', 'Monthly'),
          seg('yearly',
              yearlyDiscount > 0 ? 'Yearly -$yearlyDiscount%' : 'Yearly'),
        ],
      ),
    );
  }
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({
    required this.name,
    required this.isCurrent,
    required this.priceLabel,
    required this.originalLabel,
    required this.cycleLabel,
    required this.busy,
    required this.onSelect,
  });
  final String name;
  final bool isCurrent;
  final String priceLabel;
  final String? originalLabel;
  final String cycleLabel;
  final bool busy;
  final VoidCallback onSelect;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: isCurrent ? Brand.blue : Theme.of(context).dividerColor,
          width: isCurrent ? 1.6 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: scheme.onSurface)),
              ),
              if (isCurrent) ...[
                const SizedBox(width: 8),
                StatusChip(label: 'current', color: Brand.blue),
              ],
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Flexible(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(priceLabel,
                      maxLines: 1,
                      style: TextStyle(
                          fontSize: 30,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -1,
                          color: scheme.onSurface,
                          fontFeatures: kTabular)),
                ),
              ),
              const SizedBox(width: 4),
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text(cycleLabel,
                    style: TextStyle(color: scheme.onSurfaceVariant)),
              ),
              if (originalLabel != null) ...[
                const SizedBox(width: 8),
                Flexible(
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerRight,
                      child: Text(originalLabel!,
                          maxLines: 1,
                          style: TextStyle(
                              color: scheme.onSurfaceVariant,
                              decoration: TextDecoration.lineThrough)),
                    ),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 14),
          GradientButton(
            label: isCurrent ? 'Renew / change cycle' : 'Upgrade to $name',
            loading: busy,
            onPressed: onSelect,
            height: 48,
          ),
        ],
      ),
    );
  }
}
