// Data models mirroring the ProfitSync API (snake_case JSON from `serialize()`).

double _toDouble(dynamic v) {
  if (v == null) return 0;
  if (v is num) return v.toDouble();
  return double.tryParse(v.toString()) ?? 0;
}

class UserProfile {
  final String id;
  final String email;
  final String fullName;
  final String currency;
  final String language;
  final String? currentOrganizationId;
  final String? onboardedAt;
  final String? termsAcceptedAt;

  UserProfile({
    required this.id,
    required this.email,
    required this.fullName,
    required this.currency,
    required this.language,
    this.currentOrganizationId,
    this.onboardedAt,
    this.termsAcceptedAt,
  });

  bool get needsOnboarding => onboardedAt == null;

  factory UserProfile.fromJson(Map<String, dynamic> j) => UserProfile(
        id: j['id']?.toString() ?? '',
        email: j['email']?.toString() ?? '',
        fullName: j['full_name']?.toString() ?? '',
        currency: j['currency']?.toString() ?? 'USD',
        language: j['language']?.toString() ?? 'en',
        currentOrganizationId: j['current_organization_id']?.toString(),
        onboardedAt: j['onboarded_at']?.toString(),
        termsAcceptedAt: j['terms_accepted_at']?.toString(),
      );
}

class Organization {
  final String id;
  final String name;
  final String slug;
  final bool isPersonal;
  final String? accountType; // 'personal' | 'business'
  final String currency;
  final String role;
  final String? planKey;
  final String? planStatus;

  Organization({
    required this.id,
    required this.name,
    required this.slug,
    required this.isPersonal,
    required this.accountType,
    required this.currency,
    required this.role,
    this.planKey,
    this.planStatus,
  });

  bool get isBusiness => accountType != 'personal';
  bool get isPremium => (planKey ?? 'free') != 'free';

  factory Organization.fromJson(Map<String, dynamic> j) => Organization(
        id: j['id']?.toString() ?? '',
        name: j['name']?.toString() ?? '',
        slug: j['slug']?.toString() ?? '',
        isPersonal: j['is_personal'] == true,
        accountType: j['account_type']?.toString(),
        currency: j['currency']?.toString() ?? 'USD',
        role: j['role']?.toString() ?? 'viewer',
        planKey: j['plan_key']?.toString(),
        planStatus: j['plan_status']?.toString(),
      );
}

class Client {
  final String id;
  final String name;
  final String company;
  final String email;
  final String phone;
  final String status;
  final String notes;
  final bool isOwn;
  final double totalIncoming;
  final double totalOutgoing;

  Client({
    required this.id,
    required this.name,
    required this.company,
    required this.email,
    required this.phone,
    required this.status,
    required this.notes,
    required this.isOwn,
    required this.totalIncoming,
    required this.totalOutgoing,
  });

  double get net => totalIncoming - totalOutgoing;

  factory Client.fromJson(Map<String, dynamic> j) => Client(
        id: j['id']?.toString() ?? '',
        name: j['name']?.toString() ?? '',
        company: j['company']?.toString() ?? '',
        email: j['email']?.toString() ?? '',
        phone: j['phone']?.toString() ?? '',
        status: j['status']?.toString() ?? 'active',
        notes: j['notes']?.toString() ?? '',
        isOwn: j['is_own'] == true,
        totalIncoming: _toDouble(j['total_incoming']),
        totalOutgoing: _toDouble(j['total_outgoing']),
      );
}

class Transaction {
  final String id;
  final String clientId;
  final String? clientName;
  final String type; // incoming | outgoing
  final double amount;
  final String description;
  final String category;
  final String date;

  Transaction({
    required this.id,
    required this.clientId,
    required this.clientName,
    required this.type,
    required this.amount,
    required this.description,
    required this.category,
    required this.date,
  });

  bool get isIncoming => type == 'incoming';

  factory Transaction.fromJson(Map<String, dynamic> j) => Transaction(
        id: j['id']?.toString() ?? '',
        clientId: j['client_id']?.toString() ?? '',
        clientName: j['client_name']?.toString(),
        type: j['type']?.toString() ?? 'incoming',
        amount: _toDouble(j['amount']),
        description: j['description']?.toString() ?? '',
        category: j['category']?.toString() ?? '',
        date: j['date']?.toString() ?? '',
      );
}

class Quotation {
  final String id;
  final String title;
  final String prospectName;
  final String company;
  final String email;
  final String phone;
  final double amount;
  final String status; // draft | sent | accepted | rejected
  final String notes;
  final String? linkedClientId;

  Quotation({
    required this.id,
    required this.title,
    required this.prospectName,
    required this.company,
    required this.email,
    required this.phone,
    required this.amount,
    required this.status,
    required this.notes,
    this.linkedClientId,
  });

  factory Quotation.fromJson(Map<String, dynamic> j) => Quotation(
        id: j['id']?.toString() ?? '',
        title: j['title']?.toString() ?? '',
        prospectName: j['prospect_name']?.toString() ?? '',
        company: j['company']?.toString() ?? '',
        email: j['email']?.toString() ?? '',
        phone: j['phone']?.toString() ?? '',
        amount: _toDouble(j['amount']),
        status: j['status']?.toString() ?? 'draft',
        notes: j['notes']?.toString() ?? '',
        linkedClientId: j['linked_client_id']?.toString(),
      );
}
