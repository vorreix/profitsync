# ProfitSync i18n Priority Fixes

Generated: 2026-06-15T22:05:19.750Z

Source: `docs/i18n-coverage-report.md`

## Summary

| Priority | Count |
|---|---:|
| P1 - User-facing UI | 114 |
| P2 - Secondary UI | 553 |
| P3 - Low priority | 27 |
| P4 - Do not translate | 10 |
| Total classified findings | 704 |

## Classification Rules

- P1: primary user-facing UI such as buttons, navigation, dashboard cards, forms, placeholders, dialogs, validation messages, toasts, empty states, and core app workflows.
- P2: secondary UI such as settings, admin screens, reports, onboarding, marketing/SEO content, and locale entries not in the primary app workflow.
- P3: low-priority developer, debug, story, or test-facing text.
- P4: values that should generally remain untranslated, including bank names, organization or sample names, user-entered content, brand names, country codes, and currency codes.

## Counts By Source Category

| Priority | Missing translation key | Hardcoded text | Dynamic text bypassing i18n | Missing Malayalam entry |
|---|---:|---:|---:|---:|
| P1 - User-facing UI | 6 | 87 | 21 | 0 |
| P2 - Secondary UI | 160 | 315 | 45 | 33 |
| P3 - Low priority | 5 | 22 | 0 | 0 |
| P4 - Do not translate | 1 | 8 | 1 | 0 |

## Notes

- P4 rows are intentionally retained so they can be excluded from translation work explicitly instead of disappearing from planning.
- Some rows from the source audit may still need product judgment, especially SEO copy, country names, language names, and sample/demo content.
- This report is a prioritization document only. It does not translate strings or change application code.

## P1 - User-facing UI

| Source category | File | Line | Current text | Proposed translation key |
|---|---|---:|---|---|
| Missing translation key | `src/components/wealth/icon-select.tsx` | 13 | Bank | `wealth.iconselect.bank` |
| Missing translation key | `src/components/wealth/icon-select.tsx` | 14 | Card | `wealth.iconselect.card` |
| Missing translation key | `src/components/wealth/icon-select.tsx` | 15 | Cash | `wealth.iconselect.cash` |
| Missing translation key | `src/components/wealth/icon-select.tsx` | 16 | Wallet | `wealth.iconselect.wallet` |
| Missing translation key | `src/components/wealth/icon-select.tsx` | 17 | Business | `wealth.iconselect.business` |
| Missing translation key | `src/components/wealth/icon-select.tsx` | 18 | Custom | `wealth.iconselect.custom` |
| Hardcoded text | `src/components/ClientDetailSheet.tsx` | 59 | Closed | `ClientDetail.closed` |
| Hardcoded text | `src/components/ClientOverviewModal.tsx` | 133 | Closed | `ClientOverview.closed` |
| Hardcoded text | `src/components/ClientOverviewModal.tsx` | 141 | Income | `ClientOverview.income` |
| Hardcoded text | `src/components/ClientOverviewModal.tsx` | 145 | Expense | `ClientOverview.expense` |
| Hardcoded text | `src/components/ClientOverviewModal.tsx` | 149 | Profit | `ClientOverview.profit` |
| Hardcoded text | `src/components/ClientOverviewModal.tsx` | 172 | Documents | `ClientOverview.documents` |
| Hardcoded text | `src/components/ClientOverviewModal.tsx` | 176 | Upload | `ClientOverview.upload` |
| Hardcoded text | `src/components/CountryCombobox.tsx` | 46 | Search country… | `CountryCombobox.searchCountry` |
| Hardcoded text | `src/components/CountryCombobox.tsx` | 91 | Search code… | `CountryCombobox.searchCode` |
| Hardcoded text | `src/components/CurrencyCombobox.tsx` | 51 | Search by currency, code, or country... | `CurrencyCombobox.searchByCurrencyCodeOr` |
| Hardcoded text | `src/components/MobileAppLayout.tsx` | 214 | Home | `MobileAppLayout.home` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 374 | Closed | `ClientDetail.closed` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 380 | Onboarded | `ClientDetail.onboarded` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 425 | Income | `ClientDetail.income` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 430 | Expenses | `ClientDetail.expenses` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 435 | Net | `ClientDetail.net` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 450 | Budget | `ClientDetail.budget` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 454 | Edit | `ClientDetail.edit` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 493 | Amount (high → low) | `ClientDetail.amountHighLow` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 494 | Amount (low → high) | `ClientDetail.amountLowHigh` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 500 | From | `ClientDetail.from` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 501 | To | `ClientDetail.to` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 507 | Files | `ClientDetail.files` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 559 | Type | `ClientDetail.type` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 581 | Description | `ClientDetail.description` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 584 | Category | `ClientDetail.category` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 594 | Attachments | `ClientDetail.attachments` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 606 | Remove | `ClientDetail.remove` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 616 | Cancel | `ClientDetail.cancel` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 629 | Type | `ClientDetail.type` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 652 | Description | `ClientDetail.description` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 655 | Category | `ClientDetail.category` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 666 | Cancel | `ClientDetail.cancel` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 678 | Name * | `ClientDetail.name` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 679 | Company | `ClientDetail.company` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 681 | Phone | `ClientDetail.phone` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 683 | Status | `ClientDetail.status` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 693 | Category | `ClientDetail.category` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 696 | Notes | `ClientDetail.notes` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 700 | Cancel | `ClientDetail.cancel` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 716 | Cancel | `ClientDetail.cancel` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 736 | Cancel | `ClientDetail.cancel` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 754 | Transaction | `ClientDetail.transaction` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 763 | Category | `ClientDetail.category` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 765 | Description | `ClientDetail.description` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 767 | Attachments | `ClientDetail.attachments` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 788 | History | `ClientDetail.history` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 794 | Edit | `ClientDetail.edit` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 796 | Close | `ClientDetail.close` |
| Hardcoded text | `src/pages/ClientFilesPage.tsx` | 246 | Search files… | `ClientFiles.searchFiles` |
| Hardcoded text | `src/pages/ClientFilesPage.tsx` | 284 | Upload | `ClientFiles.upload` |
| Hardcoded text | `src/pages/ClientFilesPage.tsx` | 298 | Upload documents, or attach files to transactions and quotations. | `ClientFiles.uploadDocumentsOrAttachFiles` |
| Hardcoded text | `src/pages/ClientFilesPage.tsx` | 333 | Download | `ClientFiles.download` |
| Hardcoded text | `src/pages/ClientFilesPage.tsx` | 369 | Delete attachment? | `ClientFiles.deleteAttachment` |
| Hardcoded text | `src/pages/ClientFilesPage.tsx` | 375 | Cancel | `ClientFiles.cancel` |
| Hardcoded text | `src/pages/InvitationPage.tsx` | 159 | You're invited to | `Invitation.youReInvitedTo` |
| Hardcoded text | `src/pages/InvitationPage.tsx` | 161 | · for | `Invitation.for` |
| Hardcoded text | `src/pages/InvitationPage.tsx` | 183 | , but you're signed in as | `Invitation.butYouReSignedIn` |
| Hardcoded text | `src/pages/InvitationPage.tsx` | 199 | Joining | `Invitation.joining` |
| Hardcoded text | `src/pages/InvitationPage.tsx` | 206 | Decline | `Invitation.decline` |
| Hardcoded text | `src/pages/InvitationPage.tsx` | 210 | Accept | `Invitation.accept` |
| Hardcoded text | `src/pages/InvitationPage.tsx` | 216 | Expires | `Invitation.expires` |
| Hardcoded text | `src/pages/PrivacyPolicyPage.tsx` | 21 | name, email address, password hash, and authentication metadata supplied via our identity provider (Clerk). | `PrivacyPolicy.nameEmailAddressPasswordHash` |
| Hardcoded text | `src/pages/PrivacyPolicyPage.tsx` | 22 | organization names, memberships, and roles you create within the Service. | `PrivacyPolicy.organizationNamesMembershipsAndRoles` |
| Hardcoded text | `src/pages/PrivacyPolicyPage.tsx` | 24 | IP address, browser type, timestamps, and pages viewed for security, fraud prevention, and analytics. | `PrivacyPolicy.ipAddressBrowserTypeTimestamps` |
| Hardcoded text | `src/pages/PrivacyPolicyPage.tsx` | 38 | We do not sell your personal data. We share limited data with sub-processors strictly to deliver the Service: Clerk (authentication), Neon (database hosting), Vercel (application hosting), and Dodo Payments (our Merchant of Record for subscription payments, when applicable). Each sub-processor is contractually bound to handle data consistent with applicable privacy laws. | `PrivacyPolicy.weDoNotSellYour` |
| Hardcoded text | `src/pages/PrivacyPolicyPage.tsx` | 46 | We retain personal data while your account is active. When you delete an organization or your account, related business data is permanently removed within 30 days, except where retention is required by law. | `PrivacyPolicy.weRetainPersonalDataWhile` |
| Hardcoded text | `src/pages/PrivacyPolicyPage.tsx` | 52 | You have the right to access, correct, export, or delete your personal data. To exercise any of these rights, contact us at | `PrivacyPolicy.youHaveTheRightTo` |
| Hardcoded text | `src/pages/PrivacyPolicyPage.tsx` | 64 | Your data may be processed in regions outside your country. Where required, we rely on Standard Contractual Clauses or other lawful mechanisms. | `PrivacyPolicy.yourDataMayBeProcessed` |
| Hardcoded text | `src/pages/RefundPolicyPage.tsx` | 26 | You can cancel anytime from the Subscription page; cancellation stops future renewals and your plan stays active until the end of the current paid period. | `RefundPolicy.youCanCancelAnytimeFrom` |
| Hardcoded text | `src/pages/RefundPolicyPage.tsx` | 27 | We do not provide automatic, prorated refunds for the unused portion of a billing period after a cancellation. | `RefundPolicy.weDoNotProvideAutomatic` |
| Hardcoded text | `src/pages/RefundPolicyPage.tsx` | 59 | from the address associated with your account, including the charge date and amount. We aim to respond within 3 business days. Approved refunds are processed by Dodo Payments and may take several business days to appear, depending on your bank or card issuer. | `RefundPolicy.fromTheAddressAssociatedWith` |
| Hardcoded text | `src/pages/SignupPage.tsx` | 68 | Before you continue, please review and accept our legal documents. | `Signup.beforeYouContinuePleaseReview` |
| Hardcoded text | `src/pages/SignupPage.tsx` | 75 | View | `Signup.view` |
| Hardcoded text | `src/pages/SignupPage.tsx` | 79 | View | `Signup.view` |
| Hardcoded text | `src/pages/SignupPage.tsx` | 105 | Already have an account? | `Signup.alreadyHaveAnAccount` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 35 | upload malware or content that infringes intellectual-property or privacy rights; | `TermsOfService.uploadMalwareOrContentThat` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 40 | 4. Subscriptions, renewals &amp; cancellation | `TermsOfService.4SubscriptionsRenewalsAmpCancellation` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 44 | You may cancel anytime from the Subscription page; cancellation stops future renewals and your plan stays active until the end of the current paid period. | `TermsOfService.youMayCancelAnytimeFrom` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 73 | You retain ownership of the business data you enter into the Service. You grant us a limited license to host and process this data solely to provide and secure the Service. You can export or delete your data; we access it only for support, security, or as required by law. See the | `TermsOfService.youRetainOwnershipOfThe` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 81 | Each organization has owners, admins, editors, and viewers. The organization owner is responsible for managing memberships, permissions, and the organization's subscription. Org owners are responsible for the actions of members they invite. | `TermsOfService.eachOrganizationHasOwnersAdmins` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 88 | The Service relies on third parties — Clerk (authentication), Neon (database), Vercel (hosting), and Dodo Payments (Merchant of Record for billing). Your use of those features is also subject to those providers' terms. We are not responsible for third-party outages or actions outside our control. | `TermsOfService.theServiceReliesOnThird` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 95 | We aim for high availability but do not guarantee uninterrupted access. We may perform maintenance, updates, or take the Service offline temporarily, and will try to minimize disruption. | `TermsOfService.weAimForHighAvailability` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 101 | The Service is provided "as is" and "as available" without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. ProfitSync helps you record financial information but is not a substitute for professional accounting, tax, or legal advice. | `TermsOfService.theServiceIsProvidedAs` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 122 | We may suspend or terminate accounts that violate these Terms or applicable law. You may close your account at any time. Upon termination, your data is deleted as described in our Privacy Policy, subject to records we must retain by law. | `TermsOfService.weMaySuspendOrTerminate` |
| Hardcoded text | `src/pages/TransactionsPage.tsx` | 599 | shrink-0 ml-auto | `Transactions.shrink0MlAuto` |
| Hardcoded text | `src/pages/TransactionsPage.tsx` | 722 | Own | `Transactions.own` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 257 | Income | `ClientDetail.income` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 257 | Expense | `ClientDetail.expense` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 528 | Income | `ClientDetail.income` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 528 | Expense | `ClientDetail.expense` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 568 | Incoming | `ClientDetail.incoming` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 568 | Outgoing | `ClientDetail.outgoing` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 617 | Adding... | `ClientDetail.adding` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 617 | Add | `ClientDetail.add` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 638 | Incoming | `ClientDetail.incoming` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 638 | Outgoing | `ClientDetail.outgoing` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 667 | Saving... | `ClientDetail.saving` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 667 | Save | `ClientDetail.save` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 701 | Saving... | `ClientDetail.saving` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 701 | Save | `ClientDetail.save` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 710 | Move Client to Trash? | `ClientDetail.moveClientToTrash` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 710 | Delete Transaction? | `ClientDetail.deleteTransaction` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 728 | Reopen this client? | `ClientDetail.reopenThisClient` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 728 | Close this client? | `ClientDetail.closeThisClient` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 738 | Reopen | `ClientDetail.reopen` |
| Dynamic text bypassing i18n | `src/pages/ClientDetailPage.tsx` | 738 | Close | `ClientDetail.close` |
| Dynamic text bypassing i18n | `src/pages/InvitationPage.tsx` | 113 | Failed | `Invitation.failed` |

## P2 - Secondary UI

| Source category | File | Line | Current text | Proposed translation key |
|---|---|---:|---|---|
| Missing translation key | `src/landing/i18n/languages.ts` | 14 | English | `landing.i18n.languages.english` |
| Missing translation key | `src/landing/i18n/languages.ts` | 15 | Italiano | `landing.i18n.languages.italiano` |
| Missing translation key | `src/landing/i18n/languages.ts` | 15 | Italian | `landing.i18n.languages.italian` |
| Missing translation key | `src/landing/i18n/languages.ts` | 16 | Deutsch | `landing.i18n.languages.deutsch` |
| Missing translation key | `src/landing/i18n/languages.ts` | 16 | German | `landing.i18n.languages.german` |
| Missing translation key | `src/landing/i18n/languages.ts` | 17 | Hindi | `landing.i18n.languages.hindi` |
| Missing translation key | `src/landing/i18n/languages.ts` | 18 | Malayalam | `landing.i18n.languages.malayalam` |
| Missing translation key | `src/landing/i18n/languages.ts` | 19 | Tamil | `landing.i18n.languages.tamil` |
| Missing translation key | `src/landing/i18n/languages.ts` | 20 | Telugu | `landing.i18n.languages.telugu` |
| Missing translation key | `src/landing/i18n/languages.ts` | 21 | Arabic | `landing.i18n.languages.arabic` |
| Missing translation key | `src/lib/admin-roles.ts` | 54 | Full access — including plans, settings and managing other admins. | `lib.adminroles.fullAccessIncludingPlansSettings` |
| Missing translation key | `src/lib/admin-roles.ts` | 57 | Editor | `lib.adminroles.editor` |
| Missing translation key | `src/lib/admin-roles.ts` | 58 | View and edit users, organizations, subscriptions, invoices and blog. No settings or admin management. | `lib.adminroles.viewAndEditUsersOrganizations` |
| Missing translation key | `src/lib/admin-roles.ts` | 61 | Viewer | `lib.adminroles.viewer` |
| Missing translation key | `src/lib/admin-roles.ts` | 62 | Read-only access to the admin console. | `lib.adminroles.readOnlyAccessToThe` |
| Missing translation key | `src/lib/countries.ts` | 11 | Afghanistan | `lib.countries.afghanistan` |
| Missing translation key | `src/lib/countries.ts` | 12 | Albania | `lib.countries.albania` |
| Missing translation key | `src/lib/countries.ts` | 13 | Algeria | `lib.countries.algeria` |
| Missing translation key | `src/lib/countries.ts` | 14 | Argentina | `lib.countries.argentina` |
| Missing translation key | `src/lib/countries.ts` | 15 | Armenia | `lib.countries.armenia` |
| Missing translation key | `src/lib/countries.ts` | 16 | Australia | `lib.countries.australia` |
| Missing translation key | `src/lib/countries.ts` | 17 | Austria | `lib.countries.austria` |
| Missing translation key | `src/lib/countries.ts` | 18 | Azerbaijan | `lib.countries.azerbaijan` |
| Missing translation key | `src/lib/countries.ts` | 19 | Bahrain | `lib.countries.bahrain` |
| Missing translation key | `src/lib/countries.ts` | 20 | Bangladesh | `lib.countries.bangladesh` |
| Missing translation key | `src/lib/countries.ts` | 21 | Belarus | `lib.countries.belarus` |
| Missing translation key | `src/lib/countries.ts` | 22 | Belgium | `lib.countries.belgium` |
| Missing translation key | `src/lib/countries.ts` | 23 | Bolivia | `lib.countries.bolivia` |
| Missing translation key | `src/lib/countries.ts` | 25 | Brazil | `lib.countries.brazil` |
| Missing translation key | `src/lib/countries.ts` | 26 | Bulgaria | `lib.countries.bulgaria` |
| Missing translation key | `src/lib/countries.ts` | 27 | Cambodia | `lib.countries.cambodia` |
| Missing translation key | `src/lib/countries.ts` | 28 | Cameroon | `lib.countries.cameroon` |
| Missing translation key | `src/lib/countries.ts` | 29 | Canada | `lib.countries.canada` |
| Missing translation key | `src/lib/countries.ts` | 30 | Chile | `lib.countries.chile` |
| Missing translation key | `src/lib/countries.ts` | 31 | China | `lib.countries.china` |
| Missing translation key | `src/lib/countries.ts` | 32 | Colombia | `lib.countries.colombia` |
| Missing translation key | `src/lib/countries.ts` | 34 | Croatia | `lib.countries.croatia` |
| Missing translation key | `src/lib/countries.ts` | 35 | Cyprus | `lib.countries.cyprus` |
| Missing translation key | `src/lib/countries.ts` | 36 | Czechia | `lib.countries.czechia` |
| Missing translation key | `src/lib/countries.ts` | 37 | Denmark | `lib.countries.denmark` |
| Missing translation key | `src/lib/countries.ts` | 39 | Ecuador | `lib.countries.ecuador` |
| Missing translation key | `src/lib/countries.ts` | 40 | Egypt | `lib.countries.egypt` |
| Missing translation key | `src/lib/countries.ts` | 42 | Estonia | `lib.countries.estonia` |
| Missing translation key | `src/lib/countries.ts` | 43 | Ethiopia | `lib.countries.ethiopia` |
| Missing translation key | `src/lib/countries.ts` | 44 | Finland | `lib.countries.finland` |
| Missing translation key | `src/lib/countries.ts` | 45 | France | `lib.countries.france` |
| Missing translation key | `src/lib/countries.ts` | 46 | Georgia | `lib.countries.georgia` |
| Missing translation key | `src/lib/countries.ts` | 47 | Germany | `lib.countries.germany` |
| Missing translation key | `src/lib/countries.ts` | 48 | Ghana | `lib.countries.ghana` |
| Missing translation key | `src/lib/countries.ts` | 49 | Greece | `lib.countries.greece` |
| Missing translation key | `src/lib/countries.ts` | 50 | Guatemala | `lib.countries.guatemala` |
| Missing translation key | `src/lib/countries.ts` | 51 | Honduras | `lib.countries.honduras` |
| Missing translation key | `src/lib/countries.ts` | 53 | Hungary | `lib.countries.hungary` |
| Missing translation key | `src/lib/countries.ts` | 54 | Iceland | `lib.countries.iceland` |
| Missing translation key | `src/lib/countries.ts` | 55 | India | `lib.countries.india` |
| Missing translation key | `src/lib/countries.ts` | 56 | Indonesia | `lib.countries.indonesia` |
| Missing translation key | `src/lib/countries.ts` | 57 | Iraq | `lib.countries.iraq` |
| Missing translation key | `src/lib/countries.ts` | 58 | Ireland | `lib.countries.ireland` |
| Missing translation key | `src/lib/countries.ts` | 59 | Israel | `lib.countries.israel` |
| Missing translation key | `src/lib/countries.ts` | 60 | Italy | `lib.countries.italy` |
| Missing translation key | `src/lib/countries.ts` | 61 | Jamaica | `lib.countries.jamaica` |
| Missing translation key | `src/lib/countries.ts` | 62 | Japan | `lib.countries.japan` |
| Missing translation key | `src/lib/countries.ts` | 63 | Jordan | `lib.countries.jordan` |
| Missing translation key | `src/lib/countries.ts` | 64 | Kazakhstan | `lib.countries.kazakhstan` |
| Missing translation key | `src/lib/countries.ts` | 65 | Kenya | `lib.countries.kenya` |
| Missing translation key | `src/lib/countries.ts` | 66 | Kuwait | `lib.countries.kuwait` |
| Missing translation key | `src/lib/countries.ts` | 67 | Latvia | `lib.countries.latvia` |
| Missing translation key | `src/lib/countries.ts` | 68 | Lebanon | `lib.countries.lebanon` |
| Missing translation key | `src/lib/countries.ts` | 69 | Lithuania | `lib.countries.lithuania` |
| Missing translation key | `src/lib/countries.ts` | 70 | Luxembourg | `lib.countries.luxembourg` |
| Missing translation key | `src/lib/countries.ts` | 71 | Macau | `lib.countries.macau` |
| Missing translation key | `src/lib/countries.ts` | 72 | Malaysia | `lib.countries.malaysia` |
| Missing translation key | `src/lib/countries.ts` | 73 | Maldives | `lib.countries.maldives` |
| Missing translation key | `src/lib/countries.ts` | 74 | Malta | `lib.countries.malta` |
| Missing translation key | `src/lib/countries.ts` | 75 | Mexico | `lib.countries.mexico` |
| Missing translation key | `src/lib/countries.ts` | 76 | Moldova | `lib.countries.moldova` |
| Missing translation key | `src/lib/countries.ts` | 77 | Morocco | `lib.countries.morocco` |
| Missing translation key | `src/lib/countries.ts` | 78 | Nepal | `lib.countries.nepal` |
| Missing translation key | `src/lib/countries.ts` | 79 | Netherlands | `lib.countries.netherlands` |
| Missing translation key | `src/lib/countries.ts` | 81 | Nigeria | `lib.countries.nigeria` |
| Missing translation key | `src/lib/countries.ts` | 82 | Norway | `lib.countries.norway` |
| Missing translation key | `src/lib/countries.ts` | 83 | Oman | `lib.countries.oman` |
| Missing translation key | `src/lib/countries.ts` | 84 | Pakistan | `lib.countries.pakistan` |
| Missing translation key | `src/lib/countries.ts` | 85 | Panama | `lib.countries.panama` |
| Missing translation key | `src/lib/countries.ts` | 86 | Paraguay | `lib.countries.paraguay` |
| Missing translation key | `src/lib/countries.ts` | 87 | Peru | `lib.countries.peru` |
| Missing translation key | `src/lib/countries.ts` | 88 | Philippines | `lib.countries.philippines` |
| Missing translation key | `src/lib/countries.ts` | 89 | Poland | `lib.countries.poland` |
| Missing translation key | `src/lib/countries.ts` | 90 | Portugal | `lib.countries.portugal` |
| Missing translation key | `src/lib/countries.ts` | 91 | Qatar | `lib.countries.qatar` |
| Missing translation key | `src/lib/countries.ts` | 92 | Romania | `lib.countries.romania` |
| Missing translation key | `src/lib/countries.ts` | 93 | Russia | `lib.countries.russia` |
| Missing translation key | `src/lib/countries.ts` | 95 | Serbia | `lib.countries.serbia` |
| Missing translation key | `src/lib/countries.ts` | 96 | Singapore | `lib.countries.singapore` |
| Missing translation key | `src/lib/countries.ts` | 97 | Slovakia | `lib.countries.slovakia` |
| Missing translation key | `src/lib/countries.ts` | 98 | Slovenia | `lib.countries.slovenia` |
| Missing translation key | `src/lib/countries.ts` | 101 | Spain | `lib.countries.spain` |
| Missing translation key | `src/lib/countries.ts` | 103 | Sweden | `lib.countries.sweden` |
| Missing translation key | `src/lib/countries.ts` | 104 | Switzerland | `lib.countries.switzerland` |
| Missing translation key | `src/lib/countries.ts` | 105 | Taiwan | `lib.countries.taiwan` |
| Missing translation key | `src/lib/countries.ts` | 106 | Tanzania | `lib.countries.tanzania` |
| Missing translation key | `src/lib/countries.ts` | 107 | Thailand | `lib.countries.thailand` |
| Missing translation key | `src/lib/countries.ts` | 108 | Tunisia | `lib.countries.tunisia` |
| Missing translation key | `src/lib/countries.ts` | 109 | Türkiye | `lib.countries.tRkiye` |
| Missing translation key | `src/lib/countries.ts` | 110 | Uganda | `lib.countries.uganda` |
| Missing translation key | `src/lib/countries.ts` | 111 | Ukraine | `lib.countries.ukraine` |
| Missing translation key | `src/lib/countries.ts` | 115 | Uruguay | `lib.countries.uruguay` |
| Missing translation key | `src/lib/countries.ts` | 116 | Uzbekistan | `lib.countries.uzbekistan` |
| Missing translation key | `src/lib/countries.ts` | 117 | Venezuela | `lib.countries.venezuela` |
| Missing translation key | `src/lib/countries.ts` | 118 | Vietnam | `lib.countries.vietnam` |
| Missing translation key | `src/lib/countries.ts` | 119 | Yemen | `lib.countries.yemen` |
| Missing translation key | `src/lib/countries.ts` | 120 | Zambia | `lib.countries.zambia` |
| Missing translation key | `src/lib/countries.ts` | 121 | Zimbabwe | `lib.countries.zimbabwe` |
| Missing translation key | `src/lib/currencies.ts` | 19 | Bosnia-Herzegovina Convertible Mark | `lib.currencies.bosniaHerzegovinaConvertibleMark` |
| Missing translation key | `src/lib/currencies.ts` | 40 | Costa Rican Colón | `lib.currencies.costaRicanColN` |
| Missing translation key | `src/lib/currencies.ts` | 51 | Euro | `lib.currencies.euro` |
| Missing translation key | `src/lib/currencies.ts` | 72 | Icelandic Króna | `lib.currencies.icelandicKrNa` |
| Missing translation key | `src/lib/currencies.ts` | 96 | Mongolian Tögrög | `lib.currencies.mongolianTGrG` |
| Missing translation key | `src/lib/currencies.ts` | 107 | Nicaraguan Córdoba | `lib.currencies.nicaraguanCRdoba` |
| Missing translation key | `src/lib/currencies.ts` | 117 | Polish Złoty | `lib.currencies.polishZOty` |
| Missing translation key | `src/lib/currencies.ts` | 118 | Paraguayan Guaraní | `lib.currencies.paraguayanGuaran` |
| Missing translation key | `src/lib/currencies.ts` | 134 | São Tomé and Príncipe Dobra | `lib.currencies.sOTomAndPr` |
| Missing translation key | `src/lib/currencies.ts` | 135 | Salvadoran Colón | `lib.currencies.salvadoranColN` |
| Missing translation key | `src/lib/currencies.ts` | 142 | Tongan Paʻanga | `lib.currencies.tonganPaAnga` |
| Missing translation key | `src/lib/currencies.ts` | 152 | Venezuelan Bolívar | `lib.currencies.venezuelanBolVar` |
| Missing translation key | `src/lib/currencies.ts` | 153 | Vietnamese Đồng | `lib.currencies.vietnameseNg` |
| Missing translation key | `src/lib/currencies.ts` | 155 | Samoan Tālā | `lib.currencies.samoanTL` |
| Missing translation key | `src/lib/i18n/languages.ts` | 15 | English | `lib.i18n.languages.english` |
| Missing translation key | `src/lib/i18n/languages.ts` | 16 | Italiano | `lib.i18n.languages.italiano` |
| Missing translation key | `src/lib/i18n/languages.ts` | 16 | Italian | `lib.i18n.languages.italian` |
| Missing translation key | `src/lib/i18n/languages.ts` | 17 | Deutsch | `lib.i18n.languages.deutsch` |
| Missing translation key | `src/lib/i18n/languages.ts` | 17 | German | `lib.i18n.languages.german` |
| Missing translation key | `src/lib/i18n/languages.ts` | 18 | Hindi | `lib.i18n.languages.hindi` |
| Missing translation key | `src/lib/i18n/languages.ts` | 19 | Malayalam | `lib.i18n.languages.malayalam` |
| Missing translation key | `src/lib/i18n/languages.ts` | 20 | Tamil | `lib.i18n.languages.tamil` |
| Missing translation key | `src/lib/i18n/languages.ts` | 21 | Telugu | `lib.i18n.languages.telugu` |
| Missing translation key | `src/lib/i18n/languages.ts` | 22 | Arabic | `lib.i18n.languages.arabic` |
| Missing translation key | `src/lib/seo/site.ts` | 11 | ProfitSync — Know your profit. Sync your business. | `lib.seo.site.profitsyncKnowYourProfitSync` |
| Missing translation key | `src/lib/seo/site.ts` | 13 | ProfitSync brings your clients, cash flow, and quotations into one clean workspace — so you always know exactly where your money stands. | `lib.seo.site.profitsyncBringsYourClientsCash` |
| Missing translation key | `src/lib/seo/site.ts` | 221 | Free plan, forever — upgrade to Premium any time. | `lib.seo.site.freePlanForeverUpgradeTo` |
| Missing translation key | `src/pages/admin/admin-nav.ts` | 26 | Overview | `admin.adminnav.overview` |
| Missing translation key | `src/pages/admin/admin-nav.ts` | 27 | Users | `admin.adminnav.users` |
| Missing translation key | `src/pages/admin/admin-nav.ts` | 28 | Organizations | `admin.adminnav.organizations` |
| Missing translation key | `src/pages/admin/admin-nav.ts` | 29 | Subscriptions | `admin.adminnav.subscriptions` |
| Missing translation key | `src/pages/admin/admin-nav.ts` | 30 | Invoices | `admin.adminnav.invoices` |
| Missing translation key | `src/pages/admin/admin-nav.ts` | 31 | Plans | `admin.adminnav.plans` |
| Missing translation key | `src/pages/admin/admin-nav.ts` | 32 | Blog | `admin.adminnav.blog` |
| Missing translation key | `src/pages/admin/admin-nav.ts` | 33 | Referrals | `admin.adminnav.referrals` |
| Missing translation key | `src/pages/admin/admin-nav.ts` | 34 | Admins | `admin.adminnav.admins` |
| Missing translation key | `src/pages/admin/AdminOverviewPage.tsx` | 45 | Organizations | `admin.AdminOverview.organizations` |
| Missing translation key | `src/pages/admin/AdminOverviewPage.tsx` | 48 | Subscriptions | `admin.AdminOverview.subscriptions` |
| Missing translation key | `src/pages/admin/AdminOverviewPage.tsx` | 52 | Transactions | `admin.AdminOverview.transactions` |
| Missing translation key | `src/pages/admin/AdminPlansPage.tsx` | 97 | Clients | `admin.AdminPlans.clients` |
| Missing translation key | `src/pages/admin/AdminPlansPage.tsx` | 99 | Quotations | `admin.AdminPlans.quotations` |
| Missing translation key | `src/pages/admin/AdminPlansPage.tsx` | 106 | Personal | `admin.AdminPlans.personal` |
| Missing translation key | `src/pages/admin/AdminPlansPage.tsx` | 107 | Business | `admin.AdminPlans.business` |
| Missing translation key | `src/pages/ClientFilesPage.tsx` | 63 | Document | `ClientFiles.document` |
| Missing translation key | `src/pages/ClientFilesPage.tsx` | 64 | Transaction | `ClientFiles.transaction` |
| Missing translation key | `src/pages/ClientFilesPage.tsx` | 65 | Quote | `ClientFiles.quote` |
| Missing translation key | `src/pages/ClientFilesPage.tsx` | 66 | Account | `ClientFiles.account` |
| Hardcoded text | `src/components/OrgSwitcher.tsx` | 36 | Loading… | `OrgSwitcher.loading` |
| Hardcoded text | `src/components/OrgSwitcher.tsx` | 79 | Search organizations… | `OrgSwitcher.searchOrganizations` |
| Hardcoded text | `src/components/OrgSwitcher.tsx` | 109 | Personal | `OrgSwitcher.personal` |
| Hardcoded text | `src/components/ReferralBanner.tsx` | 50 | Dismiss | `ReferralBanner.dismiss` |
| Hardcoded text | `src/landing/components/Logo.tsx` | 14 | ProfitSync — home | `landing.components.Logo.profitsyncHome` |
| Hardcoded text | `src/landing/sections/AnalyticsTeaser.tsx` | 53 | $48.2k | `landing.sections.AnalyticsTeaser.482k` |
| Hardcoded text | `src/landing/sections/AnalyticsTeaser.tsx` | 57 | $19.6k | `landing.sections.AnalyticsTeaser.196k` |
| Hardcoded text | `src/landing/sections/AnalyticsTeaser.tsx` | 61 | $28.6k | `landing.sections.AnalyticsTeaser.286k` |
| Hardcoded text | `src/landing/sections/Footer.tsx` | 73 | ProfitSync. | `landing.sections.Footer.profitsync` |
| Hardcoded text | `src/pages/admin/AdminAdminsPage.tsx` | 130 | Admins | `admin.AdminAdmins.admins` |
| Hardcoded text | `src/pages/admin/AdminAdminsPage.tsx` | 132 | that controls what they can do — | `admin.AdminAdmins.thatControlsWhatTheyCan` |
| Hardcoded text | `src/pages/admin/AdminAdminsPage.tsx` | 133 | (everything), | `admin.AdminAdmins.everything` |
| Hardcoded text | `src/pages/admin/AdminAdminsPage.tsx` | 134 | Editor | `admin.AdminAdmins.editor` |
| Hardcoded text | `src/pages/admin/AdminAdminsPage.tsx` | 134 | (manage content, no settings/admins), | `admin.AdminAdmins.manageContentNoSettingsAdmins` |
| Hardcoded text | `src/pages/admin/AdminAdminsPage.tsx` | 135 | Viewer | `admin.AdminAdmins.viewer` |
| Hardcoded text | `src/pages/admin/AdminAdminsPage.tsx` | 135 | (read-only) or | `admin.AdminAdmins.readOnlyOr` |
| Hardcoded text | `src/pages/admin/AdminAdminsPage.tsx` | 137 | environment variable, are always super admin, and can't be changed here. | `admin.AdminAdmins.environmentVariableAreAlwaysSuper` |
| Hardcoded text | `src/pages/admin/AdminAdminsPage.tsx` | 161 | Role | `admin.AdminAdmins.role` |
| Hardcoded text | `src/pages/admin/AdminAdminsPage.tsx` | 189 | Root | `admin.AdminAdmins.root` |
| Hardcoded text | `src/pages/admin/AdminAdminsPage.tsx` | 190 | You | `admin.AdminAdmins.you` |
| Hardcoded text | `src/pages/admin/AdminAdminsPage.tsx` | 228 | Remove admin access? | `admin.AdminAdmins.removeAdminAccess` |
| Hardcoded text | `src/pages/admin/AdminAdminsPage.tsx` | 235 | Cancel | `admin.AdminAdmins.cancel` |
| Hardcoded text | `src/pages/admin/AdminAdminsPage.tsx` | 242 | Remove | `admin.AdminAdmins.remove` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 256 | Blog | `admin.AdminBlog.blog` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 358 | Edit | `admin.AdminBlog.edit` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 389 | Title | `admin.AdminBlog.title` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 399 | Slug | `admin.AdminBlog.slug` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 410 | URL: | `admin.AdminBlog.url` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 425 | Author | `admin.AdminBlog.author` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 437 | Social image URL (1200×630) | `admin.AdminBlog.socialImageUrl1200630` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 454 | Used for grouping &amp; schema articleSection. | `admin.AdminBlog.usedForGroupingAmpSchema` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 461 | A credible, externally-linked author improves search ranking and how AI engines cite the post. | `admin.AdminBlog.aCredibleExternallyLinkedAuthor` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 471 | Founder, ProfitSync | `admin.AdminBlog.founderProfitsync` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 499 | One or two sentences on the author's relevant experience. | `admin.AdminBlog.oneOrTwoSentencesOn` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 507 | Excerpt | `admin.AdminBlog.excerpt` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 518 | Tags | `admin.AdminBlog.tags` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 523 | finance, freelancing, tips | `admin.AdminBlog.financeFreelancingTips` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 525 | Comma-separated. | `admin.AdminBlog.commaSeparated` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 529 | Content | `admin.AdminBlog.content` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 532 | Write | `admin.AdminBlog.write` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 533 | Preview | `admin.AdminBlog.preview` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 580 | Status | `admin.AdminBlog.status` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 586 | Draft — hidden from the public | `admin.AdminBlog.draftHiddenFromThePublic` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 587 | Published — live on the blog | `admin.AdminBlog.publishedLiveOnTheBlog` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 595 | Cancel | `admin.AdminBlog.cancel` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 609 | Delete this post? | `admin.AdminBlog.deleteThisPost` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 611 | ” will be permanently deleted. This cannot be undone. | `admin.AdminBlog.willBePermanentlyDeletedThis` |
| Hardcoded text | `src/pages/admin/AdminBlogPage.tsx` | 615 | Cancel | `admin.AdminBlog.cancel` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 204 | Invoices | `admin.AdminInvoices.invoices` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 225 | All | `admin.AdminInvoices.all` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 238 | Invoice | `admin.AdminInvoices.invoice` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 239 | Organization | `admin.AdminInvoices.organization` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 240 | Amount | `admin.AdminInvoices.amount` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 241 | Status | `admin.AdminInvoices.status` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 242 | Issued | `admin.AdminInvoices.issued` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 243 | Paid | `admin.AdminInvoices.paid` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 300 | View | `admin.AdminInvoices.view` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 302 | Edit | `admin.AdminInvoices.edit` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 312 | Page | `admin.AdminInvoices.page` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 345 | Organization | `admin.AdminInvoices.organization` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 347 | Owner | `admin.AdminInvoices.owner` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 349 | Amount | `admin.AdminInvoices.amount` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 351 | Provider | `admin.AdminInvoices.provider` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 355 | Subscription | `admin.AdminInvoices.subscription` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 357 | Issued | `admin.AdminInvoices.issued` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 359 | Paid | `admin.AdminInvoices.paid` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 361 | Created | `admin.AdminInvoices.created` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 366 | Status | `admin.AdminInvoices.status` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 376 | Cancel | `admin.AdminInvoices.cancel` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 392 | Organization | `admin.AdminInvoices.organization` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 398 | Select an organization… | `admin.AdminInvoices.selectAnOrganization` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 406 | Amount | `admin.AdminInvoices.amount` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 410 | Currency | `admin.AdminInvoices.currency` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 415 | Status | `admin.AdminInvoices.status` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 424 | Cancel | `admin.AdminInvoices.cancel` |
| Hardcoded text | `src/pages/admin/AdminInvoicesPage.tsx` | 427 | Create | `admin.AdminInvoices.create` |
| Hardcoded text | `src/pages/admin/AdminLayout.tsx` | 90 | Internal · privileged | `admin.AdminLayout.internalPrivileged` |
| Hardcoded text | `src/pages/admin/AdminLayout.tsx` | 161 | Logout | `admin.AdminLayout.logout` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 208 | Organizations | `admin.AdminOrgDetail.organizations` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 218 | Personal | `admin.AdminOrgDetail.personal` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 252 | Overview | `admin.AdminOrgDetail.overview` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 255 | Clients | `admin.AdminOrgDetail.clients` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 258 | Transactions | `admin.AdminOrgDetail.transactions` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 261 | Subscription | `admin.AdminOrgDetail.subscription` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 264 | Members | `admin.AdminOrgDetail.members` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 306 | Clients | `admin.AdminOrgDetail.clients` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 307 | Transactions | `admin.AdminOrgDetail.transactions` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 308 | Quotations | `admin.AdminOrgDetail.quotations` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 315 | Owner | `admin.AdminOrgDetail.owner` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 462 | Search by name, company, or email | `admin.AdminOrgDetail.searchByNameCompanyOr` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 470 | All | `admin.AdminOrgDetail.all` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 471 | Active | `admin.AdminOrgDetail.active` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 472 | Inactive | `admin.AdminOrgDetail.inactive` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 473 | Archived | `admin.AdminOrgDetail.archived` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 483 | Client | `admin.AdminOrgDetail.client` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 484 | Status | `admin.AdminOrgDetail.status` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 485 | Txns | `admin.AdminOrgDetail.txns` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 486 | Incoming | `admin.AdminOrgDetail.incoming` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 487 | Outgoing | `admin.AdminOrgDetail.outgoing` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 520 | Edit | `admin.AdminOrgDetail.edit` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 534 | Page | `admin.AdminOrgDetail.page` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 554 | Name | `admin.AdminOrgDetail.name` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 558 | Company | `admin.AdminOrgDetail.company` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 566 | Phone | `admin.AdminOrgDetail.phone` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 575 | Status | `admin.AdminOrgDetail.status` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 583 | Notes | `admin.AdminOrgDetail.notes` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 593 | Cancel | `admin.AdminOrgDetail.cancel` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 605 | Move client to trash? | `admin.AdminOrgDetail.moveClientToTrash` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 608 | will be marked deleted. Their transactions stay in the database but won't appear in the org. | `admin.AdminOrgDetail.willBeMarkedDeletedTheir` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 611 | Cancel | `admin.AdminOrgDetail.cancel` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 781 | Search description, category, or client | `admin.AdminOrgDetail.searchDescriptionCategoryOrClient` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 789 | All | `admin.AdminOrgDetail.all` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 790 | Incoming | `admin.AdminOrgDetail.incoming` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 791 | Outgoing | `admin.AdminOrgDetail.outgoing` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 802 | Client | `admin.AdminOrgDetail.client` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 803 | Type | `admin.AdminOrgDetail.type` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 804 | Amount | `admin.AdminOrgDetail.amount` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 805 | Description | `admin.AdminOrgDetail.description` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 835 | Edit | `admin.AdminOrgDetail.edit` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 849 | Page | `admin.AdminOrgDetail.page` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 868 | Client | `admin.AdminOrgDetail.client` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 875 | Select a client… | `admin.AdminOrgDetail.selectAClient` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 884 | Type | `admin.AdminOrgDetail.type` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 896 | Amount | `admin.AdminOrgDetail.amount` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 900 | Category | `admin.AdminOrgDetail.category` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 905 | Description | `admin.AdminOrgDetail.description` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 910 | Cancel | `admin.AdminOrgDetail.cancel` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 922 | Delete transaction? | `admin.AdminOrgDetail.deleteTransaction` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 928 | Cancel | `admin.AdminOrgDetail.cancel` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 1007 | Plan | `admin.AdminOrgDetail.plan` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 1015 | Status | `admin.AdminOrgDetail.status` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 1113 | Members + pending invitations. | `admin.AdminOrgDetail.membersPendingInvitations` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 1151 | Role: | `admin.AdminOrgDetail.role` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 1156 | Revoke | `admin.AdminOrgDetail.revoke` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 1184 | Role | `admin.AdminOrgDetail.role` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 1201 | Cancel | `admin.AdminOrgDetail.cancel` |
| Hardcoded text | `src/pages/admin/AdminOrgDetailPage.tsx` | 1211 | Refresh | `admin.AdminOrgDetail.refresh` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 315 | Organizations | `admin.AdminOrgs.organizations` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 316 | All organizations across the platform. Click a row to manage its clients, transactions, and subscription. | `admin.AdminOrgs.allOrganizationsAcrossThePlatform` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 342 | All | `admin.AdminOrgs.all` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 343 | Team | `admin.AdminOrgs.team` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 344 | Personal | `admin.AdminOrgs.personal` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 357 | Clear | `admin.AdminOrgs.clear` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 373 | Organization | `admin.AdminOrgs.organization` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 374 | Owner | `admin.AdminOrgs.owner` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 375 | Members | `admin.AdminOrgs.members` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 376 | Clients | `admin.AdminOrgs.clients` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 377 | Quotes | `admin.AdminOrgs.quotes` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 378 | Plan | `admin.AdminOrgs.plan` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 415 | Personal | `admin.AdminOrgs.personal` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 452 | Free | `admin.AdminOrgs.free` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 454 | Upgrade | `admin.AdminOrgs.upgrade` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 460 | Rename | `admin.AdminOrgs.rename` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 491 | Page | `admin.AdminOrgs.page` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 510 | Name | `admin.AdminOrgs.name` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 523 | Cancel | `admin.AdminOrgs.cancel` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 526 | Save | `admin.AdminOrgs.save` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 535 | Delete organization permanently? | `admin.AdminOrgs.deleteOrganizationPermanently` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 538 | along with its clients, transactions, and quotations. Any active Dodo subscription is cancelled so billing stops. | `admin.AdminOrgs.alongWithItsClientsTransactions` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 541 | Cancel | `admin.AdminOrgs.cancel` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 556 | This permanently deletes the selected organizations along with their clients, transactions, and quotations. Any active Dodo subscription is cancelled so billing stops. This cannot be undone. | `admin.AdminOrgs.thisPermanentlyDeletesTheSelected` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 559 | Cancel | `admin.AdminOrgs.cancel` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 575 | Owner | `admin.AdminOrgs.owner` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 585 | Search a user by email or name… | `admin.AdminOrgs.searchAUserByEmail` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 588 | Searching… | `admin.AdminOrgs.searching` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 614 | Currency | `admin.AdminOrgs.currency` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 623 | Cancel | `admin.AdminOrgs.cancel` |
| Hardcoded text | `src/pages/admin/AdminOrgsPage.tsx` | 626 | Create | `admin.AdminOrgs.create` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 182 | List | `admin.AdminPlans.list` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 190 | Metadata | `admin.AdminPlans.metadata` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 345 | Which account type is this plan for? | `admin.AdminPlans.whichAccountTypeIsThis` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 384 | Live | `admin.AdminPlans.live` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 384 | for real billing, | `admin.AdminPlans.forRealBilling` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 385 | Test | `admin.AdminPlans.test` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 395 | plan. We'll pull the name, description, prices and discounts automatically. | `admin.AdminPlans.planWeLlPullThe` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 400 | pdt_… | `admin.AdminPlans.pdt` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 404 | pdt_… | `admin.AdminPlans.pdt` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 416 | Description | `admin.AdminPlans.description` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 479 | Back | `admin.AdminPlans.back` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 484 | Continue | `admin.AdminPlans.continue` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 628 | Plans | `admin.AdminPlans.plans` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 630 | Personal &amp; Business plans are driven by Dodo Payments product IDs. Use the wizard to paste a product ID and sync the name, description, prices and discounts in one step. | `admin.AdminPlans.personalAmpBusinessPlansAre` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 644 | Delete “ | `admin.AdminPlans.delete` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 646 | This removes the plan from ProfitSync only — the Dodo product is | `admin.AdminPlans.thisRemovesThePlanFrom` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 647 | deleted in Dodo. Any customers currently on this plan keep their subscription, but it can no longer be offered to new ones. | `admin.AdminPlans.deletedInDodoAnyCustomers` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 652 | Cancel | `admin.AdminPlans.cancel` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 691 | Test | `admin.AdminPlans.test` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 703 | Save | `admin.AdminPlans.save` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 721 | Monthly | `admin.AdminPlans.monthly` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 725 | Yearly | `admin.AdminPlans.yearly` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 742 | Pricing &amp; promo | `admin.AdminPlans.pricingAmpPromo` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 745 | Limits &amp; features | `admin.AdminPlans.limitsAmpFeatures` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 748 | Integration | `admin.AdminPlans.integration` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 754 | Description | `admin.AdminPlans.description` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 766 | — shown on the plan card | `admin.AdminPlans.shownOnThePlanCard` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 771 | e.g. "First month 50% off" | `admin.AdminPlans.eGFirstMonth50` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 800 | Country | `admin.AdminPlans.country` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 804 | Currency | `admin.AdminPlans.currency` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 882 | Monthly | `admin.AdminPlans.monthly` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 883 | pdt_… | `admin.AdminPlans.pdt` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 886 | Yearly | `admin.AdminPlans.yearly` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 887 | pdt_… | `admin.AdminPlans.pdt` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 891 | Environment | `admin.AdminPlans.environment` |
| Hardcoded text | `src/pages/admin/AdminPlansPage.tsx` | 907 | Which Dodo environment these product IDs live in. Used for sync, checkout and invoices. | `admin.AdminPlans.whichDodoEnvironmentTheseProduct` |
| Hardcoded text | `src/pages/admin/AdminReferralsPage.tsx` | 154 | Reject | `admin.AdminReferrals.reject` |
| Hardcoded text | `src/pages/admin/AdminReferralsPage.tsx` | 169 | Referrals | `admin.AdminReferrals.referrals` |
| Hardcoded text | `src/pages/admin/AdminReferralsPage.tsx` | 170 | Owed (paid, awaiting payout): | `admin.AdminReferrals.owedPaidAwaitingPayout` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 231 | Subscriptions | `admin.AdminSubscriptions.subscriptions` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 249 | Free | `admin.AdminSubscriptions.free` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 250 | Personal | `admin.AdminSubscriptions.personal` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 251 | Business | `admin.AdminSubscriptions.business` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 256 | Any | `admin.AdminSubscriptions.any` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 257 | Pending | `admin.AdminSubscriptions.pending` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 258 | Active | `admin.AdminSubscriptions.active` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 260 | Cancelled | `admin.AdminSubscriptions.cancelled` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 280 | Clear | `admin.AdminSubscriptions.clear` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 296 | Organization | `admin.AdminSubscriptions.organization` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 297 | Plan | `admin.AdminSubscriptions.plan` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 298 | Status | `admin.AdminSubscriptions.status` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 299 | Cycle | `admin.AdminSubscriptions.cycle` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 300 | Provider | `admin.AdminSubscriptions.provider` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 301 | Renews | `admin.AdminSubscriptions.renews` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 365 | Edit | `admin.AdminSubscriptions.edit` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 376 | Page | `admin.AdminSubscriptions.page` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 400 | Plan | `admin.AdminSubscriptions.plan` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 408 | Status | `admin.AdminSubscriptions.status` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 430 | Cancel | `admin.AdminSubscriptions.cancel` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 433 | Save | `admin.AdminSubscriptions.save` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 452 | Free/stub rows have no Dodo subscription, so only their local state changes. | `admin.AdminSubscriptions.freeStubRowsHaveNo` |
| Hardcoded text | `src/pages/admin/AdminSubscriptionsPage.tsx` | 455 | Cancel | `admin.AdminSubscriptions.cancel` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 229 | Users | `admin.AdminUsers.users` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 242 | Search by email, name, or user id | `admin.AdminUsers.searchByEmailNameOr` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 256 | All | `admin.AdminUsers.all` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 257 | Active | `admin.AdminUsers.active` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 258 | Banned | `admin.AdminUsers.banned` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 268 | User | `admin.AdminUsers.user` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 269 | Orgs | `admin.AdminUsers.orgs` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 270 | Premium | `admin.AdminUsers.premium` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 271 | Status | `admin.AdminUsers.status` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 272 | Joined | `admin.AdminUsers.joined` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 296 | Admin | `admin.AdminUsers.admin` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 308 | Banned | `admin.AdminUsers.banned` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 310 | Active | `admin.AdminUsers.active` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 318 | Details | `admin.AdminUsers.details` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 340 | Page | `admin.AdminUsers.page` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 369 | Currency | `admin.AdminUsers.currency` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 373 | Joined | `admin.AdminUsers.joined` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 396 | Personal | `admin.AdminUsers.personal` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 423 | Unban | `admin.AdminUsers.unban` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 428 | Ban | `admin.AdminUsers.ban` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 449 | Close | `admin.AdminUsers.close` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 464 | Organization | `admin.AdminUsers.organization` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 470 | Select an organization… | `admin.AdminUsers.selectAnOrganization` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 490 | Role | `admin.AdminUsers.role` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 507 | Cancel | `admin.AdminUsers.cancel` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 519 | Delete user permanently? | `admin.AdminUsers.deleteUserPermanently` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 522 | , every organization they own, plus all their clients, transactions, quotations, subscriptions, and invoices. This cannot be undone. | `admin.AdminUsers.everyOrganizationTheyOwnPlus` |
| Hardcoded text | `src/pages/admin/AdminUsersPage.tsx` | 525 | Cancel | `admin.AdminUsers.cancel` |
| Hardcoded text | `src/pages/ClientFilesPage.tsx` | 243 | Files | `ClientFiles.files` |
| Hardcoded text | `src/pages/ClientFilesPage.tsx` | 251 | Source | `ClientFiles.source` |
| Hardcoded text | `src/pages/ClientFilesPage.tsx` | 256 | Documents | `ClientFiles.documents` |
| Hardcoded text | `src/pages/ClientFilesPage.tsx` | 257 | Transactions | `ClientFiles.transactions` |
| Hardcoded text | `src/pages/ClientFilesPage.tsx` | 258 | Quotes | `ClientFiles.quotes` |
| Hardcoded text | `src/pages/ClientFilesPage.tsx` | 268 | Name (A–Z) | `ClientFiles.nameAZ` |
| Hardcoded text | `src/pages/ClientFilesPage.tsx` | 269 | Largest | `ClientFiles.largest` |
| Hardcoded text | `src/pages/ClientFilesPage.tsx` | 371 | This permanently removes “ | `ClientFiles.thisPermanentlyRemoves` |
| Hardcoded text | `src/pages/ClientFilesPage.tsx` | 371 | ” from its | `ClientFiles.fromIts` |
| Hardcoded text | `src/pages/ClientFilesPage.tsx` | 371 | . This can't be undone. | `ClientFiles.thisCanTBeUndone` |
| Hardcoded text | `src/pages/PrivacyPolicyPage.tsx` | 9 | Last updated: May 24, 2026 — Version | `PrivacyPolicy.lastUpdatedMay242026` |
| Hardcoded text | `src/pages/PrivacyPolicyPage.tsx` | 14 | ProfitSync ("we", "us", "our") provides accounting and client-tracking software ("the Service"). This Privacy Policy explains what personal data we collect when you use the Service, how we use it, who we share it with, and the rights you have over your data. | `PrivacyPolicy.profitsyncWeUsOurProvides` |
| Hardcoded text | `src/pages/PrivacyPolicyPage.tsx` | 23 | clients, transactions, quotations, notes, and file attachments. | `PrivacyPolicy.clientsTransactionsQuotationsNotesAnd` |
| Hardcoded text | `src/pages/PrivacyPolicyPage.tsx` | 32 | To send transactional notifications (sign-up confirmation, security alerts, billing, support). | `PrivacyPolicy.toSendTransactionalNotificationsSign` |
| Hardcoded text | `src/pages/PrivacyPolicyPage.tsx` | 70 | We may update this Privacy Policy from time to time. When we do, we will update the version number above and notify you in-product. Continued use of the Service after a change constitutes acceptance of the updated policy. | `PrivacyPolicy.weMayUpdateThisPrivacy` |
| Hardcoded text | `src/pages/PrivacyPolicyPage.tsx` | 77 | Questions? Email | `PrivacyPolicy.questionsEmail` |
| Hardcoded text | `src/pages/QuotationsPage.tsx` | 616 | shrink-0 ml-auto | `Quotations.shrink0MlAuto` |
| Hardcoded text | `src/pages/QuotationsPage.tsx` | 737 | Converted | `Quotations.converted` |
| Hardcoded text | `src/pages/ReferralPage.tsx` | 67 | Couldn't copy | `Referral.couldnTCopy` |
| Hardcoded text | `src/pages/ReferralPage.tsx` | 78 | Couldn't copy | `Referral.couldnTCopy` |
| Hardcoded text | `src/pages/ReferralPage.tsx` | 139 | Refer &amp; earn | `Referral.referAmpEarn` |
| Hardcoded text | `src/pages/ReferralPage.tsx` | 164 | Share | `Referral.share` |
| Hardcoded text | `src/pages/ReferralPage.tsx` | 172 | Signups | `Referral.signups` |
| Hardcoded text | `src/pages/ReferralPage.tsx` | 175 | Available | `Referral.available` |
| Hardcoded text | `src/pages/ReferralPage.tsx` | 198 | You haven't referred anyone yet. Share your link to start earning. | `Referral.youHavenTReferredAnyone` |
| Hardcoded text | `src/pages/ReferralPage.tsx` | 249 | Have a referral code? | `Referral.haveAReferralCode` |
| Hardcoded text | `src/pages/ReferralPage.tsx` | 252 | Apply | `Referral.apply` |
| Hardcoded text | `src/pages/ReferralPage.tsx` | 263 | PayPal | `Referral.paypal` |
| Hardcoded text | `src/pages/ReferralPage.tsx` | 263 | Bank | `Referral.bank` |
| Hardcoded text | `src/pages/ReferralPage.tsx` | 266 | name@bank | `Referral.nameBank` |
| Hardcoded text | `src/pages/ReferralPage.tsx` | 281 | Available: | `Referral.available` |
| Hardcoded text | `src/pages/ReferralPage.tsx` | 285 | Cancel | `Referral.cancel` |
| Hardcoded text | `src/pages/RefundPolicyPage.tsx` | 7 | Last updated: June 3, 2026 | `RefundPolicy.lastUpdatedJune32026` |
| Hardcoded text | `src/pages/RefundPolicyPage.tsx` | 11 | ProfitSync ("we", "us", "our") offers subscription plans for our accounting and client-tracking software ("the Service"). This policy explains when subscription fees are, and are not, refundable. Subscription payments are processed by Dodo Payments, our Merchant of Record. | `RefundPolicy.profitsyncWeUsOurOffers` |
| Hardcoded text | `src/pages/RefundPolicyPage.tsx` | 32 | If you are charged for a paid plan and are not satisfied, you may request a full refund within | `RefundPolicy.ifYouAreChargedFor` |
| Hardcoded text | `src/pages/RefundPolicyPage.tsx` | 47 | If you believe you were charged in error or charged more than once for the same period, contact us and we will investigate and refund any verified duplicate or erroneous charge regardless of the 7-day window. | `RefundPolicy.ifYouBelieveYouWere` |
| Hardcoded text | `src/pages/RefundPolicyPage.tsx` | 53 | Referral commissions are a reward, not a purchase, and are governed by the referral program terms shown in your account. A refund of a referred customer's payment may reverse any related referral reward. | `RefundPolicy.referralCommissionsAreAReward` |
| Hardcoded text | `src/pages/RefundPolicyPage.tsx` | 67 | We may update this Refund Policy from time to time. Material changes will be reflected by the "last updated" date above and, where appropriate, communicated in the app. | `RefundPolicy.weMayUpdateThisRefund` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 10 | Last updated: June 3, 2026 — Version | `TermsOfService.lastUpdatedJune32026` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 15 | By creating an account or using ProfitSync ("the Service", "we", "us", "our") you agree to these Terms of Service, our | `TermsOfService.byCreatingAnAccountOr` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 16 | , and our | `TermsOfService.andOur` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 17 | , which are incorporated here by reference. If you do not agree, do not use the Service. | `TermsOfService.whichAreIncorporatedHereBy` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 21 | 2. Eligibility &amp; accounts | `TermsOfService.2EligibilityAmpAccounts` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 23 | You must be at least 18 years old, or have the legal capacity to enter into a binding contract. | `TermsOfService.youMustBeAtLeast` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 32 | use the Service for any unlawful, fraudulent, or harmful purpose; | `TermsOfService.useTheServiceForAny` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 33 | attempt to gain unauthorized access to systems, accounts, or data of other users; | `TermsOfService.attemptToGainUnauthorizedAccess` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 34 | reverse engineer, scrape, or place undue load on the Service; | `TermsOfService.reverseEngineerScrapeOrPlace` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 42 | Paid plans are billed in advance on a recurring monthly or yearly cycle through Dodo Payments, our Merchant of Record. | `TermsOfService.paidPlansAreBilledIn` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 45 | Plan changes (e.g. monthly → yearly, or upgrades) take effect as described at checkout; scheduled changes apply at the next billing date. | `TermsOfService.planChangesEGMonthly` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 46 | Prices and plan limits may change with reasonable notice; changes never apply retroactively to a period you've already paid for. | `TermsOfService.pricesAndPlanLimitsMay` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 51 | , which includes a 7-day refund window on subscription charges and the handling of duplicate or erroneous charges. | `TermsOfService.whichIncludesA7Day` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 57 | The Free plan has usage limits (clients, transactions per client, quotations, attachments per record, attachment size, note length). Limits are listed in-product and may change with notice. Exceeding a limit requires upgrading to a paid plan. | `TermsOfService.theFreePlanHasUsage` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 64 | If you participate in our referral program, you may earn a reward when a person you refer subscribes to a paid plan. Rewards, holding periods, minimum payouts, and eligibility are set by us and shown in your account; they are rewards, not purchases, and may be changed or discontinued prospectively. Self-referral, fraud, or abuse voids rewards. A refund or chargeback of a referred payment may reverse the related reward. Payouts are made manually to the details you provide; you are responsible for any taxes on rewards. | `TermsOfService.ifYouParticipateInOur` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 71 | 8. Your data &amp; ownership | `TermsOfService.8YourDataAmpOwnership` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 108 | To the maximum extent permitted by law, ProfitSync is not liable for indirect, incidental, special, consequential, or punitive damages, or for loss of profits, revenue, data, or goodwill. Our total aggregate liability for any claim relating to the Service is limited to the amounts you paid us in the twelve months before the event giving rise to the claim. | `TermsOfService.toTheMaximumExtentPermitted` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 116 | You agree to indemnify and hold ProfitSync harmless from claims, damages, and expenses arising out of your misuse of the Service, your data, or your violation of these Terms or applicable law. | `TermsOfService.youAgreeToIndemnifyAnd` |
| Hardcoded text | `src/pages/TermsOfServicePage.tsx` | 129 | These Terms are governed by the laws of India, without regard to conflict-of-law principles. Disputes will be resolved in courts of competent jurisdiction in Bengaluru, India. | `TermsOfService.theseTermsAreGovernedBy` |
| Dynamic text bypassing i18n | `src/components/onboarding/PlanStep.tsx` | 152 | You're all set! | `onboarding.PlanStep.youReAllSet` |
| Dynamic text bypassing i18n | `src/components/OrgSwitcher.tsx` | 55 | Personal | `OrgSwitcher.personal` |
| Dynamic text bypassing i18n | `src/lib/seo/site.ts` | 211 | Multi-currency workspaces | `lib.seo.site.multiCurrencyWorkspaces` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminAdminsPage.tsx` | 187 | Unknown | `admin.AdminAdmins.unknown` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminBlogPage.tsx` | 322 | Published | `admin.AdminBlog.published` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminBlogPage.tsx` | 322 | Draft | `admin.AdminBlog.draft` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminBlogPage.tsx` | 356 | Unpublish | `admin.AdminBlog.unpublish` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminBlogPage.tsx` | 356 | Publish | `admin.AdminBlog.publish` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminInvoicesPage.tsx` | 138 | Failed | `admin.AdminInvoices.failed` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminInvoicesPage.tsx` | 155 | Failed | `admin.AdminInvoices.failed` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminLayout.tsx` | 72 | Admin | `admin.AdminLayout.admin` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminOrgDetailPage.tsx` | 167 | Failed | `admin.AdminOrgDetail.failed` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminOrgDetailPage.tsx` | 423 | Failed | `admin.AdminOrgDetail.failed` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminOrgDetailPage.tsx` | 440 | Failed | `admin.AdminOrgDetail.failed` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminOrgDetailPage.tsx` | 742 | Failed | `admin.AdminOrgDetail.failed` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminOrgDetailPage.tsx` | 759 | Failed | `admin.AdminOrgDetail.failed` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminOrgDetailPage.tsx` | 977 | Failed | `admin.AdminOrgDetail.failed` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminOrgDetailPage.tsx` | 997 | Failed | `admin.AdminOrgDetail.failed` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminOrgDetailPage.tsx` | 1092 | Failed | `admin.AdminOrgDetail.failed` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminOrgDetailPage.tsx` | 1106 | Failed | `admin.AdminOrgDetail.failed` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminOrgsPage.tsx` | 190 | Failed | `admin.AdminOrgs.failed` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminOrgsPage.tsx` | 207 | Failed | `admin.AdminOrgs.failed` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminOrgsPage.tsx` | 269 | Failed | `admin.AdminOrgs.failed` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminOrgsPage.tsx` | 300 | Failed | `admin.AdminOrgs.failed` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminPlansPage.tsx` | 265 | Plan | `admin.AdminPlans.plan` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminPlansPage.tsx` | 336 | Review & save | `admin.AdminPlans.reviewSave` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminPlansPage.tsx` | 587 | Failed | `admin.AdminPlans.failed` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminPlansPage.tsx` | 696 | Active | `admin.AdminPlans.active` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminPlansPage.tsx` | 696 | Disabled | `admin.AdminPlans.disabled` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminPlansPage.tsx` | 844 | Personal plans don't include clients or quotations, so those quotas are hidden. | `admin.AdminPlans.personalPlansDonTInclude` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminPlansPage.tsx` | 845 | Number = the real limit enforced by quota · Text = what's shown in this plan's feature list. | `admin.AdminPlans.numberTheRealLimitEnforced` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminReferralsPage.tsx` | 130 | Saving… | `admin.AdminReferrals.saving` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminSubscriptionsPage.tsx` | 182 | Not a Dodo subscription — nothing to sync | `admin.AdminSubscriptions.notADodoSubscriptionNothing` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminSubscriptionsPage.tsx` | 217 | Failed | `admin.AdminSubscriptions.failed` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminSubscriptionsPage.tsx` | 450 | Each Dodo subscription is cancelled immediately (billing stops) and the row is reset to the Free tier — clearing the renew date, billing cycle and provider link. | `admin.AdminSubscriptions.eachDodoSubscriptionIsCancelled` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminUsersPage.tsx` | 199 | Failed | `admin.AdminUsers.failed` |
| Dynamic text bypassing i18n | `src/pages/admin/AdminUsersPage.tsx` | 217 | Failed | `admin.AdminUsers.failed` |
| Dynamic text bypassing i18n | `src/pages/BudgetDetailPage.tsx` | 78 | T00:00:00Z | `BudgetDetail.t000000z` |
| Dynamic text bypassing i18n | `src/pages/ReferralPage.tsx` | 102 | Couldn't apply code | `Referral.couldnTApplyCode` |
| Dynamic text bypassing i18n | `src/pages/ReferralPage.tsx` | 122 | Couldn't request payout | `Referral.couldnTRequestPayout` |
| Dynamic text bypassing i18n | `src/pages/ReferralPage.tsx` | 157 | Copied | `Referral.copied` |
| Dynamic text bypassing i18n | `src/pages/ReferralPage.tsx` | 163 | Copied | `Referral.copied` |
| Dynamic text bypassing i18n | `src/pages/ReferralPage.tsx` | 163 | Copy | `Referral.copy` |
| Dynamic text bypassing i18n | `src/pages/ReferralPage.tsx` | 208 | Paid | `Referral.paid` |
| Dynamic text bypassing i18n | `src/pages/ReferralPage.tsx` | 286 | Requesting… | `Referral.requesting` |
| Missing Malayalam Entry | `landing locale` | - | Built-in analytics | `analyticsTeaser.badge` |
| Missing Malayalam Entry | `landing locale` | - | See where your money moves | `analyticsTeaser.title` |
| Missing Malayalam Entry | `landing locale` | - | Track income, expenses and profit over any range — daily, weekly, monthly or yearly — with clear breakdowns by client and category. | `analyticsTeaser.subtitle` |
| Missing Malayalam Entry | `landing locale` | - | View Analytics | `analyticsTeaser.cta` |
| Missing Malayalam Entry | `landing locale` | - | Analytics | `analyticsTeaser.cardTitle` |
| Missing Malayalam Entry | `landing locale` | - | Last 6 months | `analyticsTeaser.cardRange` |
| Missing Malayalam Entry | `landing locale` | - | Income | `analyticsTeaser.income` |
| Missing Malayalam Entry | `landing locale` | - | Expense | `analyticsTeaser.expense` |
| Missing Malayalam Entry | `landing locale` | - | Profit | `analyticsTeaser.profit` |
| Missing Malayalam Entry | `landing locale` | - | Blog | `nav.blog` |
| Missing Malayalam Entry | `landing locale` | - | Go to dashboard | `nav.goToDashboard` |
| Missing Malayalam Entry | `landing locale` | - | Blog | `blog.eyebrow` |
| Missing Malayalam Entry | `landing locale` | - | Blog — ProfitSync | `blog.metaTitle` |
| Missing Malayalam Entry | `landing locale` | - | Guides, tips and stories on running the money side of your business — cash flow, clients, quotations, and growing as a freelancer or small team. | `blog.metaDescription` |
| Missing Malayalam Entry | `landing locale` | - | Insights for running a leaner business | `blog.title` |
| Missing Malayalam Entry | `landing locale` | - | Practical guides on cash flow, clients, quotations and the money side of independent work. | `blog.subtitle` |
| Missing Malayalam Entry | `landing locale` | - | From the blog | `blog.landingTitle` |
| Missing Malayalam Entry | `landing locale` | - | Practical guides on cash flow, clients and growing your business. | `blog.landingSubtitle` |
| Missing Malayalam Entry | `landing locale` | - | View all posts | `blog.viewAll` |
| Missing Malayalam Entry | `landing locale` | - | {{minutes}} min read | `blog.readTime` |
| Missing Malayalam Entry | `landing locale` | - | Load more | `blog.loadMore` |
| Missing Malayalam Entry | `landing locale` | - | We couldn't load the blog right now. | `blog.loadError` |
| Missing Malayalam Entry | `landing locale` | - | Try again | `blog.retry` |
| Missing Malayalam Entry | `landing locale` | - | No posts yet | `blog.emptyTitle` |
| Missing Malayalam Entry | `landing locale` | - | We're working on it — check back soon for guides and updates. | `blog.emptyBody` |
| Missing Malayalam Entry | `landing locale` | - | Post not found | `blog.notFoundTitle` |
| Missing Malayalam Entry | `landing locale` | - | This post may have been moved or unpublished. | `blog.notFoundBody` |
| Missing Malayalam Entry | `landing locale` | - | Back to blog | `blog.backToBlog` |
| Missing Malayalam Entry | `landing locale` | - | Ready to know your profit? | `blog.ctaTitle` |
| Missing Malayalam Entry | `landing locale` | - | Create your free ProfitSync workspace and bring your income, expenses and clients into one clean place. | `blog.ctaSubtitle` |
| Missing Malayalam Entry | `landing locale` | - | Get started free | `blog.ctaButton` |
| Missing Malayalam Entry | `landing locale` | - | Blog | `footer.links.blog` |
| Missing Malayalam Entry | `landing locale` | - | Refund Policy | `footer.links.refund` |

## P3 - Low priority

| Source category | File | Line | Current text | Proposed translation key |
|---|---|---:|---|---|
| Missing translation key | `src/pages/ClientFilesPage.tsx` | 63 | bg-muted text-foreground/70 | `ClientFiles.bgMutedTextForeground70` |
| Missing translation key | `src/pages/ClientFilesPage.tsx` | 64 | bg-blue-500/10 text-blue-600 dark:text-blue-400 | `ClientFiles.bgBlue50010Text` |
| Missing translation key | `src/pages/ClientFilesPage.tsx` | 65 | bg-amber-500/10 text-amber-600 dark:text-amber-400 | `ClientFiles.bgAmber50010Text` |
| Missing translation key | `src/pages/ClientFilesPage.tsx` | 66 | bg-violet-500/10 text-violet-600 dark:text-violet-400 | `ClientFiles.bgViolet50010Text` |
| Missing translation key | `src/pages/WealthAccountDetailPage.tsx` | 182 | text-emerald-600 dark:text-emerald-400 | `WealthAccountDetail.textEmerald600DarkText` |
| Hardcoded text | `src/components/ClientDetailSheet.tsx` | 68 | text-sm font-semibold tabular-nums | `ClientDetail.textSmFontSemiboldTabular` |
| Hardcoded text | `src/components/ClientDetailSheet.tsx` | 72 | text-sm font-semibold tabular-nums | `ClientDetail.textSmFontSemiboldTabular` |
| Hardcoded text | `src/components/ClientDetailSheet.tsx` | 76 | text-sm font-semibold tabular-nums | `ClientDetail.textSmFontSemiboldTabular` |
| Hardcoded text | `src/components/ClientOverviewModal.tsx` | 142 | text-sm font-semibold tabular-nums | `ClientOverview.textSmFontSemiboldTabular` |
| Hardcoded text | `src/components/ClientOverviewModal.tsx` | 146 | text-sm font-semibold tabular-nums | `ClientOverview.textSmFontSemiboldTabular` |
| Hardcoded text | `src/components/ClientOverviewModal.tsx` | 150 | text-sm font-semibold tabular-nums | `ClientOverview.textSmFontSemiboldTabular` |
| Hardcoded text | `src/pages/AnalyticsPage.tsx` | 242 | text-base sm:text-xl font-bold tabular-nums | `Analytics.textBaseSmTextXl` |
| Hardcoded text | `src/pages/CategoriesPage.tsx` | 141 | w-36 sm:w-64 | `Categories.w36SmW64` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 426 | text-base sm:text-xl font-bold tabular-nums | `ClientDetail.textBaseSmTextXl` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 431 | text-base sm:text-xl font-bold tabular-nums | `ClientDetail.textBaseSmTextXl` |
| Hardcoded text | `src/pages/ClientDetailPage.tsx` | 436 | text-base sm:text-xl font-bold tabular-nums | `ClientDetail.textBaseSmTextXl` |
| Hardcoded text | `src/pages/ClientFilesPage.tsx` | 246 | w-36 sm:w-56 | `ClientFiles.w36SmW56` |
| Hardcoded text | `src/pages/ClientsPage.tsx` | 301 | w-36 sm:w-64 | `Clients.w36SmW64` |
| Hardcoded text | `src/pages/ClosedClientsPage.tsx` | 118 | w-36 sm:w-64 | `ClosedClients.w36SmW64` |
| Hardcoded text | `src/pages/Dashboard.tsx` | 104 | text-lg sm:text-2xl font-bold tabular-nums | `Dashboard.textLgSmText2xl` |
| Hardcoded text | `src/pages/Dashboard.tsx` | 466 | text-2xl sm:text-3xl font-bold tabular-nums | `Dashboard.text2xlSmText3xl` |
| Hardcoded text | `src/pages/QuotationsPage.tsx` | 614 | w-full sm:w-72 | `Quotations.wFullSmW72` |
| Hardcoded text | `src/pages/TransactionsPage.tsx` | 577 | text-base sm:text-xl font-bold tabular-nums | `Transactions.textBaseSmTextXl` |
| Hardcoded text | `src/pages/TransactionsPage.tsx` | 581 | text-base sm:text-xl font-bold tabular-nums | `Transactions.textBaseSmTextXl` |
| Hardcoded text | `src/pages/TransactionsPage.tsx` | 585 | text-base sm:text-xl font-bold tabular-nums | `Transactions.textBaseSmTextXl` |
| Hardcoded text | `src/pages/TransactionsPage.tsx` | 597 | w-full sm:w-72 | `Transactions.wFullSmW72` |
| Hardcoded text | `src/pages/WealthAccountDetailPage.tsx` | 261 | text-sm sm:text-lg font-bold tabular-nums | `WealthAccountDetail.textSmSmTextLg` |

## P4 - Do not translate

| Source category | File | Line | Current text | Proposed translation key |
|---|---|---:|---|---|
| Missing translation key | `src/pages/ReferralPage.tsx` | 84 | ProfitSync | `Referral.profitsync` |
| Hardcoded text | `src/components/AppLayout.tsx` | 209 | ProfitSync | `AppLayout.profitsync` |
| Hardcoded text | `src/components/LegalLayout.tsx` | 24 | ProfitSync | `LegalLayout.profitsync` |
| Hardcoded text | `src/components/LegalLayout.tsx` | 44 | ProfitSync | `LegalLayout.profitsync` |
| Hardcoded text | `src/components/MobileAppLayout.tsx` | 219 | ProfitSync | `MobileAppLayout.profitsync` |
| Hardcoded text | `src/components/onboarding/shell.tsx` | 30 | ProfitSync | `onboarding.shell.profitsync` |
| Hardcoded text | `src/landing/components/DashboardMockup.tsx` | 84 | app.profitsync.net/dashboard | `landing.components.DashboardMockup.appProfitsyncNetDashboard` |
| Hardcoded text | `src/landing/components/Logo.tsx` | 28 | ProfitSync | `landing.components.Logo.profitsync` |
| Hardcoded text | `src/pages/ForgotPasswordPage.tsx` | 166 | ProfitSync | `ForgotPassword.profitsync` |
| Dynamic text bypassing i18n | `src/landing/sections/Features.tsx` | 108 | Lumen & Co. | `landing.sections.Features.lumenCo` |

