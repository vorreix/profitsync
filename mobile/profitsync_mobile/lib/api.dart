import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'config.dart';

class ApiException implements Exception {
  final int status;
  final String message;
  final String? code;
  ApiException(this.status, this.message, {this.code});
  @override
  String toString() => message;
}

/// Thin HTTP client for the ProfitSync API. Attaches the Clerk bearer token
/// and the `x-org-id` scoping header on every request, and keeps a short GET
/// cache to collapse the burst of fetches on screen mount.
class ApiClient {
  ApiClient({required this.tokenProvider, required this.orgIdProvider});

  final Future<String?> Function() tokenProvider;
  final String? Function() orgIdProvider;

  static const _ttl = Duration(seconds: 20);
  final Map<String, _CacheEntry> _cache = {};
  final Map<String, Future<dynamic>> _inflight = {};

  String _cacheKey(String path) => '${orgIdProvider() ?? ''}::$path';

  void clearCache() {
    _cache.clear();
    _inflight.clear();
  }

  Future<Map<String, String>> _headers({bool json = false}) async {
    final token = await tokenProvider();
    final orgId = orgIdProvider();
    return {
      if (token != null) 'Authorization': 'Bearer $token',
      if (orgId != null) 'x-org-id': orgId,
      if (json) 'Content-Type': 'application/json',
    };
  }

  Uri _uri(String path) => Uri.parse('${AppConfig.apiBaseUrl}$path');

  dynamic _decode(http.Response res) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      if (res.body.isEmpty) return null;
      return jsonDecode(res.body);
    }
    String message = 'HTTP ${res.statusCode}';
    String? code;
    try {
      final body = jsonDecode(res.body);
      if (body is Map) {
        message = (body['error'] ?? body['reason'] ?? message).toString();
        code = body['code']?.toString();
      }
    } catch (_) {
      if (res.body.isNotEmpty) message = res.body;
    }
    throw ApiException(res.statusCode, message, code: code);
  }

  Future<dynamic> get(String path, {bool useCache = true}) {
    final key = _cacheKey(path);
    if (useCache) {
      final hit = _cache[key];
      if (hit != null && DateTime.now().difference(hit.ts) < _ttl) {
        return Future.value(hit.data);
      }
      final pending = _inflight[key];
      if (pending != null) return pending;
    }
    final future = () async {
      final res = await http.get(_uri(path), headers: await _headers());
      final data = _decode(res);
      _cache[key] = _CacheEntry(data);
      _inflight.remove(key);
      return data;
    }();
    _inflight[key] = future;
    return future.catchError((e) {
      _inflight.remove(key);
      throw e;
    });
  }

  Future<dynamic> _mutate(String method, String path, dynamic body) async {
    final headers = await _headers(json: body != null);
    final uri = _uri(path);
    final encoded = body != null ? jsonEncode(body) : null;
    late http.Response res;
    switch (method) {
      case 'POST':
        res = await http.post(uri, headers: headers, body: encoded);
        break;
      case 'PATCH':
        res = await http.patch(uri, headers: headers, body: encoded);
        break;
      case 'DELETE':
        res = await http.delete(uri, headers: headers, body: encoded);
        break;
      default:
        throw ApiException(0, 'Unsupported method $method');
    }
    final data = _decode(res);
    clearCache(); // writes can change any list/aggregate
    return data;
  }

  Future<dynamic> post(String path, [dynamic body]) =>
      _mutate('POST', path, body);
  Future<dynamic> patch(String path, [dynamic body]) =>
      _mutate('PATCH', path, body);
  Future<dynamic> delete(String path, [dynamic body]) =>
      _mutate('DELETE', path, body);
}

class _CacheEntry {
  final dynamic data;
  final DateTime ts;
  _CacheEntry(this.data) : ts = DateTime.now();
}
