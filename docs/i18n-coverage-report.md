# ProfitSync i18n Coverage Audit

Generated: 2026-06-15T22:00:19.234Z

## Summary

| Metric | Count |
|---|---:|
| Total strings audited | 1967 |
| Translated i18n usages | 1263 |
| Missing / unlocalized findings | 704 |
| Coverage percentage | 64.2% |

## Method

- Scanned `src/**/*.ts`, `src/**/*.tsx`, `src/**/*.js`, and `src/**/*.jsx`.
- Parsed files with the TypeScript compiler API to identify JSX text, user-visible JSX attributes, toast/alert/confirm strings, visible option/config labels, and translated `t("...")` calls.
- Compared English and Malayalam locale key sets in both app and landing i18n trees.
- Excluded shared low-level UI primitives under `src/components/ui`, tests, and locale JSON files from hardcoded-string findings.

## Risks And Assumptions

- Static analysis can over-report strings that are internal names and under-report text assembled from server data or indirect component props.
- Existing translated key usage is counted by direct `t("literal.key")` calls only; keys passed through helper wrappers may not be counted as translated.
- This report intentionally proposes keys only. It does not modify source code or locale files.

## Missing translation key

| File | Line | Current text | Proposed translation key |
|---|---:|---|---|
| `src/components/wealth/icon-select.tsx` | 13 | Bank | `wealth.iconselect.bank` |
| `src/components/wealth/icon-select.tsx` | 14 | Card | `wealth.iconselect.card` |
| `src/components/wealth/icon-select.tsx` | 15 | Cash | `wealth.iconselect.cash` |
| `src/components/wealth/icon-select.tsx` | 16 | Wallet | `wealth.iconselect.wallet` |
| `src/components/wealth/icon-select.tsx` | 17 | Business | `wealth.iconselect.business` |
| `src/components/wealth/icon-select.tsx` | 18 | Custom | `wealth.iconselect.custom` |
| `src/landing/i18n/languages.ts` | 14 | English | `landing.i18n.languages.english` |
| `src/landing/i18n/languages.ts` | 15 | Italiano | `landing.i18n.languages.italiano` |
| `src/landing/i18n/languages.ts` | 15 | Italian | `landing.i18n.languages.italian` |
| `src/landing/i18n/languages.ts` | 16 | Deutsch | `landing.i18n.languages.deutsch` |
| `src/landing/i18n/languages.ts` | 16 | German | `landing.i18n.languages.german` |
| `src/landing/i18n/languages.ts` | 17 | Hindi | `landing.i18n.languages.hindi` |
| `src/landing/i18n/languages.ts` | 18 | Malayalam | `landing.i18n.languages.malayalam` |
| `src/landing/i18n/languages.ts` | 19 | Tamil | `landing.i18n.languages.tamil` |
| `src/landing/i18n/languages.ts` | 20 | Telugu | `landing.i18n.languages.telugu` |
| `src/landing/i18n/languages.ts` | 21 | Arabic | `landing.i18n.languages.arabic` |
| `src/lib/admin-roles.ts` | 54 | Full access — including plans, settings and managing other admins. | `lib.adminroles.fullAccessIncludingPlansSettings` |
| `src/lib/admin-roles.ts` | 57 | Editor | `lib.adminroles.editor` |
| `src/lib/admin-roles.ts` | 58 | View and edit users, organizations, subscriptions, invoices and blog. No settings or admin management. | `lib.adminroles.viewAndEditUsersOrganizations` |
| `src/lib/admin-roles.ts` | 61 | Viewer | `lib.adminroles.viewer` |
| `src/lib/admin-roles.ts` | 62 | Read-only access to the admin console. | `lib.adminroles.readOnlyAccessToThe` |
| `src/lib/countries.ts` | 11 | Afghanistan | `lib.countries.afghanistan` |
| `src/lib/countries.ts` | 12 | Albania | `lib.countries.albania` |
| `src/lib/countries.ts` | 13 | Algeria | `lib.countries.algeria` |
| `src/lib/countries.ts` | 14 | Argentina | `lib.countries.argentina` |
| `src/lib/countries.ts` | 15 | Armenia | `lib.countries.armenia` |
| `src/lib/countries.ts` | 16 | Australia | `lib.countries.australia` |
| `src/lib/countries.ts` | 17 | Austria | `lib.countries.austria` |
| `src/lib/countries.ts` | 18 | Azerbaijan | `lib.countries.azerbaijan` |
| `src/lib/countries.ts` | 19 | Bahrain | `lib.countries.bahrain` |
| `src/lib/countries.ts` | 20 | Bangladesh | `lib.countries.bangladesh` |
| `src/lib/countries.ts` | 21 | Belarus | `lib.countries.belarus` |
| `src/lib/countries.ts` | 22 | Belgium | `lib.countries.belgium` |
| `src/lib/countries.ts` | 23 | Bolivia | `lib.countries.bolivia` |
| `src/lib/countries.ts` | 25 | Brazil | `lib.countries.brazil` |
| `src/lib/countries.ts` | 26 | Bulgaria | `lib.countries.bulgaria` |
| `src/lib/countries.ts` | 27 | Cambodia | `lib.countries.cambodia` |
| `src/lib/countries.ts` | 28 | Cameroon | `lib.countries.cameroon` |
| `src/lib/countries.ts` | 29 | Canada | `lib.countries.canada` |
| `src/lib/countries.ts` | 30 | Chile | `lib.countries.chile` |
| `src/lib/countries.ts` | 31 | China | `lib.countries.china` |
| `src/lib/countries.ts` | 32 | Colombia | `lib.countries.colombia` |
| `src/lib/countries.ts` | 34 | Croatia | `lib.countries.croatia` |
| `src/lib/countries.ts` | 35 | Cyprus | `lib.countries.cyprus` |
| `src/lib/countries.ts` | 36 | Czechia | `lib.countries.czechia` |
| `src/lib/countries.ts` | 37 | Denmark | `lib.countries.denmark` |
| `src/lib/countries.ts` | 39 | Ecuador | `lib.countries.ecuador` |
| `src/lib/countries.ts` | 40 | Egypt | `lib.countries.egypt` |
| `src/lib/countries.ts` | 42 | Estonia | `lib.countries.estonia` |
| `src/lib/countries.ts` | 43 | Ethiopia | `lib.countries.ethiopia` |
| `src/lib/countries.ts` | 44 | Finland | `lib.countries.finland` |
| `src/lib/countries.ts` | 45 | France | `lib.countries.france` |
| `src/lib/countries.ts` | 46 | Georgia | `lib.countries.georgia` |
| `src/lib/countries.ts` | 47 | Germany | `lib.countries.germany` |
| `src/lib/countries.ts` | 48 | Ghana | `lib.countries.ghana` |
| `src/lib/countries.ts` | 49 | Greece | `lib.countries.greece` |
| `src/lib/countries.ts` | 50 | Guatemala | `lib.countries.guatemala` |
| `src/lib/countries.ts` | 51 | Honduras | `lib.countries.honduras` |
| `src/lib/countries.ts` | 53 | Hungary | `lib.countries.hungary` |
| `src/lib/countries.ts` | 54 | Iceland | `lib.countries.iceland` |
| `src/lib/countries.ts` | 55 | India | `lib.countries.india` |
| `src/lib/countries.ts` | 56 | Indonesia | `lib.countries.indonesia` |
| `src/lib/countries.ts` | 57 | Iraq | `lib.countries.iraq` |
| `src/lib/countries.ts` | 58 | Ireland | `lib.countries.ireland` |
| `src/lib/countries.ts` | 59 | Israel | `lib.countries.israel` |
| `src/lib/countries.ts` | 60 | Italy | `lib.countries.italy` |
| `src/lib/countries.ts` | 61 | Jamaica | `lib.countries.jamaica` |
| `src/lib/countries.ts` | 62 | Japan | `lib.countries.japan` |
| `src/lib/countries.ts` | 63 | Jordan | `lib.countries.jordan` |
| `src/lib/countries.ts` | 64 | Kazakhstan | `lib.countries.kazakhstan` |
| `src/lib/countries.ts` | 65 | Kenya | `lib.countries.kenya` |
| `src/lib/countries.ts` | 66 | Kuwait | `lib.countries.kuwait` |
| `src/lib/countries.ts` | 67 | Latvia | `lib.countries.latvia` |
| `src/lib/countries.ts` | 68 | Lebanon | `lib.countries.lebanon` |
| `src/lib/countries.ts` | 69 | Lithuania | `lib.countries.lithuania` |
| `src/lib/countries.ts` | 70 | Luxembourg | `lib.countries.luxembourg` |
| `src/lib/countries.ts` | 71 | Macau | `lib.countries.macau` |
| `src/lib/countries.ts` | 72 | Malaysia | `lib.countries.malaysia` |
| `src/lib/countries.ts` | 73 | Maldives | `lib.countries.maldives` |
| `src/lib/countries.ts` | 74 | Malta | `lib.countries.malta` |
| `src/lib/countries.ts` | 75 | Mexico | `lib.countries.mexico` |
| `src/lib/countries.ts` | 76 | Moldova | `lib.countries.moldova` |
| `src/lib/countries.ts` | 77 | Morocco | `lib.countries.morocco` |
| `src/lib/countries.ts` | 78 | Nepal | `lib.countries.nepal` |
| `src/lib/countries.ts` | 79 | Netherlands | `lib.countries.netherlands` |
| `src/lib/countries.ts` | 81 | Nigeria | `lib.countries.nigeria` |
| `src/lib/countries.ts` | 82 | Norway | `lib.countries.norway` |
| `src/lib/countries.ts` | 83 | Oman | `lib.countries.oman` |
| `src/lib/countries.ts` | 84 | Pakistan | `lib.countries.pakistan` |
| `src/lib/countries.ts` | 85 | Panama | `lib.countries.panama` |
| `src/lib/countries.ts` | 86 | Paraguay | `lib.countries.paraguay` |
| `src/lib/countries.ts` | 87 | Peru | `lib.countries.peru` |
| `src/lib/countries.ts` | 88 | Philippines | `lib.countries.philippines` |
| `src/lib/countries.ts` | 89 | Poland | `lib.countries.poland` |
| `src/lib/countries.ts` | 90 | Portugal | `lib.countries.portugal` |
| `src/lib/countries.ts` | 91 | Qatar | `lib.countries.qatar` |
| `src/lib/countries.ts` | 92 | Romania | `lib.countries.romania` |
| `src/lib/countries.ts` | 93 | Russia | `lib.countries.russia` |
| `src/lib/countries.ts` | 95 | Serbia | `lib.countries.serbia` |
| `src/lib/countries.ts` | 96 | Singapore | `lib.countries.singapore` |
| `src/lib/countries.ts` | 97 | Slovakia | `lib.countries.slovakia` |
| `src/lib/countries.ts` | 98 | Slovenia | `lib.countries.slovenia` |
| `src/lib/countries.ts` | 101 | Spain | `lib.countries.spain` |
| `src/lib/countries.ts` | 103 | Sweden | `lib.countries.sweden` |
| `src/lib/countries.ts` | 104 | Switzerland | `lib.countries.switzerland` |
| `src/lib/countries.ts` | 105 | Taiwan | `lib.countries.taiwan` |
| `src/lib/countries.ts` | 106 | Tanzania | `lib.countries.tanzania` |
| `src/lib/countries.ts` | 107 | Thailand | `lib.countries.thailand` |
| `src/lib/countries.ts` | 108 | Tunisia | `lib.countries.tunisia` |
| `src/lib/countries.ts` | 109 | Türkiye | `lib.countries.tRkiye` |
| `src/lib/countries.ts` | 110 | Uganda | `lib.countries.uganda` |
| `src/lib/countries.ts` | 111 | Ukraine | `lib.countries.ukraine` |
| `src/lib/countries.ts` | 115 | Uruguay | `lib.countries.uruguay` |
| `src/lib/countries.ts` | 116 | Uzbekistan | `lib.countries.uzbekistan` |
| `src/lib/countries.ts` | 117 | Venezuela | `lib.countries.venezuela` |
| `src/lib/countries.ts` | 118 | Vietnam | `lib.countries.vietnam` |
| `src/lib/countries.ts` | 119 | Yemen | `lib.countries.yemen` |
| `src/lib/countries.ts` | 120 | Zambia | `lib.countries.zambia` |
| `src/lib/countries.ts` | 121 | Zimbabwe | `lib.countries.zimbabwe` |
| `src/lib/currencies.ts` | 19 | Bosnia-Herzegovina Convertible Mark | `lib.currencies.bosniaHerzegovinaConvertibleMark` |
| `src/lib/currencies.ts` | 40 | Costa Rican Colón | `lib.currencies.costaRicanColN` |
| `src/lib/currencies.ts` | 51 | Euro | `lib.currencies.euro` |
| `src/lib/currencies.ts` | 72 | Icelandic Króna | `lib.currencies.icelandicKrNa` |
| `src/lib/currencies.ts` | 96 | Mongolian Tögrög | `lib.currencies.mongolianTGrG` |
| `src/lib/currencies.ts` | 107 | Nicaraguan Córdoba | `lib.currencies.nicaraguanCRdoba` |
| `src/lib/currencies.ts` | 117 | Polish Złoty | `lib.currencies.polishZOty` |
| `src/lib/currencies.ts` | 118 | Paraguayan Guaraní | `lib.currencies.paraguayanGuaran` |
| `src/lib/currencies.ts` | 134 | São Tomé and Príncipe Dobra | `lib.currencies.sOTomAndPr` |
| `src/lib/currencies.ts` | 135 | Salvadoran Colón | `lib.currencies.salvadoranColN` |
| `src/lib/currencies.ts` | 142 | Tongan Paʻanga | `lib.currencies.tonganPaAnga` |
| `src/lib/currencies.ts` | 152 | Venezuelan Bolívar | `lib.currencies.venezuelanBolVar` |
| `src/lib/currencies.ts` | 153 | Vietnamese Đồng | `lib.currencies.vietnameseNg` |
| `src/lib/currencies.ts` | 155 | Samoan Tālā | `lib.currencies.samoanTL` |
| `src/lib/i18n/languages.ts` | 15 | English | `lib.i18n.languages.english` |
| `src/lib/i18n/languages.ts` | 16 | Italiano | `lib.i18n.languages.italiano` |
| `src/lib/i18n/languages.ts` | 16 | Italian | `lib.i18n.languages.italian` |
| `src/lib/i18n/languages.ts` | 17 | Deutsch | `lib.i18n.languages.deutsch` |
| `src/lib/i18n/languages.ts` | 17 | German | `lib.i18n.languages.german` |
| `src/lib/i18n/languages.ts` | 18 | Hindi | `lib.i18n.languages.hindi` |
| `src/lib/i18n/languages.ts` | 19 | Malayalam | `lib.i18n.languages.malayalam` |
| `src/lib/i18n/languages.ts` | 20 | Tamil | `lib.i18n.languages.tamil` |
| `src/lib/i18n/languages.ts` | 21 | Telugu | `lib.i18n.languages.telugu` |
| `src/lib/i18n/languages.ts` | 22 | Arabic | `lib.i18n.languages.arabic` |
| `src/lib/seo/site.ts` | 11 | ProfitSync — Know your profit. Sync your business. | `lib.seo.site.profitsyncKnowYourProfitSync` |
| `src/lib/seo/site.ts` | 13 | ProfitSync brings your clients, cash flow, and quotations into one clean workspace — so you always know exactly where your money stands. | `lib.seo.site.profitsyncBringsYourClientsCash` |
| `src/lib/seo/site.ts` | 221 | Free plan, forever — upgrade to Premium any time. | `lib.seo.site.freePlanForeverUpgradeTo` |
| `src/pages/admin/admin-nav.ts` | 26 | Overview | `admin.adminnav.overview` |
| `src/pages/admin/admin-nav.ts` | 27 | Users | `admin.adminnav.users` |
| `src/pages/admin/admin-nav.ts` | 28 | Organizations | `admin.adminnav.organizations` |
| `src/pages/admin/admin-nav.ts` | 29 | Subscriptions | `admin.adminnav.subscriptions` |
| `src/pages/admin/admin-nav.ts` | 30 | Invoices | `admin.adminnav.invoices` |
| `src/pages/admin/admin-nav.ts` | 31 | Plans | `admin.adminnav.plans` |
| `src/pages/admin/admin-nav.ts` | 32 | Blog | `admin.adminnav.blog` |
| `src/pages/admin/admin-nav.ts` | 33 | Referrals | `admin.adminnav.referrals` |
| `src/pages/admin/admin-nav.ts` | 34 | Admins | `admin.adminnav.admins` |
| `src/pages/admin/AdminOverviewPage.tsx` | 45 | Organizations | `admin.AdminOverview.organizations` |
| `src/pages/admin/AdminOverviewPage.tsx` | 48 | Subscriptions | `admin.AdminOverview.subscriptions` |
| `src/pages/admin/AdminOverviewPage.tsx` | 52 | Transactions | `admin.AdminOverview.transactions` |
| `src/pages/admin/AdminPlansPage.tsx` | 97 | Clients | `admin.AdminPlans.clients` |
| `src/pages/admin/AdminPlansPage.tsx` | 99 | Quotations | `admin.AdminPlans.quotations` |
| `src/pages/admin/AdminPlansPage.tsx` | 106 | Personal | `admin.AdminPlans.personal` |
| `src/pages/admin/AdminPlansPage.tsx` | 107 | Business | `admin.AdminPlans.business` |
| `src/pages/ClientFilesPage.tsx` | 63 | Document | `ClientFiles.document` |
| `src/pages/ClientFilesPage.tsx` | 63 | bg-muted text-foreground/70 | `ClientFiles.bgMutedTextForeground70` |
| `src/pages/ClientFilesPage.tsx` | 64 | Transaction | `ClientFiles.transaction` |
| `src/pages/ClientFilesPage.tsx` | 64 | bg-blue-500/10 text-blue-600 dark:text-blue-400 | `ClientFiles.bgBlue50010Text` |
| `src/pages/ClientFilesPage.tsx` | 65 | Quote | `ClientFiles.quote` |
| `src/pages/ClientFilesPage.tsx` | 65 | bg-amber-500/10 text-amber-600 dark:text-amber-400 | `ClientFiles.bgAmber50010Text` |
| `src/pages/ClientFilesPage.tsx` | 66 | Account | `ClientFiles.account` |
| `src/pages/ClientFilesPage.tsx` | 66 | bg-violet-500/10 text-violet-600 dark:text-violet-400 | `ClientFiles.bgViolet50010Text` |
| `src/pages/ReferralPage.tsx` | 84 | ProfitSync | `Referral.profitsync` |
| `src/pages/WealthAccountDetailPage.tsx` | 182 | text-emerald-600 dark:text-emerald-400 | `WealthAccountDetail.textEmerald600DarkText` |

## Hardcoded text

| File | Line | Current text | Proposed translation key |
|---|---:|---|---|
| `src/components/AppLayout.tsx` | 209 | ProfitSync | `AppLayout.profitsync` |
| `src/components/ClientDetailSheet.tsx` | 59 | Closed | `ClientDetail.closed` |
| `src/components/ClientDetailSheet.tsx` | 68 | text-sm font-semibold tabular-nums | `ClientDetail.textSmFontSemiboldTabular` |
| `src/components/ClientDetailSheet.tsx` | 72 | text-sm font-semibold tabular-nums | `ClientDetail.textSmFontSemiboldTabular` |
| `src/components/ClientDetailSheet.tsx` | 76 | text-sm font-semibold tabular-nums | `ClientDetail.textSmFontSemiboldTabular` |
| `src/components/ClientOverviewModal.tsx` | 133 | Closed | `ClientOverview.closed` |
| `src/components/ClientOverviewModal.tsx` | 141 | Income | `ClientOverview.income` |
| `src/components/ClientOverviewModal.tsx` | 142 | text-sm font-semibold tabular-nums | `ClientOverview.textSmFontSemiboldTabular` |
| `src/components/ClientOverviewModal.tsx` | 145 | Expense | `ClientOverview.expense` |
| `src/components/ClientOverviewModal.tsx` | 146 | text-sm font-semibold tabular-nums | `ClientOverview.textSmFontSemiboldTabular` |
| `src/components/ClientOverviewModal.tsx` | 149 | Profit | `ClientOverview.profit` |
| `src/components/ClientOverviewModal.tsx` | 150 | text-sm font-semibold tabular-nums | `ClientOverview.textSmFontSemiboldTabular` |
| `src/components/ClientOverviewModal.tsx` | 172 | Documents | `ClientOverview.documents` |
| `src/components/ClientOverviewModal.tsx` | 176 | Upload | `ClientOverview.upload` |
| `src/components/CountryCombobox.tsx` | 46 | Search country… | `CountryCombobox.searchCountry` |
| `src/components/CountryCombobox.tsx` | 91 | Search code… | `CountryCombobox.searchCode` |
| `src/components/CurrencyCombobox.tsx` | 51 | Search by currency, code, or country... | `CurrencyCombobox.searchByCurrencyCodeOr` |
| `src/components/LegalLayout.tsx` | 24 | ProfitSync | `LegalLayout.profitsync` |
| `src/components/LegalLayout.tsx` | 44 | ProfitSync | `LegalLayout.profitsync` |
| `src/components/MobileAppLayout.tsx` | 214 | Home | `MobileAppLayout.home` |
| `src/components/MobileAppLayout.tsx` | 219 | ProfitSync | `MobileAppLayout.profitsync` |
| `src/components/onboarding/shell.tsx` | 30 | ProfitSync | `onboarding.shell.profitsync` |
| `src/components/OrgSwitcher.tsx` | 36 | Loading… | `OrgSwitcher.loading` |
| `src/components/OrgSwitcher.tsx` | 79 | Search organizations… | `OrgSwitcher.searchOrganizations` |
| `src/components/OrgSwitcher.tsx` | 109 | Personal | `OrgSwitcher.personal` |
| `src/components/ReferralBanner.tsx` | 50 | Dismiss | `ReferralBanner.dismiss` |
| `src/landing/components/DashboardMockup.tsx` | 84 | app.profitsync.net/dashboard | `landing.components.DashboardMockup.appProfitsyncNetDashboard` |
| `src/landing/components/Logo.tsx` | 14 | ProfitSync — home | `landing.components.Logo.profitsyncHome` |
| `src/landing/components/Logo.tsx` | 28 | ProfitSync | `landing.components.Logo.profitsync` |
| `src/landing/sections/AnalyticsTeaser.tsx` | 53 | $48.2k | `landing.sections.AnalyticsTeaser.482k` |
| `src/landing/sections/AnalyticsTeaser.tsx` | 57 | $19.6k | `landing.sections.AnalyticsTeaser.196k` |
| `src/landing/sections/AnalyticsTeaser.tsx` | 61 | $28.6k | `landing.sections.AnalyticsTeaser.286k` |
| `src/landing/sections/Footer.tsx` | 73 | ProfitSync. | `landing.sections.Footer.profitsync` |
| `src/pages/admin/AdminAdminsPage.tsx` | 130 | Admins | `admin.AdminAdmins.admins` |
| `src/pages/admin/AdminAdminsPage.tsx` | 132 | that controls what they can do — | `admin.AdminAdmins.thatControlsWhatTheyCan` |
| `src/pages/admin/AdminAdminsPage.tsx` | 133 | (everything), | `admin.AdminAdmins.everything` |
| `src/pages/admin/AdminAdminsPage.tsx` | 134 | Editor | `admin.AdminAdmins.editor` |
| `src/pages/admin/AdminAdminsPage.tsx` | 134 | (manage content, no settings/admins), | `admin.AdminAdmins.manageContentNoSettingsAdmins` |
| `src/pages/admin/AdminAdminsPage.tsx` | 135 | Viewer | `admin.AdminAdmins.viewer` |
| `src/pages/admin/AdminAdminsPage.tsx` | 135 | (read-only) or | `admin.AdminAdmins.readOnlyOr` |
| `src/pages/admin/AdminAdminsPage.tsx` | 137 | environment variable, are always super admin, and can't be changed here. | `admin.AdminAdmins.environmentVariableAreAlwaysSuper` |
| `src/pages/admin/AdminAdminsPage.tsx` | 161 | Role | `admin.AdminAdmins.role` |
| `src/pages/admin/AdminAdminsPage.tsx` | 189 | Root | `admin.AdminAdmins.root` |
| `src/pages/admin/AdminAdminsPage.tsx` | 190 | You | `admin.AdminAdmins.you` |
| `src/pages/admin/AdminAdminsPage.tsx` | 228 | Remove admin access? | `admin.AdminAdmins.removeAdminAccess` |
| `src/pages/admin/AdminAdminsPage.tsx` | 235 | Cancel | `admin.AdminAdmins.cancel` |
| `src/pages/admin/AdminAdminsPage.tsx` | 242 | Remove | `admin.AdminAdmins.remove` |
| `src/pages/admin/AdminBlogPage.tsx` | 256 | Blog | `admin.AdminBlog.blog` |
| `src/pages/admin/AdminBlogPage.tsx` | 358 | Edit | `admin.AdminBlog.edit` |
| `src/pages/admin/AdminBlogPage.tsx` | 389 | Title | `admin.AdminBlog.title` |
| `src/pages/admin/AdminBlogPage.tsx` | 399 | Slug | `admin.AdminBlog.slug` |
| `src/pages/admin/AdminBlogPage.tsx` | 410 | URL: | `admin.AdminBlog.url` |
| `src/pages/admin/AdminBlogPage.tsx` | 425 | Author | `admin.AdminBlog.author` |
| `src/pages/admin/AdminBlogPage.tsx` | 437 | Social image URL (1200×630) | `admin.AdminBlog.socialImageUrl1200630` |
| `src/pages/admin/AdminBlogPage.tsx` | 454 | Used for grouping &amp; schema articleSection. | `admin.AdminBlog.usedForGroupingAmpSchema` |
| `src/pages/admin/AdminBlogPage.tsx` | 461 | A credible, externally-linked author improves search ranking and how AI engines cite the post. | `admin.AdminBlog.aCredibleExternallyLinkedAuthor` |
| `src/pages/admin/AdminBlogPage.tsx` | 471 | Founder, ProfitSync | `admin.AdminBlog.founderProfitsync` |
| `src/pages/admin/AdminBlogPage.tsx` | 499 | One or two sentences on the author's relevant experience. | `admin.AdminBlog.oneOrTwoSentencesOn` |
| `src/pages/admin/AdminBlogPage.tsx` | 507 | Excerpt | `admin.AdminBlog.excerpt` |
| `src/pages/admin/AdminBlogPage.tsx` | 518 | Tags | `admin.AdminBlog.tags` |
| `src/pages/admin/AdminBlogPage.tsx` | 523 | finance, freelancing, tips | `admin.AdminBlog.financeFreelancingTips` |
| `src/pages/admin/AdminBlogPage.tsx` | 525 | Comma-separated. | `admin.AdminBlog.commaSeparated` |
| `src/pages/admin/AdminBlogPage.tsx` | 529 | Content | `admin.AdminBlog.content` |
| `src/pages/admin/AdminBlogPage.tsx` | 532 | Write | `admin.AdminBlog.write` |
| `src/pages/admin/AdminBlogPage.tsx` | 533 | Preview | `admin.AdminBlog.preview` |
| `src/pages/admin/AdminBlogPage.tsx` | 580 | Status | `admin.AdminBlog.status` |
| `src/pages/admin/AdminBlogPage.tsx` | 586 | Draft — hidden from the public | `admin.AdminBlog.draftHiddenFromThePublic` |
| `src/pages/admin/AdminBlogPage.tsx` | 587 | Published — live on the blog | `admin.AdminBlog.publishedLiveOnTheBlog` |
| `src/pages/admin/AdminBlogPage.tsx` | 595 | Cancel | `admin.AdminBlog.cancel` |
| `src/pages/admin/AdminBlogPage.tsx` | 609 | Delete this post? | `admin.AdminBlog.deleteThisPost` |
| `src/pages/admin/AdminBlogPage.tsx` | 611 | ” will be permanently deleted. This cannot be undone. | `admin.AdminBlog.willBePermanentlyDeletedThis` |
| `src/pages/admin/AdminBlogPage.tsx` | 615 | Cancel | `admin.AdminBlog.cancel` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 204 | Invoices | `admin.AdminInvoices.invoices` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 225 | All | `admin.AdminInvoices.all` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 238 | Invoice | `admin.AdminInvoices.invoice` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 239 | Organization | `admin.AdminInvoices.organization` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 240 | Amount | `admin.AdminInvoices.amount` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 241 | Status | `admin.AdminInvoices.status` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 242 | Issued | `admin.AdminInvoices.issued` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 243 | Paid | `admin.AdminInvoices.paid` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 300 | View | `admin.AdminInvoices.view` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 302 | Edit | `admin.AdminInvoices.edit` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 312 | Page | `admin.AdminInvoices.page` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 345 | Organization | `admin.AdminInvoices.organization` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 347 | Owner | `admin.AdminInvoices.owner` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 349 | Amount | `admin.AdminInvoices.amount` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 351 | Provider | `admin.AdminInvoices.provider` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 355 | Subscription | `admin.AdminInvoices.subscription` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 357 | Issued | `admin.AdminInvoices.issued` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 359 | Paid | `admin.AdminInvoices.paid` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 361 | Created | `admin.AdminInvoices.created` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 366 | Status | `admin.AdminInvoices.status` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 376 | Cancel | `admin.AdminInvoices.cancel` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 392 | Organization | `admin.AdminInvoices.organization` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 398 | Select an organization… | `admin.AdminInvoices.selectAnOrganization` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 406 | Amount | `admin.AdminInvoices.amount` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 410 | Currency | `admin.AdminInvoices.currency` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 415 | Status | `admin.AdminInvoices.status` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 424 | Cancel | `admin.AdminInvoices.cancel` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 427 | Create | `admin.AdminInvoices.create` |
| `src/pages/admin/AdminLayout.tsx` | 90 | Internal · privileged | `admin.AdminLayout.internalPrivileged` |
| `src/pages/admin/AdminLayout.tsx` | 161 | Logout | `admin.AdminLayout.logout` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 208 | Organizations | `admin.AdminOrgDetail.organizations` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 218 | Personal | `admin.AdminOrgDetail.personal` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 252 | Overview | `admin.AdminOrgDetail.overview` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 255 | Clients | `admin.AdminOrgDetail.clients` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 258 | Transactions | `admin.AdminOrgDetail.transactions` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 261 | Subscription | `admin.AdminOrgDetail.subscription` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 264 | Members | `admin.AdminOrgDetail.members` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 306 | Clients | `admin.AdminOrgDetail.clients` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 307 | Transactions | `admin.AdminOrgDetail.transactions` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 308 | Quotations | `admin.AdminOrgDetail.quotations` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 315 | Owner | `admin.AdminOrgDetail.owner` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 462 | Search by name, company, or email | `admin.AdminOrgDetail.searchByNameCompanyOr` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 470 | All | `admin.AdminOrgDetail.all` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 471 | Active | `admin.AdminOrgDetail.active` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 472 | Inactive | `admin.AdminOrgDetail.inactive` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 473 | Archived | `admin.AdminOrgDetail.archived` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 483 | Client | `admin.AdminOrgDetail.client` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 484 | Status | `admin.AdminOrgDetail.status` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 485 | Txns | `admin.AdminOrgDetail.txns` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 486 | Incoming | `admin.AdminOrgDetail.incoming` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 487 | Outgoing | `admin.AdminOrgDetail.outgoing` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 520 | Edit | `admin.AdminOrgDetail.edit` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 534 | Page | `admin.AdminOrgDetail.page` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 554 | Name | `admin.AdminOrgDetail.name` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 558 | Company | `admin.AdminOrgDetail.company` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 566 | Phone | `admin.AdminOrgDetail.phone` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 575 | Status | `admin.AdminOrgDetail.status` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 583 | Notes | `admin.AdminOrgDetail.notes` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 593 | Cancel | `admin.AdminOrgDetail.cancel` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 605 | Move client to trash? | `admin.AdminOrgDetail.moveClientToTrash` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 608 | will be marked deleted. Their transactions stay in the database but won't appear in the org. | `admin.AdminOrgDetail.willBeMarkedDeletedTheir` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 611 | Cancel | `admin.AdminOrgDetail.cancel` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 781 | Search description, category, or client | `admin.AdminOrgDetail.searchDescriptionCategoryOrClient` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 789 | All | `admin.AdminOrgDetail.all` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 790 | Incoming | `admin.AdminOrgDetail.incoming` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 791 | Outgoing | `admin.AdminOrgDetail.outgoing` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 802 | Client | `admin.AdminOrgDetail.client` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 803 | Type | `admin.AdminOrgDetail.type` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 804 | Amount | `admin.AdminOrgDetail.amount` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 805 | Description | `admin.AdminOrgDetail.description` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 835 | Edit | `admin.AdminOrgDetail.edit` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 849 | Page | `admin.AdminOrgDetail.page` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 868 | Client | `admin.AdminOrgDetail.client` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 875 | Select a client… | `admin.AdminOrgDetail.selectAClient` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 884 | Type | `admin.AdminOrgDetail.type` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 896 | Amount | `admin.AdminOrgDetail.amount` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 900 | Category | `admin.AdminOrgDetail.category` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 905 | Description | `admin.AdminOrgDetail.description` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 910 | Cancel | `admin.AdminOrgDetail.cancel` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 922 | Delete transaction? | `admin.AdminOrgDetail.deleteTransaction` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 928 | Cancel | `admin.AdminOrgDetail.cancel` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 1007 | Plan | `admin.AdminOrgDetail.plan` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 1015 | Status | `admin.AdminOrgDetail.status` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 1113 | Members + pending invitations. | `admin.AdminOrgDetail.membersPendingInvitations` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 1151 | Role: | `admin.AdminOrgDetail.role` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 1156 | Revoke | `admin.AdminOrgDetail.revoke` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 1184 | Role | `admin.AdminOrgDetail.role` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 1201 | Cancel | `admin.AdminOrgDetail.cancel` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 1211 | Refresh | `admin.AdminOrgDetail.refresh` |
| `src/pages/admin/AdminOrgsPage.tsx` | 315 | Organizations | `admin.AdminOrgs.organizations` |
| `src/pages/admin/AdminOrgsPage.tsx` | 316 | All organizations across the platform. Click a row to manage its clients, transactions, and subscription. | `admin.AdminOrgs.allOrganizationsAcrossThePlatform` |
| `src/pages/admin/AdminOrgsPage.tsx` | 342 | All | `admin.AdminOrgs.all` |
| `src/pages/admin/AdminOrgsPage.tsx` | 343 | Team | `admin.AdminOrgs.team` |
| `src/pages/admin/AdminOrgsPage.tsx` | 344 | Personal | `admin.AdminOrgs.personal` |
| `src/pages/admin/AdminOrgsPage.tsx` | 357 | Clear | `admin.AdminOrgs.clear` |
| `src/pages/admin/AdminOrgsPage.tsx` | 373 | Organization | `admin.AdminOrgs.organization` |
| `src/pages/admin/AdminOrgsPage.tsx` | 374 | Owner | `admin.AdminOrgs.owner` |
| `src/pages/admin/AdminOrgsPage.tsx` | 375 | Members | `admin.AdminOrgs.members` |
| `src/pages/admin/AdminOrgsPage.tsx` | 376 | Clients | `admin.AdminOrgs.clients` |
| `src/pages/admin/AdminOrgsPage.tsx` | 377 | Quotes | `admin.AdminOrgs.quotes` |
| `src/pages/admin/AdminOrgsPage.tsx` | 378 | Plan | `admin.AdminOrgs.plan` |
| `src/pages/admin/AdminOrgsPage.tsx` | 415 | Personal | `admin.AdminOrgs.personal` |
| `src/pages/admin/AdminOrgsPage.tsx` | 452 | Free | `admin.AdminOrgs.free` |
| `src/pages/admin/AdminOrgsPage.tsx` | 454 | Upgrade | `admin.AdminOrgs.upgrade` |
| `src/pages/admin/AdminOrgsPage.tsx` | 460 | Rename | `admin.AdminOrgs.rename` |
| `src/pages/admin/AdminOrgsPage.tsx` | 491 | Page | `admin.AdminOrgs.page` |
| `src/pages/admin/AdminOrgsPage.tsx` | 510 | Name | `admin.AdminOrgs.name` |
| `src/pages/admin/AdminOrgsPage.tsx` | 523 | Cancel | `admin.AdminOrgs.cancel` |
| `src/pages/admin/AdminOrgsPage.tsx` | 526 | Save | `admin.AdminOrgs.save` |
| `src/pages/admin/AdminOrgsPage.tsx` | 535 | Delete organization permanently? | `admin.AdminOrgs.deleteOrganizationPermanently` |
| `src/pages/admin/AdminOrgsPage.tsx` | 538 | along with its clients, transactions, and quotations. Any active Dodo subscription is cancelled so billing stops. | `admin.AdminOrgs.alongWithItsClientsTransactions` |
| `src/pages/admin/AdminOrgsPage.tsx` | 541 | Cancel | `admin.AdminOrgs.cancel` |
| `src/pages/admin/AdminOrgsPage.tsx` | 556 | This permanently deletes the selected organizations along with their clients, transactions, and quotations. Any active Dodo subscription is cancelled so billing stops. This cannot be undone. | `admin.AdminOrgs.thisPermanentlyDeletesTheSelected` |
| `src/pages/admin/AdminOrgsPage.tsx` | 559 | Cancel | `admin.AdminOrgs.cancel` |
| `src/pages/admin/AdminOrgsPage.tsx` | 575 | Owner | `admin.AdminOrgs.owner` |
| `src/pages/admin/AdminOrgsPage.tsx` | 585 | Search a user by email or name… | `admin.AdminOrgs.searchAUserByEmail` |
| `src/pages/admin/AdminOrgsPage.tsx` | 588 | Searching… | `admin.AdminOrgs.searching` |
| `src/pages/admin/AdminOrgsPage.tsx` | 614 | Currency | `admin.AdminOrgs.currency` |
| `src/pages/admin/AdminOrgsPage.tsx` | 623 | Cancel | `admin.AdminOrgs.cancel` |
| `src/pages/admin/AdminOrgsPage.tsx` | 626 | Create | `admin.AdminOrgs.create` |
| `src/pages/admin/AdminPlansPage.tsx` | 182 | List | `admin.AdminPlans.list` |
| `src/pages/admin/AdminPlansPage.tsx` | 190 | Metadata | `admin.AdminPlans.metadata` |
| `src/pages/admin/AdminPlansPage.tsx` | 345 | Which account type is this plan for? | `admin.AdminPlans.whichAccountTypeIsThis` |
| `src/pages/admin/AdminPlansPage.tsx` | 384 | Live | `admin.AdminPlans.live` |
| `src/pages/admin/AdminPlansPage.tsx` | 384 | for real billing, | `admin.AdminPlans.forRealBilling` |
| `src/pages/admin/AdminPlansPage.tsx` | 385 | Test | `admin.AdminPlans.test` |
| `src/pages/admin/AdminPlansPage.tsx` | 395 | plan. We'll pull the name, description, prices and discounts automatically. | `admin.AdminPlans.planWeLlPullThe` |
| `src/pages/admin/AdminPlansPage.tsx` | 400 | pdt_… | `admin.AdminPlans.pdt` |
| `src/pages/admin/AdminPlansPage.tsx` | 404 | pdt_… | `admin.AdminPlans.pdt` |
| `src/pages/admin/AdminPlansPage.tsx` | 416 | Description | `admin.AdminPlans.description` |
| `src/pages/admin/AdminPlansPage.tsx` | 479 | Back | `admin.AdminPlans.back` |
| `src/pages/admin/AdminPlansPage.tsx` | 484 | Continue | `admin.AdminPlans.continue` |
| `src/pages/admin/AdminPlansPage.tsx` | 628 | Plans | `admin.AdminPlans.plans` |
| `src/pages/admin/AdminPlansPage.tsx` | 630 | Personal &amp; Business plans are driven by Dodo Payments product IDs. Use the wizard to paste a product ID and sync the name, description, prices and discounts in one step. | `admin.AdminPlans.personalAmpBusinessPlansAre` |
| `src/pages/admin/AdminPlansPage.tsx` | 644 | Delete “ | `admin.AdminPlans.delete` |
| `src/pages/admin/AdminPlansPage.tsx` | 646 | This removes the plan from ProfitSync only — the Dodo product is | `admin.AdminPlans.thisRemovesThePlanFrom` |
| `src/pages/admin/AdminPlansPage.tsx` | 647 | deleted in Dodo. Any customers currently on this plan keep their subscription, but it can no longer be offered to new ones. | `admin.AdminPlans.deletedInDodoAnyCustomers` |
| `src/pages/admin/AdminPlansPage.tsx` | 652 | Cancel | `admin.AdminPlans.cancel` |
| `src/pages/admin/AdminPlansPage.tsx` | 691 | Test | `admin.AdminPlans.test` |
| `src/pages/admin/AdminPlansPage.tsx` | 703 | Save | `admin.AdminPlans.save` |
| `src/pages/admin/AdminPlansPage.tsx` | 721 | Monthly | `admin.AdminPlans.monthly` |
| `src/pages/admin/AdminPlansPage.tsx` | 725 | Yearly | `admin.AdminPlans.yearly` |
| `src/pages/admin/AdminPlansPage.tsx` | 742 | Pricing &amp; promo | `admin.AdminPlans.pricingAmpPromo` |
| `src/pages/admin/AdminPlansPage.tsx` | 745 | Limits &amp; features | `admin.AdminPlans.limitsAmpFeatures` |
| `src/pages/admin/AdminPlansPage.tsx` | 748 | Integration | `admin.AdminPlans.integration` |
| `src/pages/admin/AdminPlansPage.tsx` | 754 | Description | `admin.AdminPlans.description` |
| `src/pages/admin/AdminPlansPage.tsx` | 766 | — shown on the plan card | `admin.AdminPlans.shownOnThePlanCard` |
| `src/pages/admin/AdminPlansPage.tsx` | 771 | e.g. "First month 50% off" | `admin.AdminPlans.eGFirstMonth50` |
| `src/pages/admin/AdminPlansPage.tsx` | 800 | Country | `admin.AdminPlans.country` |
| `src/pages/admin/AdminPlansPage.tsx` | 804 | Currency | `admin.AdminPlans.currency` |
| `src/pages/admin/AdminPlansPage.tsx` | 882 | Monthly | `admin.AdminPlans.monthly` |
| `src/pages/admin/AdminPlansPage.tsx` | 883 | pdt_… | `admin.AdminPlans.pdt` |
| `src/pages/admin/AdminPlansPage.tsx` | 886 | Yearly | `admin.AdminPlans.yearly` |
| `src/pages/admin/AdminPlansPage.tsx` | 887 | pdt_… | `admin.AdminPlans.pdt` |
| `src/pages/admin/AdminPlansPage.tsx` | 891 | Environment | `admin.AdminPlans.environment` |
| `src/pages/admin/AdminPlansPage.tsx` | 907 | Which Dodo environment these product IDs live in. Used for sync, checkout and invoices. | `admin.AdminPlans.whichDodoEnvironmentTheseProduct` |
| `src/pages/admin/AdminReferralsPage.tsx` | 154 | Reject | `admin.AdminReferrals.reject` |
| `src/pages/admin/AdminReferralsPage.tsx` | 169 | Referrals | `admin.AdminReferrals.referrals` |
| `src/pages/admin/AdminReferralsPage.tsx` | 170 | Owed (paid, awaiting payout): | `admin.AdminReferrals.owedPaidAwaitingPayout` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 231 | Subscriptions | `admin.AdminSubscriptions.subscriptions` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 249 | Free | `admin.AdminSubscriptions.free` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 250 | Personal | `admin.AdminSubscriptions.personal` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 251 | Business | `admin.AdminSubscriptions.business` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 256 | Any | `admin.AdminSubscriptions.any` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 257 | Pending | `admin.AdminSubscriptions.pending` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 258 | Active | `admin.AdminSubscriptions.active` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 260 | Cancelled | `admin.AdminSubscriptions.cancelled` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 280 | Clear | `admin.AdminSubscriptions.clear` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 296 | Organization | `admin.AdminSubscriptions.organization` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 297 | Plan | `admin.AdminSubscriptions.plan` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 298 | Status | `admin.AdminSubscriptions.status` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 299 | Cycle | `admin.AdminSubscriptions.cycle` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 300 | Provider | `admin.AdminSubscriptions.provider` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 301 | Renews | `admin.AdminSubscriptions.renews` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 365 | Edit | `admin.AdminSubscriptions.edit` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 376 | Page | `admin.AdminSubscriptions.page` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 400 | Plan | `admin.AdminSubscriptions.plan` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 408 | Status | `admin.AdminSubscriptions.status` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 430 | Cancel | `admin.AdminSubscriptions.cancel` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 433 | Save | `admin.AdminSubscriptions.save` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 452 | Free/stub rows have no Dodo subscription, so only their local state changes. | `admin.AdminSubscriptions.freeStubRowsHaveNo` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 455 | Cancel | `admin.AdminSubscriptions.cancel` |
| `src/pages/admin/AdminUsersPage.tsx` | 229 | Users | `admin.AdminUsers.users` |
| `src/pages/admin/AdminUsersPage.tsx` | 242 | Search by email, name, or user id | `admin.AdminUsers.searchByEmailNameOr` |
| `src/pages/admin/AdminUsersPage.tsx` | 256 | All | `admin.AdminUsers.all` |
| `src/pages/admin/AdminUsersPage.tsx` | 257 | Active | `admin.AdminUsers.active` |
| `src/pages/admin/AdminUsersPage.tsx` | 258 | Banned | `admin.AdminUsers.banned` |
| `src/pages/admin/AdminUsersPage.tsx` | 268 | User | `admin.AdminUsers.user` |
| `src/pages/admin/AdminUsersPage.tsx` | 269 | Orgs | `admin.AdminUsers.orgs` |
| `src/pages/admin/AdminUsersPage.tsx` | 270 | Premium | `admin.AdminUsers.premium` |
| `src/pages/admin/AdminUsersPage.tsx` | 271 | Status | `admin.AdminUsers.status` |
| `src/pages/admin/AdminUsersPage.tsx` | 272 | Joined | `admin.AdminUsers.joined` |
| `src/pages/admin/AdminUsersPage.tsx` | 296 | Admin | `admin.AdminUsers.admin` |
| `src/pages/admin/AdminUsersPage.tsx` | 308 | Banned | `admin.AdminUsers.banned` |
| `src/pages/admin/AdminUsersPage.tsx` | 310 | Active | `admin.AdminUsers.active` |
| `src/pages/admin/AdminUsersPage.tsx` | 318 | Details | `admin.AdminUsers.details` |
| `src/pages/admin/AdminUsersPage.tsx` | 340 | Page | `admin.AdminUsers.page` |
| `src/pages/admin/AdminUsersPage.tsx` | 369 | Currency | `admin.AdminUsers.currency` |
| `src/pages/admin/AdminUsersPage.tsx` | 373 | Joined | `admin.AdminUsers.joined` |
| `src/pages/admin/AdminUsersPage.tsx` | 396 | Personal | `admin.AdminUsers.personal` |
| `src/pages/admin/AdminUsersPage.tsx` | 423 | Unban | `admin.AdminUsers.unban` |
| `src/pages/admin/AdminUsersPage.tsx` | 428 | Ban | `admin.AdminUsers.ban` |
| `src/pages/admin/AdminUsersPage.tsx` | 449 | Close | `admin.AdminUsers.close` |
| `src/pages/admin/AdminUsersPage.tsx` | 464 | Organization | `admin.AdminUsers.organization` |
| `src/pages/admin/AdminUsersPage.tsx` | 470 | Select an organization… | `admin.AdminUsers.selectAnOrganization` |
| `src/pages/admin/AdminUsersPage.tsx` | 490 | Role | `admin.AdminUsers.role` |
| `src/pages/admin/AdminUsersPage.tsx` | 507 | Cancel | `admin.AdminUsers.cancel` |
| `src/pages/admin/AdminUsersPage.tsx` | 519 | Delete user permanently? | `admin.AdminUsers.deleteUserPermanently` |
| `src/pages/admin/AdminUsersPage.tsx` | 522 | , every organization they own, plus all their clients, transactions, quotations, subscriptions, and invoices. This cannot be undone. | `admin.AdminUsers.everyOrganizationTheyOwnPlus` |
| `src/pages/admin/AdminUsersPage.tsx` | 525 | Cancel | `admin.AdminUsers.cancel` |
| `src/pages/AnalyticsPage.tsx` | 242 | text-base sm:text-xl font-bold tabular-nums | `Analytics.textBaseSmTextXl` |
| `src/pages/CategoriesPage.tsx` | 141 | w-36 sm:w-64 | `Categories.w36SmW64` |
| `src/pages/ClientDetailPage.tsx` | 374 | Closed | `ClientDetail.closed` |
| `src/pages/ClientDetailPage.tsx` | 380 | Onboarded | `ClientDetail.onboarded` |
| `src/pages/ClientDetailPage.tsx` | 425 | Income | `ClientDetail.income` |
| `src/pages/ClientDetailPage.tsx` | 426 | text-base sm:text-xl font-bold tabular-nums | `ClientDetail.textBaseSmTextXl` |
| `src/pages/ClientDetailPage.tsx` | 430 | Expenses | `ClientDetail.expenses` |
| `src/pages/ClientDetailPage.tsx` | 431 | text-base sm:text-xl font-bold tabular-nums | `ClientDetail.textBaseSmTextXl` |
| `src/pages/ClientDetailPage.tsx` | 435 | Net | `ClientDetail.net` |
| `src/pages/ClientDetailPage.tsx` | 436 | text-base sm:text-xl font-bold tabular-nums | `ClientDetail.textBaseSmTextXl` |
| `src/pages/ClientDetailPage.tsx` | 450 | Budget | `ClientDetail.budget` |
| `src/pages/ClientDetailPage.tsx` | 454 | Edit | `ClientDetail.edit` |
| `src/pages/ClientDetailPage.tsx` | 493 | Amount (high → low) | `ClientDetail.amountHighLow` |
| `src/pages/ClientDetailPage.tsx` | 494 | Amount (low → high) | `ClientDetail.amountLowHigh` |
| `src/pages/ClientDetailPage.tsx` | 500 | From | `ClientDetail.from` |
| `src/pages/ClientDetailPage.tsx` | 501 | To | `ClientDetail.to` |
| `src/pages/ClientDetailPage.tsx` | 507 | Files | `ClientDetail.files` |
| `src/pages/ClientDetailPage.tsx` | 559 | Type | `ClientDetail.type` |
| `src/pages/ClientDetailPage.tsx` | 581 | Description | `ClientDetail.description` |
| `src/pages/ClientDetailPage.tsx` | 584 | Category | `ClientDetail.category` |
| `src/pages/ClientDetailPage.tsx` | 594 | Attachments | `ClientDetail.attachments` |
| `src/pages/ClientDetailPage.tsx` | 606 | Remove | `ClientDetail.remove` |
| `src/pages/ClientDetailPage.tsx` | 616 | Cancel | `ClientDetail.cancel` |
| `src/pages/ClientDetailPage.tsx` | 629 | Type | `ClientDetail.type` |
| `src/pages/ClientDetailPage.tsx` | 652 | Description | `ClientDetail.description` |
| `src/pages/ClientDetailPage.tsx` | 655 | Category | `ClientDetail.category` |
| `src/pages/ClientDetailPage.tsx` | 666 | Cancel | `ClientDetail.cancel` |
| `src/pages/ClientDetailPage.tsx` | 678 | Name * | `ClientDetail.name` |
| `src/pages/ClientDetailPage.tsx` | 679 | Company | `ClientDetail.company` |
| `src/pages/ClientDetailPage.tsx` | 681 | Phone | `ClientDetail.phone` |
| `src/pages/ClientDetailPage.tsx` | 683 | Status | `ClientDetail.status` |
| `src/pages/ClientDetailPage.tsx` | 693 | Category | `ClientDetail.category` |
| `src/pages/ClientDetailPage.tsx` | 696 | Notes | `ClientDetail.notes` |
| `src/pages/ClientDetailPage.tsx` | 700 | Cancel | `ClientDetail.cancel` |
| `src/pages/ClientDetailPage.tsx` | 716 | Cancel | `ClientDetail.cancel` |
| `src/pages/ClientDetailPage.tsx` | 736 | Cancel | `ClientDetail.cancel` |
| `src/pages/ClientDetailPage.tsx` | 754 | Transaction | `ClientDetail.transaction` |
| `src/pages/ClientDetailPage.tsx` | 763 | Category | `ClientDetail.category` |
| `src/pages/ClientDetailPage.tsx` | 765 | Description | `ClientDetail.description` |
| `src/pages/ClientDetailPage.tsx` | 767 | Attachments | `ClientDetail.attachments` |
| `src/pages/ClientDetailPage.tsx` | 788 | History | `ClientDetail.history` |
| `src/pages/ClientDetailPage.tsx` | 794 | Edit | `ClientDetail.edit` |
| `src/pages/ClientDetailPage.tsx` | 796 | Close | `ClientDetail.close` |
| `src/pages/ClientFilesPage.tsx` | 243 | Files | `ClientFiles.files` |
| `src/pages/ClientFilesPage.tsx` | 246 | Search files… | `ClientFiles.searchFiles` |
| `src/pages/ClientFilesPage.tsx` | 246 | w-36 sm:w-56 | `ClientFiles.w36SmW56` |
| `src/pages/ClientFilesPage.tsx` | 251 | Source | `ClientFiles.source` |
| `src/pages/ClientFilesPage.tsx` | 256 | Documents | `ClientFiles.documents` |
| `src/pages/ClientFilesPage.tsx` | 257 | Transactions | `ClientFiles.transactions` |
| `src/pages/ClientFilesPage.tsx` | 258 | Quotes | `ClientFiles.quotes` |
| `src/pages/ClientFilesPage.tsx` | 268 | Name (A–Z) | `ClientFiles.nameAZ` |
| `src/pages/ClientFilesPage.tsx` | 269 | Largest | `ClientFiles.largest` |
| `src/pages/ClientFilesPage.tsx` | 284 | Upload | `ClientFiles.upload` |
| `src/pages/ClientFilesPage.tsx` | 298 | Upload documents, or attach files to transactions and quotations. | `ClientFiles.uploadDocumentsOrAttachFiles` |
| `src/pages/ClientFilesPage.tsx` | 333 | Download | `ClientFiles.download` |
| `src/pages/ClientFilesPage.tsx` | 369 | Delete attachment? | `ClientFiles.deleteAttachment` |
| `src/pages/ClientFilesPage.tsx` | 371 | This permanently removes “ | `ClientFiles.thisPermanentlyRemoves` |
| `src/pages/ClientFilesPage.tsx` | 371 | ” from its | `ClientFiles.fromIts` |
| `src/pages/ClientFilesPage.tsx` | 371 | . This can't be undone. | `ClientFiles.thisCanTBeUndone` |
| `src/pages/ClientFilesPage.tsx` | 375 | Cancel | `ClientFiles.cancel` |
| `src/pages/ClientsPage.tsx` | 301 | w-36 sm:w-64 | `Clients.w36SmW64` |
| `src/pages/ClosedClientsPage.tsx` | 118 | w-36 sm:w-64 | `ClosedClients.w36SmW64` |
| `src/pages/Dashboard.tsx` | 104 | text-lg sm:text-2xl font-bold tabular-nums | `Dashboard.textLgSmText2xl` |
| `src/pages/Dashboard.tsx` | 466 | text-2xl sm:text-3xl font-bold tabular-nums | `Dashboard.text2xlSmText3xl` |
| `src/pages/ForgotPasswordPage.tsx` | 166 | ProfitSync | `ForgotPassword.profitsync` |
| `src/pages/InvitationPage.tsx` | 159 | You're invited to | `Invitation.youReInvitedTo` |
| `src/pages/InvitationPage.tsx` | 161 | · for | `Invitation.for` |
| `src/pages/InvitationPage.tsx` | 183 | , but you're signed in as | `Invitation.butYouReSignedIn` |
| `src/pages/InvitationPage.tsx` | 199 | Joining | `Invitation.joining` |
| `src/pages/InvitationPage.tsx` | 206 | Decline | `Invitation.decline` |
| `src/pages/InvitationPage.tsx` | 210 | Accept | `Invitation.accept` |
| `src/pages/InvitationPage.tsx` | 216 | Expires | `Invitation.expires` |
| `src/pages/PrivacyPolicyPage.tsx` | 9 | Last updated: May 24, 2026 — Version | `PrivacyPolicy.lastUpdatedMay242026` |
| `src/pages/PrivacyPolicyPage.tsx` | 14 | ProfitSync ("we", "us", "our") provides accounting and client-tracking software ("the Service"). This Privacy Policy explains what personal data we collect when you use the Service, how we use it, who we share it with, and the rights you have over your data. | `PrivacyPolicy.profitsyncWeUsOurProvides` |
| `src/pages/PrivacyPolicyPage.tsx` | 21 | name, email address, password hash, and authentication metadata supplied via our identity provider (Clerk). | `PrivacyPolicy.nameEmailAddressPasswordHash` |
| `src/pages/PrivacyPolicyPage.tsx` | 22 | organization names, memberships, and roles you create within the Service. | `PrivacyPolicy.organizationNamesMembershipsAndRoles` |
| `src/pages/PrivacyPolicyPage.tsx` | 23 | clients, transactions, quotations, notes, and file attachments. | `PrivacyPolicy.clientsTransactionsQuotationsNotesAnd` |
| `src/pages/PrivacyPolicyPage.tsx` | 24 | IP address, browser type, timestamps, and pages viewed for security, fraud prevention, and analytics. | `PrivacyPolicy.ipAddressBrowserTypeTimestamps` |
| `src/pages/PrivacyPolicyPage.tsx` | 32 | To send transactional notifications (sign-up confirmation, security alerts, billing, support). | `PrivacyPolicy.toSendTransactionalNotificationsSign` |
| `src/pages/PrivacyPolicyPage.tsx` | 38 | We do not sell your personal data. We share limited data with sub-processors strictly to deliver the Service: Clerk (authentication), Neon (database hosting), Vercel (application hosting), and Dodo Payments (our Merchant of Record for subscription payments, when applicable). Each sub-processor is contractually bound to handle data consistent with applicable privacy laws. | `PrivacyPolicy.weDoNotSellYour` |
| `src/pages/PrivacyPolicyPage.tsx` | 46 | We retain personal data while your account is active. When you delete an organization or your account, related business data is permanently removed within 30 days, except where retention is required by law. | `PrivacyPolicy.weRetainPersonalDataWhile` |
| `src/pages/PrivacyPolicyPage.tsx` | 52 | You have the right to access, correct, export, or delete your personal data. To exercise any of these rights, contact us at | `PrivacyPolicy.youHaveTheRightTo` |
| `src/pages/PrivacyPolicyPage.tsx` | 64 | Your data may be processed in regions outside your country. Where required, we rely on Standard Contractual Clauses or other lawful mechanisms. | `PrivacyPolicy.yourDataMayBeProcessed` |
| `src/pages/PrivacyPolicyPage.tsx` | 70 | We may update this Privacy Policy from time to time. When we do, we will update the version number above and notify you in-product. Continued use of the Service after a change constitutes acceptance of the updated policy. | `PrivacyPolicy.weMayUpdateThisPrivacy` |
| `src/pages/PrivacyPolicyPage.tsx` | 77 | Questions? Email | `PrivacyPolicy.questionsEmail` |
| `src/pages/QuotationsPage.tsx` | 614 | w-full sm:w-72 | `Quotations.wFullSmW72` |
| `src/pages/QuotationsPage.tsx` | 616 | shrink-0 ml-auto | `Quotations.shrink0MlAuto` |
| `src/pages/QuotationsPage.tsx` | 737 | Converted | `Quotations.converted` |
| `src/pages/ReferralPage.tsx` | 67 | Couldn't copy | `Referral.couldnTCopy` |
| `src/pages/ReferralPage.tsx` | 78 | Couldn't copy | `Referral.couldnTCopy` |
| `src/pages/ReferralPage.tsx` | 139 | Refer &amp; earn | `Referral.referAmpEarn` |
| `src/pages/ReferralPage.tsx` | 164 | Share | `Referral.share` |
| `src/pages/ReferralPage.tsx` | 172 | Signups | `Referral.signups` |
| `src/pages/ReferralPage.tsx` | 175 | Available | `Referral.available` |
| `src/pages/ReferralPage.tsx` | 198 | You haven't referred anyone yet. Share your link to start earning. | `Referral.youHavenTReferredAnyone` |
| `src/pages/ReferralPage.tsx` | 249 | Have a referral code? | `Referral.haveAReferralCode` |
| `src/pages/ReferralPage.tsx` | 252 | Apply | `Referral.apply` |
| `src/pages/ReferralPage.tsx` | 263 | PayPal | `Referral.paypal` |
| `src/pages/ReferralPage.tsx` | 263 | Bank | `Referral.bank` |
| `src/pages/ReferralPage.tsx` | 266 | name@bank | `Referral.nameBank` |
| `src/pages/ReferralPage.tsx` | 281 | Available: | `Referral.available` |
| `src/pages/ReferralPage.tsx` | 285 | Cancel | `Referral.cancel` |
| `src/pages/RefundPolicyPage.tsx` | 7 | Last updated: June 3, 2026 | `RefundPolicy.lastUpdatedJune32026` |
| `src/pages/RefundPolicyPage.tsx` | 11 | ProfitSync ("we", "us", "our") offers subscription plans for our accounting and client-tracking software ("the Service"). This policy explains when subscription fees are, and are not, refundable. Subscription payments are processed by Dodo Payments, our Merchant of Record. | `RefundPolicy.profitsyncWeUsOurOffers` |
| `src/pages/RefundPolicyPage.tsx` | 26 | You can cancel anytime from the Subscription page; cancellation stops future renewals and your plan stays active until the end of the current paid period. | `RefundPolicy.youCanCancelAnytimeFrom` |
| `src/pages/RefundPolicyPage.tsx` | 27 | We do not provide automatic, prorated refunds for the unused portion of a billing period after a cancellation. | `RefundPolicy.weDoNotProvideAutomatic` |
| `src/pages/RefundPolicyPage.tsx` | 32 | If you are charged for a paid plan and are not satisfied, you may request a full refund within | `RefundPolicy.ifYouAreChargedFor` |
| `src/pages/RefundPolicyPage.tsx` | 47 | If you believe you were charged in error or charged more than once for the same period, contact us and we will investigate and refund any verified duplicate or erroneous charge regardless of the 7-day window. | `RefundPolicy.ifYouBelieveYouWere` |
| `src/pages/RefundPolicyPage.tsx` | 53 | Referral commissions are a reward, not a purchase, and are governed by the referral program terms shown in your account. A refund of a referred customer's payment may reverse any related referral reward. | `RefundPolicy.referralCommissionsAreAReward` |
| `src/pages/RefundPolicyPage.tsx` | 59 | from the address associated with your account, including the charge date and amount. We aim to respond within 3 business days. Approved refunds are processed by Dodo Payments and may take several business days to appear, depending on your bank or card issuer. | `RefundPolicy.fromTheAddressAssociatedWith` |
| `src/pages/RefundPolicyPage.tsx` | 67 | We may update this Refund Policy from time to time. Material changes will be reflected by the "last updated" date above and, where appropriate, communicated in the app. | `RefundPolicy.weMayUpdateThisRefund` |
| `src/pages/SignupPage.tsx` | 68 | Before you continue, please review and accept our legal documents. | `Signup.beforeYouContinuePleaseReview` |
| `src/pages/SignupPage.tsx` | 75 | View | `Signup.view` |
| `src/pages/SignupPage.tsx` | 79 | View | `Signup.view` |
| `src/pages/SignupPage.tsx` | 105 | Already have an account? | `Signup.alreadyHaveAnAccount` |
| `src/pages/TermsOfServicePage.tsx` | 10 | Last updated: June 3, 2026 — Version | `TermsOfService.lastUpdatedJune32026` |
| `src/pages/TermsOfServicePage.tsx` | 15 | By creating an account or using ProfitSync ("the Service", "we", "us", "our") you agree to these Terms of Service, our | `TermsOfService.byCreatingAnAccountOr` |
| `src/pages/TermsOfServicePage.tsx` | 16 | , and our | `TermsOfService.andOur` |
| `src/pages/TermsOfServicePage.tsx` | 17 | , which are incorporated here by reference. If you do not agree, do not use the Service. | `TermsOfService.whichAreIncorporatedHereBy` |
| `src/pages/TermsOfServicePage.tsx` | 21 | 2. Eligibility &amp; accounts | `TermsOfService.2EligibilityAmpAccounts` |
| `src/pages/TermsOfServicePage.tsx` | 23 | You must be at least 18 years old, or have the legal capacity to enter into a binding contract. | `TermsOfService.youMustBeAtLeast` |
| `src/pages/TermsOfServicePage.tsx` | 32 | use the Service for any unlawful, fraudulent, or harmful purpose; | `TermsOfService.useTheServiceForAny` |
| `src/pages/TermsOfServicePage.tsx` | 33 | attempt to gain unauthorized access to systems, accounts, or data of other users; | `TermsOfService.attemptToGainUnauthorizedAccess` |
| `src/pages/TermsOfServicePage.tsx` | 34 | reverse engineer, scrape, or place undue load on the Service; | `TermsOfService.reverseEngineerScrapeOrPlace` |
| `src/pages/TermsOfServicePage.tsx` | 35 | upload malware or content that infringes intellectual-property or privacy rights; | `TermsOfService.uploadMalwareOrContentThat` |
| `src/pages/TermsOfServicePage.tsx` | 40 | 4. Subscriptions, renewals &amp; cancellation | `TermsOfService.4SubscriptionsRenewalsAmpCancellation` |
| `src/pages/TermsOfServicePage.tsx` | 42 | Paid plans are billed in advance on a recurring monthly or yearly cycle through Dodo Payments, our Merchant of Record. | `TermsOfService.paidPlansAreBilledIn` |
| `src/pages/TermsOfServicePage.tsx` | 44 | You may cancel anytime from the Subscription page; cancellation stops future renewals and your plan stays active until the end of the current paid period. | `TermsOfService.youMayCancelAnytimeFrom` |
| `src/pages/TermsOfServicePage.tsx` | 45 | Plan changes (e.g. monthly → yearly, or upgrades) take effect as described at checkout; scheduled changes apply at the next billing date. | `TermsOfService.planChangesEGMonthly` |
| `src/pages/TermsOfServicePage.tsx` | 46 | Prices and plan limits may change with reasonable notice; changes never apply retroactively to a period you've already paid for. | `TermsOfService.pricesAndPlanLimitsMay` |
| `src/pages/TermsOfServicePage.tsx` | 51 | , which includes a 7-day refund window on subscription charges and the handling of duplicate or erroneous charges. | `TermsOfService.whichIncludesA7Day` |
| `src/pages/TermsOfServicePage.tsx` | 57 | The Free plan has usage limits (clients, transactions per client, quotations, attachments per record, attachment size, note length). Limits are listed in-product and may change with notice. Exceeding a limit requires upgrading to a paid plan. | `TermsOfService.theFreePlanHasUsage` |
| `src/pages/TermsOfServicePage.tsx` | 64 | If you participate in our referral program, you may earn a reward when a person you refer subscribes to a paid plan. Rewards, holding periods, minimum payouts, and eligibility are set by us and shown in your account; they are rewards, not purchases, and may be changed or discontinued prospectively. Self-referral, fraud, or abuse voids rewards. A refund or chargeback of a referred payment may reverse the related reward. Payouts are made manually to the details you provide; you are responsible for any taxes on rewards. | `TermsOfService.ifYouParticipateInOur` |
| `src/pages/TermsOfServicePage.tsx` | 71 | 8. Your data &amp; ownership | `TermsOfService.8YourDataAmpOwnership` |
| `src/pages/TermsOfServicePage.tsx` | 73 | You retain ownership of the business data you enter into the Service. You grant us a limited license to host and process this data solely to provide and secure the Service. You can export or delete your data; we access it only for support, security, or as required by law. See the | `TermsOfService.youRetainOwnershipOfThe` |
| `src/pages/TermsOfServicePage.tsx` | 81 | Each organization has owners, admins, editors, and viewers. The organization owner is responsible for managing memberships, permissions, and the organization's subscription. Org owners are responsible for the actions of members they invite. | `TermsOfService.eachOrganizationHasOwnersAdmins` |
| `src/pages/TermsOfServicePage.tsx` | 88 | The Service relies on third parties — Clerk (authentication), Neon (database), Vercel (hosting), and Dodo Payments (Merchant of Record for billing). Your use of those features is also subject to those providers' terms. We are not responsible for third-party outages or actions outside our control. | `TermsOfService.theServiceReliesOnThird` |
| `src/pages/TermsOfServicePage.tsx` | 95 | We aim for high availability but do not guarantee uninterrupted access. We may perform maintenance, updates, or take the Service offline temporarily, and will try to minimize disruption. | `TermsOfService.weAimForHighAvailability` |
| `src/pages/TermsOfServicePage.tsx` | 101 | The Service is provided "as is" and "as available" without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. ProfitSync helps you record financial information but is not a substitute for professional accounting, tax, or legal advice. | `TermsOfService.theServiceIsProvidedAs` |
| `src/pages/TermsOfServicePage.tsx` | 108 | To the maximum extent permitted by law, ProfitSync is not liable for indirect, incidental, special, consequential, or punitive damages, or for loss of profits, revenue, data, or goodwill. Our total aggregate liability for any claim relating to the Service is limited to the amounts you paid us in the twelve months before the event giving rise to the claim. | `TermsOfService.toTheMaximumExtentPermitted` |
| `src/pages/TermsOfServicePage.tsx` | 116 | You agree to indemnify and hold ProfitSync harmless from claims, damages, and expenses arising out of your misuse of the Service, your data, or your violation of these Terms or applicable law. | `TermsOfService.youAgreeToIndemnifyAnd` |
| `src/pages/TermsOfServicePage.tsx` | 122 | We may suspend or terminate accounts that violate these Terms or applicable law. You may close your account at any time. Upon termination, your data is deleted as described in our Privacy Policy, subject to records we must retain by law. | `TermsOfService.weMaySuspendOrTerminate` |
| `src/pages/TermsOfServicePage.tsx` | 129 | These Terms are governed by the laws of India, without regard to conflict-of-law principles. Disputes will be resolved in courts of competent jurisdiction in Bengaluru, India. | `TermsOfService.theseTermsAreGovernedBy` |
| `src/pages/TransactionsPage.tsx` | 577 | text-base sm:text-xl font-bold tabular-nums | `Transactions.textBaseSmTextXl` |
| `src/pages/TransactionsPage.tsx` | 581 | text-base sm:text-xl font-bold tabular-nums | `Transactions.textBaseSmTextXl` |
| `src/pages/TransactionsPage.tsx` | 585 | text-base sm:text-xl font-bold tabular-nums | `Transactions.textBaseSmTextXl` |
| `src/pages/TransactionsPage.tsx` | 597 | w-full sm:w-72 | `Transactions.wFullSmW72` |
| `src/pages/TransactionsPage.tsx` | 599 | shrink-0 ml-auto | `Transactions.shrink0MlAuto` |
| `src/pages/TransactionsPage.tsx` | 722 | Own | `Transactions.own` |
| `src/pages/WealthAccountDetailPage.tsx` | 261 | text-sm sm:text-lg font-bold tabular-nums | `WealthAccountDetail.textSmSmTextLg` |

## Dynamic text bypassing i18n

| File | Line | Current text | Proposed translation key |
|---|---:|---|---|
| `src/components/onboarding/PlanStep.tsx` | 152 | You're all set! | `onboarding.PlanStep.youReAllSet` |
| `src/components/OrgSwitcher.tsx` | 55 | Personal | `OrgSwitcher.personal` |
| `src/landing/sections/Features.tsx` | 108 | Lumen & Co. | `landing.sections.Features.lumenCo` |
| `src/lib/seo/site.ts` | 211 | Multi-currency workspaces | `lib.seo.site.multiCurrencyWorkspaces` |
| `src/pages/admin/AdminAdminsPage.tsx` | 187 | Unknown | `admin.AdminAdmins.unknown` |
| `src/pages/admin/AdminBlogPage.tsx` | 322 | Published | `admin.AdminBlog.published` |
| `src/pages/admin/AdminBlogPage.tsx` | 322 | Draft | `admin.AdminBlog.draft` |
| `src/pages/admin/AdminBlogPage.tsx` | 356 | Unpublish | `admin.AdminBlog.unpublish` |
| `src/pages/admin/AdminBlogPage.tsx` | 356 | Publish | `admin.AdminBlog.publish` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 138 | Failed | `admin.AdminInvoices.failed` |
| `src/pages/admin/AdminInvoicesPage.tsx` | 155 | Failed | `admin.AdminInvoices.failed` |
| `src/pages/admin/AdminLayout.tsx` | 72 | Admin | `admin.AdminLayout.admin` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 167 | Failed | `admin.AdminOrgDetail.failed` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 423 | Failed | `admin.AdminOrgDetail.failed` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 440 | Failed | `admin.AdminOrgDetail.failed` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 742 | Failed | `admin.AdminOrgDetail.failed` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 759 | Failed | `admin.AdminOrgDetail.failed` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 977 | Failed | `admin.AdminOrgDetail.failed` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 997 | Failed | `admin.AdminOrgDetail.failed` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 1092 | Failed | `admin.AdminOrgDetail.failed` |
| `src/pages/admin/AdminOrgDetailPage.tsx` | 1106 | Failed | `admin.AdminOrgDetail.failed` |
| `src/pages/admin/AdminOrgsPage.tsx` | 190 | Failed | `admin.AdminOrgs.failed` |
| `src/pages/admin/AdminOrgsPage.tsx` | 207 | Failed | `admin.AdminOrgs.failed` |
| `src/pages/admin/AdminOrgsPage.tsx` | 269 | Failed | `admin.AdminOrgs.failed` |
| `src/pages/admin/AdminOrgsPage.tsx` | 300 | Failed | `admin.AdminOrgs.failed` |
| `src/pages/admin/AdminPlansPage.tsx` | 265 | Plan | `admin.AdminPlans.plan` |
| `src/pages/admin/AdminPlansPage.tsx` | 336 | Review & save | `admin.AdminPlans.reviewSave` |
| `src/pages/admin/AdminPlansPage.tsx` | 587 | Failed | `admin.AdminPlans.failed` |
| `src/pages/admin/AdminPlansPage.tsx` | 696 | Active | `admin.AdminPlans.active` |
| `src/pages/admin/AdminPlansPage.tsx` | 696 | Disabled | `admin.AdminPlans.disabled` |
| `src/pages/admin/AdminPlansPage.tsx` | 844 | Personal plans don't include clients or quotations, so those quotas are hidden. | `admin.AdminPlans.personalPlansDonTInclude` |
| `src/pages/admin/AdminPlansPage.tsx` | 845 | Number = the real limit enforced by quota · Text = what's shown in this plan's feature list. | `admin.AdminPlans.numberTheRealLimitEnforced` |
| `src/pages/admin/AdminReferralsPage.tsx` | 130 | Saving… | `admin.AdminReferrals.saving` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 182 | Not a Dodo subscription — nothing to sync | `admin.AdminSubscriptions.notADodoSubscriptionNothing` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 217 | Failed | `admin.AdminSubscriptions.failed` |
| `src/pages/admin/AdminSubscriptionsPage.tsx` | 450 | Each Dodo subscription is cancelled immediately (billing stops) and the row is reset to the Free tier — clearing the renew date, billing cycle and provider link. | `admin.AdminSubscriptions.eachDodoSubscriptionIsCancelled` |
| `src/pages/admin/AdminUsersPage.tsx` | 199 | Failed | `admin.AdminUsers.failed` |
| `src/pages/admin/AdminUsersPage.tsx` | 217 | Failed | `admin.AdminUsers.failed` |
| `src/pages/BudgetDetailPage.tsx` | 78 | T00:00:00Z | `BudgetDetail.t000000z` |
| `src/pages/ClientDetailPage.tsx` | 257 | Income | `ClientDetail.income` |
| `src/pages/ClientDetailPage.tsx` | 257 | Expense | `ClientDetail.expense` |
| `src/pages/ClientDetailPage.tsx` | 528 | Income | `ClientDetail.income` |
| `src/pages/ClientDetailPage.tsx` | 528 | Expense | `ClientDetail.expense` |
| `src/pages/ClientDetailPage.tsx` | 568 | Incoming | `ClientDetail.incoming` |
| `src/pages/ClientDetailPage.tsx` | 568 | Outgoing | `ClientDetail.outgoing` |
| `src/pages/ClientDetailPage.tsx` | 617 | Adding... | `ClientDetail.adding` |
| `src/pages/ClientDetailPage.tsx` | 617 | Add | `ClientDetail.add` |
| `src/pages/ClientDetailPage.tsx` | 638 | Incoming | `ClientDetail.incoming` |
| `src/pages/ClientDetailPage.tsx` | 638 | Outgoing | `ClientDetail.outgoing` |
| `src/pages/ClientDetailPage.tsx` | 667 | Saving... | `ClientDetail.saving` |
| `src/pages/ClientDetailPage.tsx` | 667 | Save | `ClientDetail.save` |
| `src/pages/ClientDetailPage.tsx` | 701 | Saving... | `ClientDetail.saving` |
| `src/pages/ClientDetailPage.tsx` | 701 | Save | `ClientDetail.save` |
| `src/pages/ClientDetailPage.tsx` | 710 | Move Client to Trash? | `ClientDetail.moveClientToTrash` |
| `src/pages/ClientDetailPage.tsx` | 710 | Delete Transaction? | `ClientDetail.deleteTransaction` |
| `src/pages/ClientDetailPage.tsx` | 728 | Reopen this client? | `ClientDetail.reopenThisClient` |
| `src/pages/ClientDetailPage.tsx` | 728 | Close this client? | `ClientDetail.closeThisClient` |
| `src/pages/ClientDetailPage.tsx` | 738 | Reopen | `ClientDetail.reopen` |
| `src/pages/ClientDetailPage.tsx` | 738 | Close | `ClientDetail.close` |
| `src/pages/InvitationPage.tsx` | 113 | Failed | `Invitation.failed` |
| `src/pages/ReferralPage.tsx` | 102 | Couldn't apply code | `Referral.couldnTApplyCode` |
| `src/pages/ReferralPage.tsx` | 122 | Couldn't request payout | `Referral.couldnTRequestPayout` |
| `src/pages/ReferralPage.tsx` | 157 | Copied | `Referral.copied` |
| `src/pages/ReferralPage.tsx` | 163 | Copied | `Referral.copied` |
| `src/pages/ReferralPage.tsx` | 163 | Copy | `Referral.copy` |
| `src/pages/ReferralPage.tsx` | 208 | Paid | `Referral.paid` |
| `src/pages/ReferralPage.tsx` | 286 | Requesting… | `Referral.requesting` |

## Missing Malayalam Entry

| Scope | Translation key | English text |
|---|---|---|
| landing | `analyticsTeaser.badge` | Built-in analytics |
| landing | `analyticsTeaser.title` | See where your money moves |
| landing | `analyticsTeaser.subtitle` | Track income, expenses and profit over any range — daily, weekly, monthly or yearly — with clear breakdowns by client and category. |
| landing | `analyticsTeaser.cta` | View Analytics |
| landing | `analyticsTeaser.cardTitle` | Analytics |
| landing | `analyticsTeaser.cardRange` | Last 6 months |
| landing | `analyticsTeaser.income` | Income |
| landing | `analyticsTeaser.expense` | Expense |
| landing | `analyticsTeaser.profit` | Profit |
| landing | `nav.blog` | Blog |
| landing | `nav.goToDashboard` | Go to dashboard |
| landing | `blog.eyebrow` | Blog |
| landing | `blog.metaTitle` | Blog — ProfitSync |
| landing | `blog.metaDescription` | Guides, tips and stories on running the money side of your business — cash flow, clients, quotations, and growing as a freelancer or small team. |
| landing | `blog.title` | Insights for running a leaner business |
| landing | `blog.subtitle` | Practical guides on cash flow, clients, quotations and the money side of independent work. |
| landing | `blog.landingTitle` | From the blog |
| landing | `blog.landingSubtitle` | Practical guides on cash flow, clients and growing your business. |
| landing | `blog.viewAll` | View all posts |
| landing | `blog.readTime` | {{minutes}} min read |
| landing | `blog.loadMore` | Load more |
| landing | `blog.loadError` | We couldn't load the blog right now. |
| landing | `blog.retry` | Try again |
| landing | `blog.emptyTitle` | No posts yet |
| landing | `blog.emptyBody` | We're working on it — check back soon for guides and updates. |
| landing | `blog.notFoundTitle` | Post not found |
| landing | `blog.notFoundBody` | This post may have been moved or unpublished. |
| landing | `blog.backToBlog` | Back to blog |
| landing | `blog.ctaTitle` | Ready to know your profit? |
| landing | `blog.ctaSubtitle` | Create your free ProfitSync workspace and bring your income, expenses and clients into one clean place. |
| landing | `blog.ctaButton` | Get started free |
| landing | `footer.links.blog` | Blog |
| landing | `footer.links.refund` | Refund Policy |

## Translated Usage Count By File

| File | Translated usages |
|---|---:|
| `src/components/AccountSelector.tsx` | 10 |
| `src/components/AppErrorFallback.tsx` | 3 |
| `src/components/AppLayout.tsx` | 14 |
| `src/components/AttachmentDetailModal.tsx` | 26 |
| `src/components/AuditHistory.tsx` | 4 |
| `src/components/budget/BudgetDialog.tsx` | 10 |
| `src/components/budget/BudgetIndicator.tsx` | 4 |
| `src/components/budget/BusinessBudgetCard.tsx` | 4 |
| `src/components/budget/PersonalBudgetCard.tsx` | 5 |
| `src/components/BulkActionBar.tsx` | 9 |
| `src/components/CategoryPicker.tsx` | 5 |
| `src/components/ClientDetailSheet.tsx` | 11 |
| `src/components/ClientOverviewModal.tsx` | 4 |
| `src/components/filters/FilterSheet.tsx` | 5 |
| `src/components/InstallAppBanner.tsx` | 6 |
| `src/components/LanguageSwitcher.tsx` | 2 |
| `src/components/MobileAppLayout.tsx` | 28 |
| `src/components/mode-toggle.tsx` | 4 |
| `src/components/onboarding/MoneyWizard.tsx` | 18 |
| `src/components/onboarding/PlanStep.tsx` | 12 |
| `src/components/OrgSwitcher.tsx` | 5 |
| `src/components/QuickAddModal.tsx` | 35 |
| `src/components/TransactionDetailModal.tsx` | 13 |
| `src/components/TransactionPeekModal.tsx` | 10 |
| `src/components/transactions/AddTransactionDialog.tsx` | 12 |
| `src/components/transactions/TransactionAttachments.tsx` | 6 |
| `src/components/transactions/tx-form.tsx` | 17 |
| `src/components/wealth/AccountDetailsSection.tsx` | 11 |
| `src/components/wealth/AccountQuickAddSheet.tsx` | 25 |
| `src/components/wealth/BankAccountFormFields.tsx` | 14 |
| `src/components/wealth/TransferWizard.tsx` | 21 |
| `src/components/wealth/WealthAccountDialogs.tsx` | 20 |
| `src/landing/blog/BlogArticlePage.tsx` | 10 |
| `src/landing/blog/BlogCard.tsx` | 1 |
| `src/landing/blog/BlogIndexPage.tsx` | 10 |
| `src/landing/blog/BlogShell.tsx` | 2 |
| `src/landing/components/LanguagePicker.tsx` | 1 |
| `src/landing/components/ThemeToggle.tsx` | 4 |
| `src/landing/LandingPage.tsx` | 2 |
| `src/landing/sections/AnalyticsTeaser.tsx` | 11 |
| `src/landing/sections/Blog.tsx` | 5 |
| `src/landing/sections/CTA.tsx` | 5 |
| `src/landing/sections/FAQ.tsx` | 4 |
| `src/landing/sections/Features.tsx` | 8 |
| `src/landing/sections/Footer.tsx` | 16 |
| `src/landing/sections/Hero.tsx` | 7 |
| `src/landing/sections/HowItWorks.tsx` | 4 |
| `src/landing/sections/Navbar.tsx` | 18 |
| `src/landing/sections/Pricing.tsx` | 19 |
| `src/landing/sections/Testimonials.tsx` | 4 |
| `src/landing/sections/TrustBar.tsx` | 2 |
| `src/landing/sections/ValueBand.tsx` | 3 |
| `src/pages/AnalyticsPage.tsx` | 24 |
| `src/pages/BudgetDetailPage.tsx` | 19 |
| `src/pages/BudgetsPage.tsx` | 13 |
| `src/pages/CategoriesPage.tsx` | 42 |
| `src/pages/ClientsPage.tsx` | 60 |
| `src/pages/ClosedClientsPage.tsx` | 19 |
| `src/pages/Dashboard.tsx` | 70 |
| `src/pages/ForgotPasswordPage.tsx` | 25 |
| `src/pages/LoginPage.tsx` | 1 |
| `src/pages/OnboardingPage.tsx` | 14 |
| `src/pages/OrganizationsPage.tsx` | 31 |
| `src/pages/OrgMembersPage.tsx` | 35 |
| `src/pages/OrgSetupPage.tsx` | 9 |
| `src/pages/ProfilePage.tsx` | 33 |
| `src/pages/QuotationsPage.tsx` | 105 |
| `src/pages/SubscriptionPage.tsx` | 66 |
| `src/pages/TransactionsPage.tsx` | 88 |
| `src/pages/TrashPage.tsx` | 22 |
| `src/pages/WealthAccountDetailPage.tsx` | 30 |
| `src/pages/WealthPage.tsx` | 48 |
