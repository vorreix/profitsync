import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'models.dart';

const _kActiveOrgKey = 'ps_active_org';

/// Central app state: the signed-in user's profile, their organizations, and
/// the active workspace. Mirrors the web app's OrgProvider + CurrencyProvider.
class AppState extends ChangeNotifier {
  AppState({required this.api});

  final ApiClient api;

  bool loading = true;
  String? error;
  UserProfile? profile;
  List<Organization> orgs = [];
  String? _activeOrgId;

  String? get activeOrgId => _activeOrgId;

  Organization? get activeOrg {
    if (_activeOrgId == null) return null;
    for (final o in orgs) {
      if (o.id == _activeOrgId) return o;
    }
    return orgs.isNotEmpty ? orgs.first : null;
  }

  bool get needsOnboarding => profile != null && profile!.needsOnboarding;

  String get currency => activeOrg?.currency ?? profile?.currency ?? 'USD';

  bool get isBusiness => activeOrg?.isBusiness ?? true;

  bool get canWrite {
    final r = activeOrg?.role ?? 'viewer';
    return r == 'owner' || r == 'admin' || r == 'editor';
  }

  bool get canDelete {
    final r = activeOrg?.role ?? 'viewer';
    return r == 'owner' || r == 'admin';
  }

  Future<void> loadStoredOrg() async {
    final prefs = await SharedPreferences.getInstance();
    _activeOrgId = prefs.getString(_kActiveOrgKey);
  }

  Future<void> _persistOrg() async {
    final prefs = await SharedPreferences.getInstance();
    if (_activeOrgId == null) {
      await prefs.remove(_kActiveOrgKey);
    } else {
      await prefs.setString(_kActiveOrgKey, _activeOrgId!);
    }
  }

  /// Fetch profile + organizations and resolve the active workspace.
  Future<void> bootstrap() async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      await loadStoredOrg();
      final results = await Future.wait([
        api.get('/api/profile'),
        api.get('/api/organizations'),
      ]);
      profile = UserProfile.fromJson(results[0] as Map<String, dynamic>);
      orgs = (results[1] as List)
          .map((e) => Organization.fromJson(e as Map<String, dynamic>))
          .toList();
      _resolveActiveOrg();
    } on ApiException catch (e) {
      error = e.message;
    } catch (e) {
      error = e.toString();
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  void _resolveActiveOrg() {
    final ids = orgs.map((o) => o.id).toSet();
    if (_activeOrgId != null && ids.contains(_activeOrgId)) return;
    _activeOrgId = profile?.currentOrganizationId != null &&
            ids.contains(profile!.currentOrganizationId)
        ? profile!.currentOrganizationId
        : (orgs.isNotEmpty ? orgs.first.id : null);
    _persistOrg();
  }

  Future<void> refresh() async {
    try {
      final results = await Future.wait([
        api.get('/api/profile', useCache: false),
        api.get('/api/organizations', useCache: false),
      ]);
      profile = UserProfile.fromJson(results[0] as Map<String, dynamic>);
      orgs = (results[1] as List)
          .map((e) => Organization.fromJson(e as Map<String, dynamic>))
          .toList();
      _resolveActiveOrg();
      notifyListeners();
    } catch (_) {
      // keep existing state on a refresh failure
    }
  }

  Future<void> switchOrg(String id) async {
    if (id == _activeOrgId) return;
    _activeOrgId = id;
    api.clearCache();
    await _persistOrg();
    notifyListeners();
    try {
      await api.post('/api/organizations/switch', {'organization_id': id});
    } catch (_) {}
    await refresh();
  }

  /// Create a new (business) workspace, then switch into it — mirrors the web's
  /// create-organization flow. Returns the new org id.
  Future<String> createOrg(String name) async {
    final res = await api.post('/api/organizations', {'name': name.trim()});
    final id = (res as Map)['id']?.toString();
    await refresh();
    if (id != null) {
      await switchOrg(id);
      return id;
    }
    return _activeOrgId ?? '';
  }

  /// Change the active org's currency (owner/admin only, enforced server-side),
  /// then refresh so every screen re-renders with the new currency.
  Future<void> changeCurrency(String code) async {
    final org = activeOrg;
    if (org == null) return;
    await api.patch('/api/organizations/${org.id}', {'currency': code});
    await refresh();
  }

  /// Complete onboarding: POST the account-type choice, then refresh so the
  /// gate routes into the app.
  Future<void> completeOnboarding({
    required String accountType,
    String? companyName,
  }) async {
    final res = await api.post('/api/onboarding', {
      'account_type': accountType,
      if (accountType == 'business' && (companyName?.isNotEmpty ?? false))
        'company_name': companyName,
    });
    final orgId = (res as Map)['organization_id']?.toString();
    if (orgId != null) {
      _activeOrgId = orgId;
      await _persistOrg();
    }
    await refresh();
  }

  void reset() {
    loading = true;
    error = null;
    profile = null;
    orgs = [];
    _activeOrgId = null;
    api.clearCache();
    notifyListeners();
  }
}
